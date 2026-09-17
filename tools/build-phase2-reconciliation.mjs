#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Build the Phase 2 requirement/acceptance reconciliation mapping (Studio #134;
// regenerated for Studio #1 ledger hygiene). Set RECONCILE_HEAD / RECONCILE_DATE
// to the reviewed Studio commit and review date when regenerating.
//
// Inputs (immutable, checked in):
//   docs/reference/phase2-package/quality/requirements.json
//   docs/reference/phase2-package/quality/acceptance-cases.json
//   docs/evidence/requirement-ledger.json
//   docs/evidence/acceptance-ledger.json
//   tools/phase2-owner-map.json
//
// Outputs:
//   docs/evidence/phase2-reconciliation.json
//   docs/evidence/PHASE2_RECONCILIATION.md
//
// This produces a projection only. It never changes the ledgers; ledger
// corrections are reviewed edits recorded directly in the ledger files.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

const requirementsSource = read("docs/reference/phase2-package/quality/requirements.json");
const acceptanceSource = read("docs/reference/phase2-package/quality/acceptance-cases.json");
const requirementLedger = read("docs/evidence/requirement-ledger.json");
const acceptanceLedger = read("docs/evidence/acceptance-ledger.json");
const ownerMap = read("tools/phase2-owner-map.json");

const requirementTitles = Object.fromEntries(
  requirementsSource.requirements.map((r) => [r.id, r]),
);
const acceptanceDefs = Object.fromEntries(
  acceptanceSource.cases.map((c) => [c.id, c]),
);
const requirementStatus = Object.fromEntries(
  requirementLedger.requirements.map((r) => [r.id, r]),
);
const acceptanceStatus = Object.fromEntries(
  acceptanceLedger.cases.map((c) => [c.id, c]),
);

const RESOLVED = new Set(["evidenced"]);

function disposition(workPackage) {
  return ownerMap.workPackages[workPackage] ?? ownerMap.default;
}

function ownerFor(acceptanceCase) {
  const explicit = ownerMap.cases[acceptanceCase.id];
  return explicit ?? disposition(acceptanceCase.work_package);
}

const cases = acceptanceLedger.cases
  .map((ledgerCase) => {
    const def = acceptanceDefs[ledgerCase.id];
    const requirement = requirementStatus[def.requirement_ids[0]];
    const owner = ownerFor(def);
    const resolved = RESOLVED.has(ledgerCase.status);
    return {
      acceptanceId: def.id,
      requirementId: def.requirement_ids[0],
      requirementTitle: requirementTitles[def.requirement_ids[0]]?.title ?? null,
      workPackage: def.work_package,
      requiredEvidenceTier: def.required_evidence_tier,
      plannedTestName: def.planned_test_name,
      setup: def.setup,
      action: def.action,
      expected: def.expected,
      negativeAssertion: def.negative_assertion,
      acceptanceStatus: ledgerCase.status,
      requirementStatus: requirement?.status ?? null,
      evidence: ledgerCase.evidence ?? null,
      actualCommand: ledgerCase.actual_command ?? null,
      actualSourceHeads: ledgerCase.actual_source_heads ?? {},
      owner: resolved ? null : owner.owner,
      ownerKind: resolved ? "completed" : owner.kind,
      ownerNote: owner.note,
    };
  })
  .sort((a, b) => a.acceptanceId.localeCompare(b.acceptanceId));

const statusCounts = (values) =>
  values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

const ownerGroups = {};
for (const c of cases) {
  if (c.owner) {
    ownerGroups[c.owner] = ownerGroups[c.owner] ?? { owner: c.owner, kind: c.ownerKind, note: c.ownerNote, cases: [] };
    ownerGroups[c.owner].cases.push(c.acceptanceId);
  }
}

const report = {
  schema_version: 1,
  source: "docs/reference/phase2-package/quality/{requirements,acceptance-cases}.json",
  source_commit: process.env.RECONCILE_HEAD ?? "f2fe5bc053b17491a00283f9f73b7bb392a0ceff",
  reviewed_at: process.env.RECONCILE_DATE ?? "2026-09-17",
  requirement_counts: statusCounts(requirementLedger.requirements.map((r) => r.status)),
  acceptance_counts: statusCounts(acceptanceLedger.cases.map((c) => c.status)),
  unresolved_by_owner: Object.values(ownerGroups).sort((a, b) =>
    a.owner.localeCompare(b.owner),
  ),
  cases,
};

