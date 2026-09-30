import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Loads the seal replica's declared field order from TypeScript source.
 * `require` is used rather than `await import` so this gate stays synchronous
 * and its callers (the CLI entry point and the node:test suite) need no change.
 * Node strips the type annotations natively; if that ever stops working the
 * gate fails loudly here instead of silently skipping the cross-check. */
function replicaOrder(root) {
  const modulePath = resolve(root, 'packages/contracts/src/inference-profile-catalog.test-fixtures.ts');
  const order = require(modulePath).order;
  assert(order && typeof order === 'object',
    'Seal replica does not export its declared field order');
  return order;
}

export function verifyEntries(root, entries) {
  assert(Array.isArray(entries) && entries.length > 0, 'Contract pin inventory must not be empty');
  const base = realpathSync(root);
  const seen = new Set();
  for (const { path, sha256 } of entries) {
    assert(typeof path === 'string' && path.length > 0 && !isAbsolute(path), 'Invalid contract path');
    assert(/^[a-f0-9]{64}$/.test(sha256), `Invalid SHA-256: ${path}`);
    assert(!seen.has(path), `Duplicate contract path: ${path}`);
    seen.add(path);
    const file = realpathSync(resolve(base, path));
    const local = relative(base, file);
    assert(local && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local),
      `Contract path escapes inventory root: ${path}`);
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.equal(actual, sha256, `Contract digest mismatch: ${path}`);
  }
  return entries.length;
}

export function verifyContextCatalogPin(root, pin) {
  assert.equal(pin.repository, 'AI-Ascension/sts2-harness', 'Unknown catalog producer');
  assert(/^[a-f0-9]{40}$/.test(pin.revision), 'Invalid catalog producer revision');
  assert.equal(pin.producer_path, 'fixtures/context-control/catalog-conformance.json');
  assert.equal(pin.evidence, 'synthetic_descriptor_validation_only');
  assert.equal(pin.consumed_artifacts?.length, 1, 'Exactly one catalog fixture is required');
  assert.equal(pin.consumed_artifacts[0].path, 'contracts/accepted/context-control/catalog-conformance.json');
  const count = verifyEntries(root, pin.consumed_artifacts);
  const fixture = JSON.parse(readFileSync(resolve(root, pin.consumed_artifacts[0].path)));
  assert.equal(fixture.fixture_schema, 'ascension.context-control.catalog-conformance.fixture.v1');
  assert.equal(fixture.origin_revision, pin.historical_contract_origin);
  assert.equal(fixture.evidence, pin.evidence);
  return count;
}

/** The inference-profile fixture was NOT sealed by running the producer. The
 * consumer holds a JavaScript replica of the seal
 * (`InferenceProfileDescriptor::seal` / `inference_catalog_digest`) that was
 * written by hand; no producer code is compiled, included or executed here.
 *
 * The pin therefore records the producer source revision the replica was
 * transcribed FROM, and — as data, not as prose — the declaration order of
 * `struct InferenceProfileDescriptor` at that revision. Because the fixture is
 * stored with alphabetically sorted keys, a replica that hashed the file's own
 * key order would compute a different digest and be refused. The gate
 * deep-equals the replica's order against these pinned arrays, which is what
 * makes "replica matches the owner's declared byte order" a checked fact
 * rather than an assertion in a comment. */
