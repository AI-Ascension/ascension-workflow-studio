import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyEntries } from './verify-contract-pins.mjs';

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
  symlinkSync(join(temp, 'outside.json'), join(root, 'link.json'));
  assert.throws(() => verifyEntries(root, [{ path: 'link.json', sha256 }]), /escapes/);
  writeFileSync(join(root, 'schema.json'), '{"changed":true}');
  assert.throws(() => verifyEntries(root, entries), /digest mismatch/);
});
