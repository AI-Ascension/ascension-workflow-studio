import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

/**
 * The inference-profile catalog fixture is sealed by the PRODUCER's own code.
 *
 * `tools/inference-profile-conformance-seal` links the producer crate itself
 * (`sts2-harness`, at the sibling `harness/` checkout) as a path dependency and
 * calls the owner's `seal()` and `inference_catalog_digest()` — the same
 * technique `tools/provider-policy-production-fixture` already uses. No copy of
 * the producer's code is stored in this repository, so there is no transcription
 * to drift. This gate does three things a string comparison cannot:
 *
 *   1. the producer checkout in this working tree still hashes to the digests
 *      pinned in the lock, so the linked source is the pinned revision and not
 *      some later edit;
 *   2. the generator binary exists (it is built by the live-owner CI job);
 *   3. when the binary is runnable, its output must byte-match the checked-in
 *      fixture. That is what makes `sealing_method: producer_crate_linked_seal`
 *      a fact about the bytes instead of a label.
 *
 * Checks 1 and 3 need the sibling producer checkout, which only the
 * `producer-seal` job materialises. Callers pass `requireProducerCheckout` to
 * make their absence a failure instead of a warning; every other caller still
 * verifies the lock's own invariants and the fixture digest.
 */
export function verifyInferenceProfileCatalogPin(root, pin, { requireProducerCheckout = false } = {}) {
  assert.equal(pin.repository, 'AI-Ascension/sts2-harness', 'Unknown catalog producer');
  assert(/^[a-f0-9]{40}$/.test(pin.revision), 'Invalid catalog producer revision');
  assert.equal(pin.producer_path, 'crates/harness/src/management/contract_inference_profile.rs');
  assert.equal(pin.evidence, 'synthetic_descriptor_validation_only');
  assert.equal(pin.sealing_method, 'producer_crate_linked_seal');

  // 1. The linked producer checkout is the pinned revision, byte for byte.
  const producerCrate = pin.producer_crate;
  assert(producerCrate
    && typeof producerCrate.checkout === 'string' && producerCrate.checkout.length > 0
    && typeof producerCrate.path === 'string' && producerCrate.path.length > 0,
  'The lock names no producer crate checkout');
  // The crate is linked from inside its checkout, so the checkout is the root
  // that the repo-relative `producer_path` entries below resolve against.
  assert(producerCrate.path === `${producerCrate.checkout}/crates/harness`
    || producerCrate.path.startsWith(`${producerCrate.checkout}/`),
  `The linked producer crate (${producerCrate.path}) is not inside its checkout (${producerCrate.checkout})`);
  const sources = pin.producer_sources;
  assert(Array.isArray(sources) && sources.length >= 1, 'No producer sources pinned');
  for (const entry of sources) {
    assert(typeof entry.producer_path === 'string' && entry.producer_path.length > 0,
      'A pinned producer source names no producer path');
    assert(/^[a-f0-9]{64}$/.test(entry.sha256), `Invalid producer SHA-256: ${entry.producer_path}`);
  }
  if (existsSync(resolve(root, producerCrate.checkout))) {
    const checkout = realpathSync(resolve(root, producerCrate.checkout));
    for (const entry of sources) {
      // The pinned path is resolved inside the checkout and re-checked, so a
      // traversal attempt or a symlink cannot hash a file outside it.
      const file = realpathSync(resolve(checkout, entry.producer_path));
      const local = relative(checkout, file);
      assert(local && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local),
        `Producer path escapes the pinned checkout: ${entry.producer_path}`);
      const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
      assert.equal(actual, entry.sha256,
        `Producer source drifted from ${pin.repository}@${pin.revision}: ` +
        `${entry.producer_path} is not the sealed revision, so the linked seal would ` +
        'not reproduce this fixture');
    }
  } else {
    const message = `[contract-pins] no ${producerCrate.checkout} checkout present; ` +
      'linked-producer source digests were not checked this run';
    if (requireProducerCheckout) throw new Error(message);
    console.warn(message);
  }

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
  }

  // 3. Re-seal with the producer and require the bytes to be reproduced. Skipped
  // (not silently passed) when the binary has not been built in this checkout.
  const binary = resolve(root, 'harness/target/release', pin.generator_binary);
  if (existsSync(binary)) {
    const regenerated = execFileSync(binary, {
      cwd: root,
      env: { ...process.env, STS2_HARNESS_PRODUCER_REVISION: pin.revision },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const expected = JSON.stringify(JSON.parse(regenerated));
    const actual = JSON.stringify(fixture);
    assert.equal(actual, expected,
      'Checked-in conformance fixture does NOT match a fresh producer seal; the digests are not producer output');
  } else {
    const message = `[contract-pins] producer seal binary absent at ${binary}; byte-equality re-seal skipped this run`;
    if (requireProducerCheckout) throw new Error(message);
    console.warn(message);
  }
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  /**
   * `--require-producer-checkout` is the gate the `producer-seal` CI job runs.
   * It turns the two warnings in verifyInferenceProfileCatalogPin into failures,
   * so a job that forgets to check out the pinned producer, or fails to build
   * the seal binary, cannot pass by silently skipping the only checks that make
   * the seal claim meaningful.
   */
  const strict = process.argv.includes('--require-producer-checkout');
  const phase1 = JSON.parse(readFileSync(resolve(root, 'contracts/accepted/phase1-integration.lock.json')));
  const recordedRoot = resolve(root, 'contracts/recorded-run-candidate');
  const recorded = JSON.parse(readFileSync(resolve(recordedRoot, 'studio-pin.json')));
  const phase1Count = verifyEntries(root, phase1.consumed_artifacts);
  const effective = JSON.parse(readFileSync(resolve(root, 'contracts/effective-limits.lock.json')));
  const effectiveCount = verifyEntries(root, effective.consumed_artifacts);
  const contextCatalog = JSON.parse(readFileSync(resolve(root, 'contracts/context-control-catalog.lock.json')));
  const contextCatalogCount = verifyContextCatalogPin(root, contextCatalog);
  const inferenceCatalog = JSON.parse(readFileSync(resolve(root, 'contracts/inference-profile-catalog.lock.json')));
  const inferenceCatalogCount = verifyInferenceProfileCatalogPin(root, inferenceCatalog, {
    requireProducerCheckout: strict,
  });
  assert(recorded.checksums && typeof recorded.checksums === 'object', 'Missing recorded-run pins');
  const recordedCount = verifyEntries(recordedRoot,
    Object.entries(recorded.checksums).map(([path, sha256]) => ({ path, sha256 })));
  console.log(`Verified ${phase1Count} Phase 1, ${effectiveCount} effective-limit, ${contextCatalogCount} context catalog, ${inferenceCatalogCount} inference-profile catalog and ${recordedCount} recorded-run contract pins`);
}
