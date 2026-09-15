import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));

const requirements = read('docs/reference/phase2-package/quality/requirements.json').requirements;
const acceptance = read('docs/reference/phase2-package/quality/acceptance-cases.json').cases;
const requirementLedger = read('docs/evidence/requirement-ledger.json');
const acceptanceLedger = read('docs/evidence/acceptance-ledger.json');
const ownerMap = read('tools/phase2-owner-map.json');
const reconciliation = read('docs/evidence/phase2-reconciliation.json');

const count = (values) =>
  values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

test('every requirement and acceptance case is present exactly once', () => {
  assert.equal(requirements.length, 120);
  assert.equal(acceptance.length, 120);
  assert.equal(requirementLedger.requirements.length, 120);
  assert.equal(acceptanceLedger.cases.length, 120);
  assert.equal(new Set(requirements.map((r) => r.id)).size, 120);
  assert.equal(new Set(acceptance.map((c) => c.id)).size, 120);

  const knownCases = new Set(acceptance.map((c) => c.id));
  for (const requirement of requirements) {
    assert.ok(requirement.acceptance_cases.length > 0, `${requirement.id} has no case`);
    for (const id of requirement.acceptance_cases) {
      assert.ok(knownCases.has(id), `${requirement.id} references unknown ${id}`);
    }
  }
});

test('requirement and acceptance ledgers agree with the source package', () => {
  const sourceRequirements = new Set(requirements.map((r) => r.id));
  const sourceCases = new Set(acceptance.map((c) => c.id));
  assert.deepEqual(
    requirementLedger.requirements.map((r) => r.id),
    requirements.map((r) => r.id),
  );
  assert.deepEqual(
    acceptanceLedger.cases.map((c) => c.id),
    acceptance.map((c) => c.id),
  );
  for (const entry of requirementLedger.requirements) assert.ok(sourceRequirements.has(entry.id));
  for (const entry of acceptanceLedger.cases) assert.ok(sourceCases.has(entry.id));
});

test('ledger status summaries are recomputed from their records', () => {
  assert.deepEqual(
    requirementLedger.status_summary,
    count(requirementLedger.requirements.map((r) => r.status)),
  );
  assert.deepEqual(
    acceptanceLedger.status_summary,
    count(acceptanceLedger.cases.map((c) => c.status)),
  );
});

test('every unresolved acceptance case has an owner', () => {
  for (const entry of acceptanceLedger.cases) {
    if (entry.status === 'implemented' || entry.status === 'evidenced') continue;
    const def = acceptance.find((c) => c.id === entry.id);
    const owner = ownerMap.cases[entry.id] ?? ownerMap.workPackages[def.work_package] ?? ownerMap.default;
    assert.ok(owner && owner.owner, `${entry.id} has no owner`);
    assert.ok(owner.note && owner.note.length > 0, `${entry.id} owner has no note`);
  }
});

test('the reconciliation projection covers every requirement and case', () => {
  assert.equal(reconciliation.cases.length, 120);
  assert.deepEqual(
    reconciliation.cases.map((c) => c.acceptanceId),
    [...acceptance.map((c) => c.id)].sort(),
  );
  assert.deepEqual(
    count(reconciliation.cases.map((c) => c.acceptanceStatus)),
    acceptanceLedger.status_summary,
  );
  assert.deepEqual(
    count(requirementLedger.requirements.map((r) => r.status)),
    reconciliation.requirement_counts,
  );
});

test('resolved cases carry no owner and unresolved cases do', () => {
  for (const entry of reconciliation.cases) {
    const resolved = entry.acceptanceStatus === 'implemented' || entry.acceptanceStatus === 'evidenced';
    if (resolved) {
      assert.equal(entry.owner, null, `${entry.acceptanceId} resolved but owned`);
      assert.equal(entry.ownerKind, 'completed');
    } else {
      assert.ok(entry.owner, `${entry.acceptanceId} unresolved but unowned`);
    }
  }
});