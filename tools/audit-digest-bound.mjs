/**
 * Inventory every tracked file whose bytes are pinned by a digest somewhere in
 * this repository, and classify each as byte-stable or line-ending exposed.
 *
 * Read-only audit helper used by the contract-pin portability work (Studio
 * #234). It deliberately records, for every pin, which record states the
 * digest, so a reviewer can see the provenance claim rather than infer it.
 *
 * Before this audit existed, none of these files carried a `.gitattributes`
 * entry, so an ordinary Windows checkout (`core.autocrlf=true`) rewrote their
 * line endings in the working tree and every recorded digest stopped matching.
 * `auditByteStability` is the enforcement: it asks Git for the effective
 * attributes of each tracked pinned file and refuses any text file that Git
 * would convert, so the fix cannot silently lapse when a pinned file is added.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LOCKS = [
  'contracts/accepted/phase1-integration.lock.json',
  'contracts/effective-limits.lock.json',
  'contracts/context-control-catalog.lock.json',
  'contracts/inference-profile-catalog.lock.json',
  'contracts/recorded-run-candidate/studio-pin.json',
  'history/recorded-run-candidate2/contracts/studio-pin.json',
];

const INVENTORIES = [
  { path: 'contracts/accepted/phase1/SHA256SUMS', base: '.' },
  {
    path: 'contracts/recorded-run-candidate/SHA256SUMS',
    base: 'contracts/recorded-run-candidate',
  },
  { path: 'docs/evidence/studio-bundle.SHA256SUMS', base: '.' },
  {
    path: 'history/recorded-run-candidate2/contracts/SHA256SUMS',
    base: 'history/recorded-run-candidate2/contracts',
  },
  { path: 'docs/reference/phase2-package/SHA256SUMS', base: 'docs/reference/phase2-package' },
];

/**
 * Inventories that are digest-bound in their own right but are not listed as a
 * member of any inventory, so they are rooted explicitly. Without this they
 * are unprotected text files that a Windows checkout rewrites -- and
 * `contracts/accepted/phase1/SHA256SUMS` in particular was enforced by nothing
 * at all. Rooting it here adds no digest and no member; it only brings the
 * file under the byte-stability gate, so the file a Windows checkout would
 * rewrite is never the file that says what the digests are.
 *
 * `contracts/recorded-run-candidate/SHA256SUMS` and
 * `docs/reference/phase2-package/SHA256SUMS` need no root: the former is pinned
 * by its own directory's `studio-pin.json` checksums map and the latter by
 * `docs/reference/phase2-portable-paths.json`, so both are already members.
 */
const roots = [
  'contracts/accepted/phase1/SHA256SUMS',
  'docs/evidence/studio-bundle.SHA256SUMS',
  'history/recorded-run-candidate2/contracts/SHA256SUMS',
];

export function collectPins() {
  const pins = new Map();
  const add = (path, source, sha256, note = '') => {
    if (!pins.has(path)) pins.set(path, []);
    pins.get(path).push({ source, sha256, note });
  };

  for (const lock of LOCKS) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(resolve(ROOT, lock), 'utf8'));
    } catch {
      continue;
    }
    for (const artifact of parsed.consumed_artifacts ?? []) {
      add(artifact.path, lock, artifact.sha256);
    }
    for (const source of parsed.producer_sources ?? []) {
      add(source.producer_path, lock, source.sha256, 'producer checkout, not this repository');
    }
    for (const [name, sha256] of Object.entries(parsed.checksums ?? {})) {
      add(
        `contracts/recorded-run-candidate/${name}`,
        lock,
        sha256,
        'checksums map, relative to contracts/recorded-run-candidate',
      );
    }
  }

  // The base is declared per inventory rather than guessed, so an inventory
  // cannot silently change its path convention and stop being resolved.
  for (const { path: inventory, base } of INVENTORIES) {
    if (roots.includes(inventory)) add(inventory, 'audit root', '', 'inventory file itself is digest-bound');
    for (const line of readFileSync(resolve(ROOT, inventory), 'utf8').split('\n')) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      if (!match) continue;
      const [, sha256, member] = match;
      add(base === '.' ? member : `${base}/${member}`, inventory, sha256,
        base === '.' ? 'repo-relative member path' : 'path relative to the inventory');
    }
  }

  return pins;
}

export function classify(bytes) {
  if (bytes.includes(0)) return { kind: 'binary', lineEndings: 'n/a' };
  if (bytes.includes(Buffer.from('\r\n'))) return { kind: 'text', lineEndings: 'CRLF' };
  return { kind: 'text', lineEndings: 'LF' };
}

/**
 * Read Git's *effective* `text` attribute for each path in one call.
 *
 * `git check-attr --all -z` is used rather than `git check-attr text` alone so
 * that a `!text` (`-text`) or `eol` declaration is visible either way. Git is
 * the authority on which files it would convert: replicating its rules in
 * JavaScript would be a second implementation that can disagree with the one
 * that actually rewrites the working tree.
 */
export function readEffectiveAttributes(repositoryRoot, paths) {
  const output = execFileSync(
    'git',
    ['check-attr', '--all', '-z', '--stdin'],
    { cwd: repositoryRoot, input: paths.map((path) => `${path}\0`).join('') },
  );
  const fields = output.toString('utf8').split('\0');
  const attributes = new Map();
  for (let index = 0; index < fields.length; index += 3) {
    const path = fields[index];
    if (path === undefined || path === '') break;
    const current = attributes.get(path) ?? {};
    current[fields[index + 1]] = fields[index + 2];
    attributes.set(path, current);
  }
  return attributes;
}

