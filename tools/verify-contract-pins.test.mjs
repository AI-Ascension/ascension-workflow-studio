import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  verifyContextCatalogPin,
  verifyEntries,
  verifyInferenceProfileCatalogPin,
} from './verify-contract-pins.mjs';

test('catalog inventory keeps producer source, synthetic provenance and fixture identity separate', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pin = JSON.parse(readFileSync(join(root, 'contracts/context-control-catalog.lock.json')));
  assert.equal(verifyContextCatalogPin(root, pin), 1);
  for (const update of [
    { repository: 'consumer/invented' }, { revision: 'main' }, { producer_path: 'other.json' },
    { evidence: 'authenticated_owner' }, { historical_contract_origin: pin.revision },
    { consumed_artifacts: [] }, { consumed_artifacts: [...pin.consumed_artifacts, ...pin.consumed_artifacts] },
    { consumed_artifacts: [{ ...pin.consumed_artifacts[0], sha256: '0'.repeat(64) }] },
  ]) assert.throws(() => verifyContextCatalogPin(root, { ...pin, ...update }));
});

test('contract pins reject corruption, omissions, duplicates and escaping paths', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'studio-contract-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'contract');
  mkdirSync(root);
  writeFileSync(join(root, 'schema.json'), '{}');
  const sha256 = createHash('sha256').update('{}').digest('hex');
  const entries = [{ path: 'schema.json', sha256 }];
  assert.equal(verifyEntries(root, entries), 1);
  assert.throws(() => verifyEntries(root, []), /empty/);
  assert.throws(() => verifyEntries(root, [...entries, ...entries]), /Duplicate/);
  assert.throws(() => verifyEntries(root, [{ path: 'missing.json', sha256 }]), /ENOENT/);
  assert.throws(() => verifyEntries(root, [{ path: 'schema.json', sha256: 'bad' }]), /Invalid SHA/);
  writeFileSync(join(temp, 'outside.json'), '{}');
  assert.throws(() => verifyEntries(root, [{ path: '../outside.json', sha256 }]), /escapes/);
  const outsideDirectory = join(temp, 'outside');
  mkdirSync(outsideDirectory);
  writeFileSync(join(outsideDirectory, 'schema.json'), '{}');
  symlinkSync(outsideDirectory, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyEntries(root, [{ path: 'link/schema.json', sha256 }]), /escapes/);
  writeFileSync(join(root, 'schema.json'), '{"changed":true}');
  assert.throws(() => verifyEntries(root, entries), /digest mismatch/);
});

test('inference-profile catalog pin binds the fixture to the sealing producer source', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pin = JSON.parse(readFileSync(join(root, 'contracts/inference-profile-catalog.lock.json')));
  assert.equal(verifyInferenceProfileCatalogPin(root, pin), 1);
  // Only the lock's OWN invariants are asserted here. These hold whether or not
  // a sibling producer checkout happens to be present, so this test does not
  // depend on the working tree it runs in. A digest can only be checked against
  // a real file, so source-drift cases are covered separately below, against a
  // synthetic checkout built by the test itself.
  for (const update of [
    { repository: 'consumer/invented' }, { revision: 'main' },
    { producer_path: 'crates/harness/src/management/other.rs' },
    { evidence: 'authenticated_owner' }, { sealing_method: 'transcribed_by_hand' },
    { producer_crate: { ...pin.producer_crate, path: 'elsewhere/crates/harness' } },
    { producer_crate: { ...pin.producer_crate, checkout: '' } },
    { producer_sources: [] },
    { producer_sources: [{ producer_path: '../../../etc/passwd', sha256: '0'.repeat(64) }] },
    { producer_sources: [{ producer_path: '/etc/passwd', sha256: '0'.repeat(64) }] },
    { producer_sources: [{ producer_path: 'C:/private/source.rs', sha256: '0'.repeat(64) }] },
    { producer_sources: [{ producer_path: 'C:\\private\\source.rs', sha256: '0'.repeat(64) }] },
    { producer_sources: [{ producer_path: 'crates\\harness\\source.rs', sha256: '0'.repeat(64) }] },
    { producer_sources: [{ producer_path: 'crates/../../escape.rs', sha256: '0'.repeat(64) }] },
    { producer_sources: [{ producer_path: 'crates/harness/src/management/contract_json.rs', sha256: 'nope' }] },
    { consumed_artifacts: [] }, { consumed_artifacts: [...pin.consumed_artifacts, ...pin.consumed_artifacts] },
    { consumed_artifacts: [{ ...pin.consumed_artifacts[0], sha256: '0'.repeat(64) }] },
  ]) assert.throws(() => verifyInferenceProfileCatalogPin(root, { ...pin, ...update }));
});

