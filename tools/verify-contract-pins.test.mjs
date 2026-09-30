import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  symlinkSync(join(temp, 'outside.json'), join(root, 'link.json'));
  assert.throws(() => verifyEntries(root, [{ path: 'link.json', sha256 }]), /escapes/);
  writeFileSync(join(root, 'schema.json'), '{"changed":true}');
  assert.throws(() => verifyEntries(root, entries), /digest mismatch/);
});

test('inference-profile catalog pin binds the fixture to the sealing producer source', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pin = JSON.parse(readFileSync(join(root, 'contracts/inference-profile-catalog.lock.json')));
  assert.equal(verifyInferenceProfileCatalogPin(root, pin), 1);
  for (const update of [
    { repository: 'consumer/invented' }, { revision: 'main' },
    { producer_path: 'crates/harness/src/management/other.rs' },
    { evidence: 'authenticated_owner' }, { sealing_method: 'transcribed_by_hand' },
    { consumed_artifacts: [] }, { consumed_artifacts: [...pin.consumed_artifacts, ...pin.consumed_artifacts] },
    { consumed_artifacts: [{ ...pin.consumed_artifacts[0], sha256: '0'.repeat(64) }] },
  ]) assert.throws(() => verifyInferenceProfileCatalogPin(root, { ...pin, ...update }));
});

test('the pinned producer declaration order is cross-checked against the replica that runs', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pin = JSON.parse(readFileSync(join(root, 'contracts/inference-profile-catalog.lock.json')));

  // The whole point of pinning the order is that the lock file and the replica
  // are two independent statements about the same producer. Each mutation below
  // must therefore be refused, and each failure message must name the replica —
  // a gate that only compared the lock file to itself would pass all of these.
  const mutations = [
    ['descriptor order reversed', { descriptor_field_order: [...pin.descriptor_field_order].reverse() }],
    ['descriptor order dropped a field', { descriptor_field_order: pin.descriptor_field_order.slice(1) }],
    ['descriptor order renamed a field', {
      descriptor_field_order: pin.descriptor_field_order.map((f, i) => (i === 0 ? 'schemaVersion' : f)),
    }],
    ['descriptor order duplicated a field', {
      descriptor_field_order: [pin.descriptor_field_order[0], ...pin.descriptor_field_order],
    }],
    ['descriptor order missing entirely', { descriptor_field_order: undefined }],
    ['nested grants order swapped', { nested_field_order: { ...pin.nested_field_order, grants: ['edit', 'select'] } }],
    ['nested continuity order swapped', {
      nested_field_order: {
        ...pin.nested_field_order,
        continuity: [...pin.nested_field_order.continuity].reverse(),
      },
    }],
    ['nested effective_budgets order swapped', {
      nested_field_order: {
        ...pin.nested_field_order,
        effective_budgets: [...pin.nested_field_order.effective_budgets].reverse(),
      },
    }],
    ['nested order emptied', { nested_field_order: {} }],
    ['nested order missing entirely', { nested_field_order: undefined }],
  ];
  const refusal = /pinned producer declaration order|Descriptor order must cover|Missing pinned field order|Invalid pinned field name|Duplicate field in pinned order|do not match the groups/;
  for (const [label, update] of mutations) {
    assert.throws(
      () => verifyInferenceProfileCatalogPin(root, { ...pin, ...update }),
      refusal,
      `gate accepted a mutated lock file: ${label}`,
    );
  }

  // And the unmutated lock still passes, so the assertions above are refusals
  // of the specific mutation rather than a gate that refuses everything.
  assert.equal(verifyInferenceProfileCatalogPin(root, pin), 1);
});