/**
 * A tracked pinned file is safe only if its bytes survive an ordinary Windows
 * checkout. That holds when either:
 *
 *   - Git is told not to convert it (`-text`, i.e. `text` set to `false`), so
 *     the working tree holds exactly the blob bytes the digest was taken from;
 *     or
 *   - Git is told to write it back out with LF (`text eol=lf`), which is
 *     byte-identical to the committed blob for any file committed with LF.
 *
 * Both are a *byte-stable* declaration, not a normalisation tolerance: the
 * recorded digest must still equal the digest of the working-tree bytes. This
 * gate therefore cannot approve a digest that was edited to match converted
 * bytes; it only ensures Git never performs that conversion in the first place.
 *
 * `text=auto` is deliberately rejected. It resolves per-file at checkout time
 * and would leave a future text file exposed unless Git happened to guess the
 * same way on every platform.
 */
export function isByteStable({ text, eol }) {
  if (text === 'unset') return true;
  return text === 'set' && eol === 'lf';
}

export function assertByteStable(exposed) {
  const problems = [];
  for (const { path, text, eol } of exposed) {
    if (text === 'set') {
      problems.push(
        eol === undefined
          ? `${path}: declared text with no eol, so a Windows checkout rewrites its line endings`
          : `${path}: declared text eol=${eol}, so the working tree holds ${eol} bytes, not the committed ones`,
      );
    } else if (text === 'string') {
      problems.push(`${path}: text=auto resolves per file at checkout time and is not byte-stable`);
    } else {
      problems.push(
        `${path}: no explicit text attribute, so core.autocrlf=true rewrites its line endings`,
      );
    }
  }
  return problems;
}

/**
 * Refuse a digest-bound text file that is *committed* with CRLF line endings.
 *
 * `-text` keeps such a file stable, so the attribute check alone would accept
 * it -- but a CRLF blob is exactly the failure #234 was about: it means the
 * recorded digest was taken from, or re-pinned to, converted bytes rather than
 * the canonical LF bytes this repository has always committed. Catching it here
 * means the escape of "convert the artifact and re-pin every record to match"
 * fails loudly instead of quietly rewriting provenance.
 *
 * This asserts the *convention*, not a digest: nothing is re-hashed and no
 * expected value is stored, so it cannot itself drift. A genuinely CRLF-native
 * contract would need this reviewed rather than worked around.
 */
export function assertCanonicalBytes(textRows) {
  const problems = [];
  for (const row of textRows) {
    if (row.lineEndings === 'CRLF') {
      problems.push(
        `${row.path}: committed with CRLF line endings, so its recorded digest describes converted bytes`,
      );
    }
  }
  return problems;
}

export function auditByteStability({ repositoryRoot = ROOT } = {}) {
  const tracked = new Set(
    execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  );
  const rows = audit({ repositoryRoot });
  const textRows = rows.filter((row) => row.tracked && row.kind === 'text');
  const attributes = readEffectiveAttributes(
    repositoryRoot,
    textRows.map((row) => row.path),
  );
  const exposed = [];
  for (const row of textRows) {
    const effective = attributes.get(row.path) ?? {};
    const text = effective.text ?? 'unspecified';
    const eol = effective.eol;
    if (!isByteStable({ text, eol })) exposed.push({ path: row.path, text, eol });
  }
  return {
    checked: textRows.length,
    binary: rows.filter((row) => row.tracked && row.kind === 'binary').length,
    exposed,
    problems: assertByteStable(exposed),
    nonCanonical: assertCanonicalBytes(rows.filter((row) => row.tracked && row.kind === 'text')),
    untrackedPins: rows.filter((row) => !row.tracked).map((row) => row.path),
  };
}

export function audit({ repositoryRoot = ROOT } = {}) {
  const tracked = new Set(
    execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  );
  const rows = [];
  for (const [path, pins] of collectPins()) {
    if (!tracked.has(path)) {
      rows.push({ path, tracked: false, pins });
      continue;
    }
    const { kind, lineEndings } = classify(readFileSync(resolve(repositoryRoot, path)));
    rows.push({ path, tracked: true, kind, lineEndings, pins });
  }
  rows.sort((left, right) => left.path.localeCompare(right.path));
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--verbose')) {
    const rows = audit();
    for (const row of rows) {
      const state = row.tracked ? `${row.kind}/${row.lineEndings}` : 'untracked';
      console.log(`${state.padEnd(12)} ${row.path}`);
      for (const pin of row.pins) {
        console.log(
          `             <- ${pin.source} ${pin.sha256.slice(0, 16)}…${pin.note ? ` (${pin.note})` : ''}`,
        );
      }
    }
  }
  const report = auditByteStability();
  if (report.untrackedPins.length > 0) {
    // A pin naming a file Git does not track cannot be enforced, so it is
    // reported rather than ignored; it means the audit's inventory is stale.
    console.log(`Untracked pinned paths (${report.untrackedPins.length}):`);
    for (const path of report.untrackedPins) console.log(`  ${path}`);
  }
  if (report.problems.length > 0) {
    console.error(
      `Line-ending exposed digest-bound files (${report.problems.length} of ${report.checked} tracked text files):`,
    );
    for (const problem of report.problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  }
  if (report.nonCanonical.length > 0) {
    console.error(
      `Digest-bound files committed with non-canonical line endings (${report.nonCanonical.length}):`,
    );
    for (const problem of report.nonCanonical) console.error(`  ${problem}`);
    process.exitCode = 1;
  }
  if (report.problems.length === 0 && report.nonCanonical.length === 0) {
    console.log(
      `Byte-stable: all ${report.checked} tracked text files pinned by a digest ` +
        `(` + `${report.binary} binary files are unaffected by line-ending conversion)`,
    );
  }
}
