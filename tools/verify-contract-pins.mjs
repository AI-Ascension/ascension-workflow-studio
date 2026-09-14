import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
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
  assert(recorded.checksums && typeof recorded.checksums === 'object', 'Missing recorded-run pins');
  const recordedCount = verifyEntries(recordedRoot,
    Object.entries(recorded.checksums).map(([path, sha256]) => ({ path, sha256 })));
  console.log(`Verified ${phase1Count} Phase 1, ${effectiveCount} effective-limit, ${contextCatalogCount} context catalog and ${recordedCount} recorded-run contract pins`);
}