test('a pinned producer source that drifts from the sealed revision is refused', (t) => {
  // Source-drift detection needs a real file to hash, so this builds its own
  // producer checkout instead of relying on a sibling `harness/` that may or may
  // not exist in the working tree. That dependency is what made the assertion
  // above environment-dependent: it passed only on a machine that happened to
  // have the producer checked out alongside.
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  const pin = JSON.parse(readFileSync(join(repoRoot, 'contracts/inference-profile-catalog.lock.json')));
  const root = mkdtempSync(join(tmpdir(), 'studio-seal-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['contracts/accepted/inference-profile', pin.producer_crate.checkout]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  copyFileSync(
    join(repoRoot, 'contracts/inference-profile-catalog.lock.json'),
    join(root, 'contracts/inference-profile-catalog.lock.json'),
  );
  copyFileSync(
    join(repoRoot, 'contracts/accepted/inference-profile/catalog-conformance.json'),
    join(root, 'contracts/accepted/inference-profile/catalog-conformance.json'),
  );
  // Materialise each pinned producer source with the digest the lock claims.
  for (const entry of pin.producer_sources) {
    const file = join(root, pin.producer_crate.checkout, entry.producer_path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'sealed producer source\n');
  }
  // The lock's own digests must line up with what we just wrote, or the test
  // would fail for the wrong reason.
  const rewritten = {
    ...pin,
    consumed_artifacts: pin.consumed_artifacts.map((entry) => ({
      ...entry,
      sha256: createHash('sha256')
        .update(readFileSync(join(root, entry.path)))
        .digest('hex'),
    })),
    producer_sources: pin.producer_sources.map((entry) => ({
      ...entry,
      sha256: createHash('sha256')
        .update(readFileSync(join(root, pin.producer_crate.checkout, entry.producer_path)))
        .digest('hex'),
    })),
  };
  writeFileSync(
    join(root, 'contracts/inference-profile-catalog.lock.json'),
    JSON.stringify(rewritten, null, 2),
  );
  assert.equal(verifyInferenceProfileCatalogPin(root, rewritten), 1);
  // Now drift one pinned source and the gate must refuse it.
  assert.throws(() => verifyInferenceProfileCatalogPin(root, {
    ...rewritten,
    producer_sources: rewritten.producer_sources.map((entry, index) =>
      (index === 0 ? { ...entry, sha256: '0'.repeat(64) } : entry)),
  }), /drifted/);
});

test('the strict gate refuses to pass when the producer checkout or seal binary is absent', (t) => {
  // Use a throwaway root that has the fixture but no producer checkout and no
  // seal binary, so the result does not depend on what this working tree
  // happens to contain.
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'studio-seal-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'contracts/accepted/inference-profile'), { recursive: true });
  copyFileSync(
    join(repoRoot, 'contracts/inference-profile-catalog.lock.json'),
    join(root, 'contracts/inference-profile-catalog.lock.json'),
  );
  copyFileSync(
    join(repoRoot, 'contracts/accepted/inference-profile/catalog-conformance.json'),
    join(root, 'contracts/accepted/inference-profile/catalog-conformance.json'),
  );
  const strictPin = JSON.parse(readFileSync(join(root, 'contracts/inference-profile-catalog.lock.json')));
  // The strict gate has no producer checkout to verify against, so it must
  // fail rather than quietly verify nothing.
  assert.throws(
    () => verifyInferenceProfileCatalogPin(root, strictPin, { requireProducerCheckout: true }),
    /checkout present/,
  );
  // ...while the lenient path still verifies the fixture's own digest.
  assert.equal(verifyInferenceProfileCatalogPin(root, strictPin), 1);
  assert.equal(existsSync(join(root, strictPin.producer_crate.checkout)), false);
  t.diagnostic('strict mode failed closed as designed');
});
