import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { checkTrackedPaths, verifyPortablePackage, windowsPathProblem } from './verify-checkout-portability.mjs';

test('rejects the actual checkout defect and every reserved device family', () => {
  for (const name of ['CON.md', 'prn.txt', 'AUX', 'nul.tar.gz', 'COM1.json', 'com9', 'LPT1.md', 'lpt9', 'COM¹.txt', 'LPT²', 'COM³']) {
    assert.throws(() => checkTrackedPaths([`docs/${name}`]), /reserved device basename/);
  }
});

test('rejects invalid characters, path components and case-insensitive collisions', () => {
  for (const name of ['a:b', 'a?b', 'a\\b', 'a\nb', 'a"b', 'a|b', 'a*b', 'a<b', 'a>b', 'tail.', 'tail ', '/absolute', '../escape']) {
    assert.ok(windowsPathProblem(name), name);
  }
  assert.throws(() => checkTrackedPaths(['docs/A.md', 'docs/a.md']), /collision/);
  assert.throws(() => checkTrackedPaths(['Docs/a.md', 'docs/b.md']), /collision/);
});

test('allows portable names including the extracted contracts brief', () => {
  assert.equal(checkTrackedPaths(['.github/workflows/validate.yml', 'docs/CON-contracts.md', 'docs/com10.md', 'docs/printer.md']), 4);
});

test('validates every immutable archived byte through its portable mapping', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = verifyPortablePackage(root);
  assert.ok(result.packageFiles > 100);
  assert.equal(result.mappedNames, 1);
});

test('fails changed payloads, changed metadata and mappings that overwrite a member', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-portability-'));
  try {
    const packageRoot = join(root, 'docs/reference/phase2-package');
    mkdirSync(packageRoot, { recursive: true });
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const payload = Buffer.from('original bytes\n');
    const ordinary = Buffer.from('ordinary bytes\n');
    const manifest = Buffer.from(JSON.stringify({ files: [
      { path: 'CON.md', size_bytes: payload.length, sha256: hash(payload) },
      { path: 'normal.md', size_bytes: ordinary.length, sha256: hash(ordinary) },
    ] }));
    const sums = Buffer.from(`${hash(payload)}  CON.md\n${hash(ordinary)}  normal.md\n${hash(manifest)}  PACKAGE_MANIFEST.json\n`);
    const mapping = { schema_version: 1, package_root: 'docs/reference/phase2-package',
      original_metadata_sha256: { 'PACKAGE_MANIFEST.json': hash(manifest), SHA256SUMS: hash(sums) },
      paths: { 'CON.md': 'CON-contracts.md' } };
    const mappingPath = join(root, 'docs/reference/phase2-portable-paths.json');
    writeFileSync(mappingPath, JSON.stringify(mapping));
    writeFileSync(join(packageRoot, 'PACKAGE_MANIFEST.json'), manifest);
    writeFileSync(join(packageRoot, 'SHA256SUMS'), sums);
    writeFileSync(join(packageRoot, 'CON-contracts.md'), payload);
    writeFileSync(join(packageRoot, 'normal.md'), ordinary);
    assert.deepEqual(verifyPortablePackage(root), { packageFiles: 4, mappedNames: 1 });
    mkdirSync(join(packageRoot, '__pycache__'));
    writeFileSync(join(packageRoot, '__pycache__/unlisted.pyc'), 'extra');
    assert.throws(() => verifyPortablePackage(root), /inventory mismatch/);
    rmSync(join(packageRoot, '__pycache__'), { recursive: true });
    writeFileSync(join(packageRoot, 'CON-contracts.md'), 'changed');
    assert.throws(() => verifyPortablePackage(root), /original member bytes changed/);
    writeFileSync(join(packageRoot, 'CON-contracts.md'), payload);
    writeFileSync(join(packageRoot, 'SHA256SUMS'), 'changed');
    assert.throws(() => verifyPortablePackage(root), /original package metadata changed/);
    writeFileSync(join(packageRoot, 'SHA256SUMS'), sums);
    mapping.paths['CON.md'] = 'normal.md';
    writeFileSync(mappingPath, JSON.stringify(mapping));
    assert.throws(() => verifyPortablePackage(root), /overwrites/);
    mapping.paths['CON.md'] = '../escape.md';
    writeFileSync(mappingPath, JSON.stringify(mapping));
    assert.throws(() => verifyPortablePackage(root), /non-relative/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a symlink or junction package root before reading its members', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-portability-link-'));
  try {
    const reference = join(root, 'docs/reference');
    const outside = join(root, 'outside');
    mkdirSync(reference, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(reference, 'phase2-portable-paths.json'), JSON.stringify({
      schema_version: 1, package_root: 'docs/reference/phase2-package', paths: {}, original_metadata_sha256: {},
    }));
    symlinkSync(outside, join(reference, 'phase2-package'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => verifyPortablePackage(root), /symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
