import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyContextCatalogPin, verifyEntries } from './verify-contract-pins.mjs';

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
  symlinkSync(join(temp, 'outside.json'), join(root, 'link.json'));
  assert.throws(() => verifyEntries(root, [{ path: 'link.json', sha256 }]), /escapes/);
  writeFileSync(join(root, 'schema.json'), '{"changed":true}');
  assert.throws(() => verifyEntries(root, entries), /digest mismatch/);
});