writeFileSync(
  resolve(root, "docs/evidence/phase2-reconciliation.json"),
  JSON.stringify(report, null, 2) + "\n",
);

const line = (c) => {
  const state = c.owner ? `${c.acceptanceStatus} → ${c.owner}` : c.acceptanceStatus;
  return `| ${c.requirementId} | ${c.acceptanceId} | ${c.workPackage} | ${c.requiredEvidenceTier} | ${state} |`;
};

const EXPLICIT_COVERAGE = [
  {
    area: "Host auth / CSP / static host / security (AT-079/080/093/100/102/107)",
    disposition:
      "Unresolved. Owner-side authorization, safe text/import handling and the same-origin boundary are implemented and unit-tested in Studio, but production CSP/static-host headers, hostile-origin/rebinding rejection and independent security review are outside this repository. Owner: Studio #1 remaining security task and Studio #108.",
  },
  {
    area: "Screenshot / accessibility (AT-103/104/105)",
    disposition:
      "Unresolved. Automated styles, focus visibility and reduced-motion handling are implemented; the required real-build screenshot matrix, manual screen-reader/pointer assessment and exact-build retest remain manual acceptance. Owner: Studio #1 remaining accessibility task.",
  },
  {
    area: "Performance (AT-089 / PERF-01-08)",
    disposition:
      "Partial. A committed production-build benchmark measures the 250-node/500-edge workload; the recorded WebKit edit p95 of 335 ms is retained against the 100 ms target. PERF-08 (232,677 gzip bytes of core-route JavaScript against 1,500,000) and PERF-03 (the 1000/2000 input is not admitted; measured at the admitted 256x1024 ceiling, first-useful-render p95 2147.2 ms Chromium / 2780 ms Firefox against 5000 ms, local headless run) were recorded on 2026-09-17 in docs/evidence/benchmark-results.json. PERF-04-07 remain unmeasured because no owner stream is admitted. Do not label the WebKit PERF-02 result passed. Owner: Studio #1 remaining performance task.",
  },
  {
    area: "Final combined-head / mandatory-ledger / lineage (AT-115/116/117)",
    disposition:
      "Partial. This reconciliation supplies the criterion-to-evidence mapping (AT-116, evidenced; Studio #134 closed through PR #135). A combined-head verification is recorded for AT-115 (Studio validation run 35251289403 at f2fe5bc053b17491a00283f9f73b7bb392a0ceff with the pinned owner a42b6419, gateway 8940fba and MCP f3b6eaa heads, all six jobs passed) but the heads are not yet declared final and the independent security review remains open, so AT-115 is partial. Native lineage/model/worker closure (AT-117) requires the authorized orchestration environment. Owner: Studio #1.",
  },
];

