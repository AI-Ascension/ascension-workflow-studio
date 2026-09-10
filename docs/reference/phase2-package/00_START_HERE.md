# Start here — Ascension Workflow Studio / Phase 2

## Execute this package

Give the root coding agent the full extracted package and this instruction:

```text
Read <PACKAGE_DIR>/00_START_HERE.md and then execute
<PACKAGE_DIR>/01_MASTER_ORCHESTRATION_PROMPT.md in full.
Assume Phase 1 is implemented. Discover and pin its actual exported contracts;
do not reimplement its workflow engine or replace its authoritative validator.
Create or safely resume AI-Ascension/ascension-workflow-studio and complete
Phase 2: visual strict/dynamic workflow authoring, durable draft/version handling,
live inspection and safe controls, replay/debugging, accessibility, integration,
independent verification, and linked draft-PR delivery.
Use the required D0 -> D1 -> D2 -> D3 Luna Max hierarchy with real parentage.
Do not stop at plans, scaffolding, schemas, a canvas demo, or mock-only tests.
```

`<PACKAGE_DIR>` is the absolute path to this extracted directory in the coding
agent's environment. It is the only location placeholder needed to start.
Discover repository paths, runtime addresses, versions, and artifact IDs from
that environment; do not transplant paths from an earlier chat.

## Fixed scope

Create **AI-Ascension/ascension-workflow-studio** as the visual product repository.
`sts2-harness` remains the only workflow execution/validation/management authority.
`ascension-workflow` remains the Phase-1 delivery/catalog/conformance owner.
The new Studio imports their pinned contracts and calls their admitted APIs.
Phase 1 is an assumed dependency, not an invitation to restart its implementation.
Only minimal, backward-compatible, owner-reviewed browser/draft integration
additions are permitted in existing owners.

Three levels deep means three descendant levels below the root, consistent with
Phase 1: D0 root; D1 leads; D2 work-package coordinators; D3 specialists. All
D1-D3 agents use `gpt-5.6-luna` with reasoning effort `max`; no D3 spawning.
Installed-client/model availability and actual lineage must be checked. This
archive itself has not spawned agents or configured the executing runtime.

## Reading order

Start with the master, `spec/01_SCOPE_AND_PHASE1_ADMISSION.md`,
`spec/02_ARCHITECTURE_AND_REPOSITORY_BOUNDARIES.md`, the orchestration policies,
`orchestration/tasks.json`, and `quality/requirements.json`. Each work packet
then names the specialist specification and tests that apply to it.

The `reference/phase1/` files are byte-preserved design-package references.
They are **not evidence that Phase 1 was implemented with those exact schemas**.
Current exported owner contracts take precedence. The Studio seed contracts in
`contracts/` are design inputs to reconcile, not a competing runtime protocol.

## Package-only checks

```text
python tools/verify_package.py
python -m unittest discover -s tools -p 'test_*.py' -v
```

Run these from this directory. Full JSON Schema validation requires the version
of `jsonschema` listed in `tools/requirements.txt`. The validator clearly fails
when that dependency is missing. Product acceptance uses actual Rust/TypeScript
builds, browser tests, and an implemented Phase-1 service, not these scripts.

Read `BUILD_VERIFICATION.md` for what was actually checked while packaging.
