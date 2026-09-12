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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const phase1 = JSON.parse(readFileSync(resolve(root, 'contracts/accepted/phase1-integration.lock.json')));
  const recordedRoot = resolve(root, 'contracts/recorded-run-candidate');
  const recorded = JSON.parse(readFileSync(resolve(recordedRoot, 'studio-pin.json')));
  const phase1Count = verifyEntries(root, phase1.consumed_artifacts);
  assert(recorded.checksums && typeof recorded.checksums === 'object', 'Missing recorded-run pins');
  const recordedCount = verifyEntries(recordedRoot,
    Object.entries(recorded.checksums).map(([path, sha256]) => ({ path, sha256 })));
  console.log(`Verified ${phase1Count} Phase 1 and ${recordedCount} recorded-run contract pins`);
}