const CORRECTIONS = [
  "2026-09-17 (Studio #1 ledger hygiene at f2fe5bc053b17491a00283f9f73b7bb392a0ceff): AT-116/P2-116 blocked → evidenced/implemented. The case expects the 120-entry mapping, which this reconciliation supplies and `tools/verify-phase2-reconciliation.test.mjs` enforces in CI (Studio validation run 35251289403); the prior row text conflated mapping with resolution.",
  "2026-09-17: AT-115/P2-115 blocked → partial. Studio validation run 35251289403 verified the combined heads (Studio f2fe5bc0, owner a42b6419, gateway 8940fba8, MCP f3b6eaa8) in one integrated run of all six jobs; the heads are not yet declared final and the independent security review remains open.",
  "2026-09-17: AT-040 partial → evidenced. The browser tier is covered on Chromium, Firefox and WebKit by `tests/browser/studio.spec.ts` (malformed-JSON retention/repair, duplicate-key rejection, unsupported-import archival) in run 35251289403; the prior partial stated no residue.",
  "2026-09-17: AT-027 and AT-055 stay partial with their residue now stated explicitly; AT-027 no longer claims browser publication evidence is unavailable (run 34633623345 verified it). AT-089 stays partial with PERF-08 and PERF-03 (at the admitted 256x1024 ceiling; 1000/2000 not admitted) recorded in `docs/evidence/benchmark-results.json`; the residue is PERF-02 on WebKit and PERF-04-07.",
  "Acceptance ownership (2026-09-15 review): `implemented` cases are no longer treated as resolved. AT-026/AT-034/AT-036/AT-047/AT-053/AT-054 are implemented in source but their required `phase1_process`/`browser` evidence tier is not demonstrated, so they retain an owner for outstanding verification instead of being recorded as completed. Only `evidenced` acceptance is ownerless.",
  "AT-091/AT-092 (P2-091/P2-092): blocked → partial. Later merged CI (`.github/workflows/validate.yml`) runs real Chromium/Firefox/WebKit journeys and an authenticated job against the pinned real owner; the prior 'engines and attached owner process are not yet available' statement was stale.",
  "AT-097 (P2-097): blocked → evidenced/implemented. The lost-save/publication/command and concurrent-editor tests are merged in `tests/browser/live-owner.spec.ts` and run against the pinned real owner process.",
  "AT-112 (P2-112): blocked → evidenced. `.github/workflows/validate.yml` is configured and green on main; the requirement was already recorded implemented, so the blocked case was a stale contradiction.",
  "AT-113/AT-114 (P2-113/P2-114): blocked → partial. Contract-pin verification and sanitized CI diagnostics are now configured; generated-client regeneration and exact per-run failure reproducibility remain open.",
];

const md = [];
md.push("# Phase 2 requirement and acceptance reconciliation");
md.push("");
md.push(
  "Generated by `node tools/build-phase2-reconciliation.mjs` (#134). This is a projection",
);
md.push(
  "over the original package and the two evidence ledgers; it does not redefine a status.",
);
md.push("");
md.push("## Summary");
md.push("");
md.push(`- Source package reviewed at Studio \`${report.source_commit}\` on ${report.reviewed_at}.`);
md.push(`- Requirement ledger: ${JSON.stringify(report.requirement_counts)} (of ${requirementLedger.requirements.length}).`);
md.push(`- Acceptance ledger: ${JSON.stringify(report.acceptance_counts)} (of ${acceptanceLedger.cases.length}).`);
md.push(
  "- Only `evidenced` entries are resolved. `implemented`, `partial` and `blocked` entries keep an owner below, because implementation alone does not satisfy the case's required evidence tier.",
);
md.push(
  "- Every entry keeps its original stable id, requirement link and required evidence tier; unavailable evidence is not labelled passed.",
);
md.push("");
md.push("## Preserved completed increments");
md.push("");
md.push(
  "AT-046/P2-046 (owner-restart draft persistence) remains evidenced/implemented from Studio PR #130 (`b26a2707cfdc99152064dca83b63e69d99aabfb8`). All other resolved entries in the ledgers are preserved unchanged.",
);
md.push("");
md.push("## Evidence-backed corrections (2026-09-15 and 2026-09-17)");
md.push("");
for (const c of CORRECTIONS) md.push(`- ${c}`);
md.push("");
md.push("## Explicit coverage for the named acceptance groups");
md.push("");
for (const c of EXPLICIT_COVERAGE) {
  md.push(`### ${c.area}`);
  md.push("");
  md.push(c.disposition);
  md.push("");
}
md.push("## Unresolved mandatory criteria by owner");
md.push("");
for (const group of report.unresolved_by_owner) {
  md.push(`- **${group.owner}** (${group.kind}) — ${group.note}`);
  md.push(`  - ${group.cases.join(", ")}`);
}
md.push("");
md.push("## Complete mapping");
md.push("");
md.push("| Requirement | Case | WP | Required tier | Current state → owner |");
md.push("|---|---|---|---|---|");
for (const c of cases) md.push(line(c));
md.push("");

writeFileSync(resolve(root, "docs/evidence/PHASE2_RECONCILIATION.md"), md.join("\n"));
console.log(
  `reconciliation: ${cases.length} cases, ${report.unresolved_by_owner.length} owner groups`,
);