export function verifyInferenceProfileCatalogPin(root, pin) {
  assert.equal(pin.repository, 'AI-Ascension/sts2-harness', 'Unknown catalog producer');
  assert(/^[a-f0-9]{40}$/.test(pin.revision), 'Invalid catalog producer revision');
  assert.equal(pin.producer_path, 'crates/harness/src/management/contract_inference_profile.rs');
  assert.equal(pin.evidence, 'synthetic_descriptor_validation_only');
  assert.equal(pin.sealing_method, 'consumer_replica_seal_crosschecked_against_producer_declaration_order');
  const declared = { descriptor: pin.descriptor_field_order, ...pin.nested_field_order };
  for (const [group, keys] of Object.entries(declared)) {
    assert(Array.isArray(keys) && keys.length > 0, `Missing pinned field order: ${group}`);
    assert(new Set(keys).size === keys.length, `Duplicate field in pinned order: ${group}`);
    for (const key of keys) {
      assert(typeof key === 'string' && /^[a-z][a-z0-9_]*$/.test(key),
        `Invalid pinned field name in ${group}: ${String(key)}`);
    }
  }
  assert.equal(declared.descriptor.length, 17, 'Descriptor order must cover all 17 declared fields');
  // Cross-check the pinned order against the replica that actually computes the
   // digests. This is the load-bearing assertion: without it the lock file and
   // the replica could drift apart and the gate would still be green, because
   // a lock file that merely restates itself proves nothing. The replica is
   // imported from TypeScript source, so this compares the code that runs
   // against the externally-sourced declaration order it claims to transcribe.
  const replica = replicaOrder(root);
  for (const [group, keys] of Object.entries(declared)) {
    assert.deepEqual(replica[group], keys,
      `Replica field order for ${group} does not match the pinned producer declaration order`);
  }
  // Both directions are required. A lock file that simply omitted a nested
  // group would otherwise make the loop above iterate over fewer groups and
  // pass, turning the gate green by checking less — so the pinned groups must
  // be exactly the set the replica declares, no fewer and no more.
  assert.deepEqual(Object.keys(declared).sort(), Object.keys(replica).sort(),
    'Pinned field-order groups do not match the groups the seal replica declares');
  assert.equal(pin.consumed_artifacts?.length, 1, 'Exactly one catalog fixture is required');
  assert.equal(pin.consumed_artifacts[0].path, 'contracts/accepted/inference-profile/catalog-conformance.json');
  const count = verifyEntries(root, pin.consumed_artifacts);
  const fixture = JSON.parse(readFileSync(resolve(root, pin.consumed_artifacts[0].path)));
  assert.equal(fixture.fixture_schema, 'ascension.inference-profile.catalog-conformance.fixture.v1');
  assert.equal(fixture.producer, pin.repository);
  assert.equal(fixture.producer_revision, pin.revision);
  assert.equal(fixture.method, pin.sealing_method);
  assert.equal(fixture.evidence, pin.evidence);
  for (const row of fixture.catalogs) {
    assert(typeof row.name === 'string' && row.name.length > 0, 'Unnamed catalog fixture row');
    assert.equal(row.catalog.schema_version, 'ascension.inference-profiles/v1');
    assert(row.catalog.descriptors.length > 0, `Catalog ${row.name} carries no descriptors`);
    // Every field the pinned order names must actually be present on every
    // descriptor, and the fixture must not carry fields the order omits: an
    // order that silently skipped a field would still deep-equal the replica.
    for (const descriptor of row.catalog.descriptors) {
      assert.deepEqual(Object.keys(descriptor).sort(), [...declared.descriptor].sort(),
        `Descriptor field set in catalog ${row.name} differs from the pinned producer order`);
      for (const [group, keys] of Object.entries(pin.nested_field_order)) {
        assert.deepEqual(Object.keys(descriptor[group]).sort(), [...keys].sort(),
          `Nested ${group} field set in catalog ${row.name} differs from the pinned producer order`);
      }
    }
  }
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const phase1 = JSON.parse(readFileSync(resolve(root, 'contracts/accepted/phase1-integration.lock.json')));
  const recordedRoot = resolve(root, 'contracts/recorded-run-candidate');
  const recorded = JSON.parse(readFileSync(resolve(recordedRoot, 'studio-pin.json')));
  const phase1Count = verifyEntries(root, phase1.consumed_artifacts);
  const effective = JSON.parse(readFileSync(resolve(root, 'contracts/effective-limits.lock.json')));
  const effectiveCount = verifyEntries(root, effective.consumed_artifacts);
  const contextCatalog = JSON.parse(readFileSync(resolve(root, 'contracts/context-control-catalog.lock.json')));
  const contextCatalogCount = verifyContextCatalogPin(root, contextCatalog);
  const inferenceCatalog = JSON.parse(readFileSync(resolve(root, 'contracts/inference-profile-catalog.lock.json')));
  const inferenceCatalogCount = verifyInferenceProfileCatalogPin(root, inferenceCatalog);
  assert(recorded.checksums && typeof recorded.checksums === 'object', 'Missing recorded-run pins');
  const recordedCount = verifyEntries(recordedRoot,
    Object.entries(recorded.checksums).map(([path, sha256]) => ({ path, sha256 })));
  console.log(`Verified ${phase1Count} Phase 1, ${effectiveCount} effective-limit, ${contextCatalogCount} context catalog, ${inferenceCatalogCount} inference-profile catalog and ${recordedCount} recorded-run contract pins`);
}
