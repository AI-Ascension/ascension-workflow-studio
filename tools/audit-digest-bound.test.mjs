import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertCanonicalBytes,
  assertByteStable,
  audit,
  auditByteStability,
  classify,
  isByteStable,
} from './audit-digest-bound.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('every tracked digest-bound file is byte-stable under checkout conversion', () => {
  const report = auditByteStability({ repositoryRoot: ROOT });
  assert.deepEqual(
    report.problems,
    [],
    `digest-bound files exposed to line-ending conversion:\n  ${report.problems.join('\n  ')}`,
  );
  // A zero-size audit would pass vacuously, so assert real coverage. The
  // tracked text count is deliberately a floor, not an exact number: adding a
  // pinned artifact must not require editing this test.
  assert.ok(report.checked >= 100, `expected broad coverage, audited only ${report.checked}`);
  assert.ok(report.binary > 0, 'the pinned set should include binary fixtures');
});

test('the audit covers each pin record named in Studio #234, not only Phase 1', () => {
  const pinned = new Set(audit().filter((row) => row.tracked).map((row) => row.path));
  for (const path of [
    'contracts/accepted/phase1/workflow-v1.schema.json',
    'contracts/accepted/context-control/catalog-conformance.json',
    'contracts/accepted/effective-limits/producer.json',
    'contracts/accepted/inference-profile/catalog-conformance.json',
    'contracts/recorded-run-candidate/SHA256SUMS',
    'contracts/recorded-run-candidate/schema.json',
    'contracts/accepted/phase1/SHA256SUMS',
    'docs/evidence/studio-bundle.SHA256SUMS',
    'history/recorded-run-candidate2/contracts/SHA256SUMS',
    'history/recorded-run-candidate2/contracts/schema.json',
    'docs/reference/phase2-package/PACKAGE_MANIFEST.json',
  ]) {
    assert.ok(pinned.has(path), `audit does not cover ${path}`);
  }
});

test('an unpinned digest-bound file cannot be silently dropped from the audit', () => {
  const pinned = new Set(audit().filter((row) => row.tracked).map((row) => row.path));
  const attributes = execFileSync(
    'git',
    ['check-attr', 'text', '--', 'contracts/accepted/phase1/workflow-v1.schema.json'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.match(attributes, /text: unset/);
  // The inventories that *state* the digests are digest-bound in their own
  // right and must be byte-stable too, or a Windows checkout would rewrite the
  // very file that states what the digests are.
  assert.ok(pinned.has('contracts/accepted/phase1/SHA256SUMS'));
  assert.ok(pinned.has('contracts/recorded-run-candidate/schema.json'));
});

test('byte-stability is judged by effective Git attributes, not by a path list', () => {
  // `-text` (unset) and `text eol=lf` are both byte-stable; anything that lets
  // Git rewrite the working tree is not.
  assert.equal(isByteStable({ text: 'unset' }), true);
  assert.equal(isByteStable({ text: 'set', eol: 'lf' }), true);
  assert.equal(isByteStable({ text: 'set' }), false);
  assert.equal(isByteStable({ text: 'set', eol: 'crlf' }), false);
  assert.equal(isByteStable({ text: 'string' }), false);
  assert.equal(isByteStable({ text: 'unspecified' }), false);
});

test('every exposed file is reported with a reason naming the conversion risk', () => {
  const problems = assertByteStable([
    { path: 'a.json', text: 'unspecified', eol: undefined },
    { path: 'b.json', text: 'set', eol: undefined },
    { path: 'c.json', text: 'set', eol: 'crlf' },
    { path: 'd.txt', text: 'string', eol: undefined },
  ]);
  assert.equal(problems.length, 4);
  assert.match(problems.join('\n'), /a\.json: no explicit text attribute/);
  assert.match(problems.join('\n'), /b\.json: declared text with no eol/);
  assert.match(problems.join('\n'), /c\.json: declared text eol=crlf/);
  assert.match(problems.join('\n'), /d\.txt: text=auto/);
  // The order must be stable so CI output is diffable.
  assert.deepEqual(problems, assertByteStable([
    { path: 'a.json', text: 'unspecified', eol: undefined },
    { path: 'b.json', text: 'set', eol: undefined },
    { path: 'c.json', text: 'set', eol: 'crlf' },
    { path: 'd.txt', text: 'string', eol: undefined },
  ]));
});

test('binary members are recognised as immune to line-ending conversion', () => {
  assert.deepEqual(classify(Buffer.from('a\r\nb')), { kind: 'text', lineEndings: 'CRLF' });
  assert.deepEqual(classify(Buffer.from('a\nb')), { kind: 'text', lineEndings: 'LF' });
  assert.deepEqual(classify(Buffer.from([0x50, 0x4b, 0x00, 0x0a])), { kind: 'binary', lineEndings: 'n/a' });
});

test('no digest-bound file is committed with converted bytes (Studio #234 AC5)', () => {
  // A CRLF-tolerant verifier could be satisfied by rewriting the recorded
  // digests to the converted values, which is a hard failure of this task. The
  // property that actually prevents it is stronger than "the digest matches":
  // a converted artifact cannot be committed at all, because a CRLF blob has
  // no canonical LF original in this repository.
  const report = auditByteStability({ repositoryRoot: ROOT });
  assert.deepEqual(
    report.nonCanonical,
    [],
    `digest-bound files committed with converted bytes:\n  ${report.nonCanonical.join('\n  ')}`,
  );
  // And the classification that makes that check meaningful is exercised:
  // a CRLF buffer must be distinguishable from LF, or `nonCanonical` would be
  // empty because nothing is ever detected.
  assert.deepEqual(classify(Buffer.from('a\r\nb')), { kind: 'text', lineEndings: 'CRLF' });
  assert.deepEqual(
    assertCanonicalBytes([
      { path: 'crlf.json', lineEndings: 'CRLF' },
      { path: 'lf.json', lineEndings: 'LF' },
    ]),
    ['crlf.json: committed with CRLF line endings, so its recorded digest describes converted bytes'],
  );
});
