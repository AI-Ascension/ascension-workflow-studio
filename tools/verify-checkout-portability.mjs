import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEVICE = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;

// Win32 file/directory rules, including device names with extensions:
// https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
export function windowsPathProblem(path) {
  if (typeof path !== 'string' || !path) return 'empty path';
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..') return 'non-relative path';
    if (/[<>:"\\|?*\u0000-\u001f]/u.test(part)) return 'reserved character';
    if (/[ .]$/u.test(part)) return 'trailing period or space';
    if (DEVICE.test(part)) return 'reserved device basename';
  }
  return null;
}

export function checkTrackedPaths(paths) {
  const names = new Map();
  for (const path of paths) {
    const problem = windowsPathProblem(path);
    if (problem) throw new Error(`${problem}: ${JSON.stringify(path)}`);
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join('/');
      const folded = prefix.toLowerCase();
      const prior = names.get(folded);
      if (prior !== undefined && prior !== prefix) {
        throw new Error(`case-insensitive path collision: ${prior} / ${prefix}`);
      }
      names.set(folded, prefix);
    }
  }
  return paths.length;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function memberPath(root, relative) {
  if (lstatSync(root).isSymbolicLink()) throw new Error('symlink package root');
  if (typeof relative !== 'string' || !relative || /[\\:\u0000]/u.test(relative)
      || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe package member: ${JSON.stringify(relative)}`);
  }
  const path = resolve(root, relative);
  if (!path.startsWith(resolve(root) + sep)) throw new Error('package member escapes root');
  let current = resolve(root);
  for (const part of relative.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('symlink package member');
  }
  return path;
}

function payloadMembers(root, relative = '') {
  const result = [];
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('symlink package member');
    if (entry.isDirectory()) result.push(...payloadMembers(root, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`non-file package member: ${name}`);
  }
  return result;
}

export function verifyPortablePackage(repositoryRoot = ROOT) {
  const mapping = JSON.parse(readFileSync(memberPath(repositoryRoot, 'docs/reference/phase2-portable-paths.json'), 'utf8'));
  if (mapping.schema_version !== 1 || mapping.package_root !== 'docs/reference/phase2-package'
      || !mapping.paths || !mapping.original_metadata_sha256) throw new Error('invalid portable package mapping');
  const root = memberPath(repositoryRoot, mapping.package_root);
  const readMember = (name) => readFileSync(memberPath(root, name));
  for (const name of ['PACKAGE_MANIFEST.json', 'SHA256SUMS']) {
    if (digest(readMember(name)) !== mapping.original_metadata_sha256[name]) {
      throw new Error(`original package metadata changed: ${name}`);
    }
  }
  const manifest = JSON.parse(readMember('PACKAGE_MANIFEST.json').toString('utf8'));
  const originalNames = new Set(manifest.files.map((row) => row.path));
  if (originalNames.size !== manifest.files.length) throw new Error('duplicate manifest member');
  for (const original of Object.keys(mapping.paths)) {
    if (!originalNames.has(original)) throw new Error(`mapping names unknown member: ${original}`);
  }
  const extracted = (name) => Object.hasOwn(mapping.paths, name) ? mapping.paths[name] : name;
  const expected = manifest.files.map((row) => extracted(row.path));
  expected.push('PACKAGE_MANIFEST.json', 'SHA256SUMS');
  checkTrackedPaths(expected);
  if (new Set(expected).size !== expected.length) throw new Error('mapping overwrites package member');
  const actual = payloadMembers(root);
  if (actual.length !== expected.length || actual.some((name) => !expected.includes(name))) {
    throw new Error('portable package inventory mismatch');
  }
  for (const row of manifest.files) {
    const bytes = readMember(extracted(row.path));
    if (bytes.length !== row.size_bytes || digest(bytes) !== row.sha256) {
      throw new Error(`original member bytes changed: ${row.path}`);
    }
  }
  const checked = new Set();
  for (const line of readMember('SHA256SUMS').toString('utf8').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match || checked.has(match[2]) || !originalNames.has(match[2]) && match[2] !== 'PACKAGE_MANIFEST.json') {
      throw new Error('invalid original checksum inventory');
    }
    if (digest(readMember(extracted(match[2]))) !== match[1]) throw new Error(`original checksum failed: ${match[2]}`);
    checked.add(match[2]);
  }
  if (checked.size !== originalNames.size + 1) throw new Error('original checksum membership mismatch');
  return { packageFiles: expected.length, mappedNames: Object.keys(mapping.paths).length };
}

export function verifyCheckout(repositoryRoot = ROOT) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  return { trackedPaths: checkTrackedPaths(paths), ...verifyPortablePackage(repositoryRoot) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(verifyCheckout(), null, 2));
}
