import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPortablePackage } from './verify-checkout-portability.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
const hash = (path) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const stable = new Set();
let checkedDigests = 0;

function check(path, expected) {
  assert(tracked.has(path), `Digest-bound member is not tracked: ${path}`);
  assert.match(expected, /^[a-f0-9]{64}$/u, `Invalid recorded digest: ${path}`);
  assert.equal(hash(path), expected, `Recorded byte digest mismatch: ${path}`);
  stable.add(path);
  checkedDigests += 1;
}

// Every retained checksum inventory is covered, including the historical one.
for (const inventory of [...tracked].filter((path) => posix.basename(path).endsWith('SHA256SUMS'))) {
  stable.add(inventory);
  if (inventory === 'docs/reference/phase2-package/SHA256SUMS') {
    verifyPortablePackage(root); // Original names are resolved by its portable map.
    for (const path of tracked) if (path.startsWith('docs/reference/phase2-package/')) stable.add(path);
    continue;
  }
  for (const line of readFileSync(resolve(root, inventory), 'utf8').trimEnd().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assert(match, `Invalid checksum inventory line: ${inventory}`);
    const local = posix.join(posix.dirname(inventory), match[2]);
    const member = tracked.has(local) ? local : match[2];
    check(member, match[1]);
  }
}

for (const path of tracked) {
  if (path.endsWith('.lock.json') || path.endsWith('/studio-pin.json')) {
    stable.add(path);
    const pin = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    for (const entry of pin.consumed_artifacts ?? []) check(entry.path, entry.sha256);
    for (const [member, digest] of Object.entries(pin.checksums ?? {})) {
      check(posix.join(posix.dirname(path), member), digest);
    }
    // Producer-source digests identify a separate pinned repository, not local files.
  }
  if (path.startsWith('artifacts/recorded-run-preview/') && path.endsWith('.manifest.json')) {
    stable.add(path);
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    if (manifest.archive_sha256) check(path.replace(/\.manifest\.json$/u, '.zip'), manifest.archive_sha256);
    // Member digests describe bytes inside the unchanged ZIP; no extracted copy is tracked.
  }
}

// A line-ending-independent digest would weaken the original byte provenance.
// Require explicit Git byte stability instead of normalizing data or repinning it.
const attrs = execFileSync('git', ['check-attr', '-z', '--stdin', 'text'], {
  cwd: root, input: [...stable].join('\0') + '\0', encoding: 'utf8',
}).split('\0');
for (let index = 0; index < attrs.length - 1; index += 3) {
  assert.equal(attrs[index + 2], 'unset', `Digest-bound path lacks -text: ${attrs[index]}`);
}
console.log(JSON.stringify({ byteStablePaths: stable.size, checkedDigests, checksumInventories: [...tracked].filter((path) => posix.basename(path).endsWith('SHA256SUMS')).length }, null, 2));
