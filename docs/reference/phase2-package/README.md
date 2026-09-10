# Ascension Workflow Studio — Phase 2 meta-prompt package

**Target repository:** `AI-Ascension/ascension-workflow-studio`  
**Dependency:** assume Phase 1 is implemented; discover its real exported contracts.  
**Runtime owner:** `AI-Ascension/sts2-harness` remains authoritative.  
**Delivery:** complete implementation and linked draft PRs, not auto-merge or deployment.

## Start

Read [00_START_HERE.md](00_START_HERE.md), then execute the
[master orchestration prompt](01_MASTER_ORCHESTRATION_PROMPT.md).
This archive contains instructions and package-only validation tools, not an
implemented Studio. It does not attest that any implementation agent was launched.

## Product to implement

A React/TypeScript visual workbench for strict workflows and bounded adaptive
regions: typed graph authoring, equivalent non-canvas editing, durable drafts and
conflict resolution, canonical validation/publishing, live inspection and safe
controls, offline replay/compare, plan overlays, and production static packaging.

The Studio does not choose game actions independently, run a second scheduler,
patch a live workflow graph, override settlement, or bypass MCP/gateway authority.
Browser and draft integration belongs in small owner-reviewed harness adapters;
Phase 1 is not recreated in this repository. No cloud service or paid editor
component is required. Current dependency/toolchain versions are pinned during
actual implementation, not guessed in this archive.

## Orchestration

```text
D0 Root implementation orchestrator
 └─ D1 Luna Max workstream lead
     └─ D2 Luna Max work-package coordinator
         ├─ D3 Luna Max implementation specialist
         └─ D3 Luna Max independent verification specialist
```

All descendants request `gpt-5.6-luna` with reasoning effort `max`. Verify actual
runtime acceptance/effective configuration and parentage. Do not confuse desired
configuration with evidence that it ran. D3 never spawns. Use at most 12 live
descendants globally or the lower client limit; do not bypass depth restrictions.

## Navigation

| Area | Main entry | Contents |
|---|---|---|
| Mission | [Master prompt](01_MASTER_ORCHESTRATION_PROMPT.md) | Full execution sequence and completion gates |
| Architecture | [Scope/admission](spec/01_SCOPE_AND_PHASE1_ADMISSION.md) | 19 focused engineering specifications |
| Delegation | [Hierarchy](orchestration/01_HIERARCHY_AND_SCHEDULING.md) | Eight workstreams, D0–D3 policy, preflight and handoffs |
| Task graph | [Work packages](orchestration/tasks.json) | 40 dependency-linked work packages |
| Traceability | [Requirement map](quality/TRACEABILITY.md) | 120 mandatory requirements and 120 acceptance cases |
| Failure testing | [Fault cases](quality/fault-cases.json) | 48 explicit failure/security scenarios |
| Operator journeys | [End-to-end journeys](quality/user-journeys.md) | 12 complete authoring/inspection/control journeys |
| Performance | [Benchmark targets](quality/benchmarks.json) | Eight bounded benchmark scenarios; not measurements |
| Contracts | [Seed admission notes](contracts/README.md) | Layout/display/attestation seeds and 20 logical API needs |
| Examples | [Fixture guide](examples/README.md) | 24 Studio fixtures plus four preserved Phase-1 seed checks |
| Role prompts | [D1 lead](prompts/DEPTH1_LEAD.md) | Lead, coordinator, implementer, independent review and continuation |
| Sources | [Evidence limits](sources/SOURCES.md) | Primary documentation and byte-bound Phase-1 references |
| Package verification | [Tool guide](tools/README.md) | Offline checks, 34 checker unit tests and checksum inventory |
| Packaging evidence | [Build verification](BUILD_VERIFICATION.md) | What was checked and what remains product work |

Five Mermaid sources in `diagrams/` describe ownership, delegation, authoring,
event recovery, and live/history separation. They are architecture documentation,
not rendered screenshots or runtime evidence.

## Required implementation outcomes

The implementing agents must deliver usable production code, actual Phase-1
integration tests, accessible editing and monitoring journeys, durable draft
recovery, security tests, clean resource shutdown, documentation and independently
reviewed exact-head delivery. A mock server, static canvas demo, schema, screenshot,
plan or passing package checker is insufficient.

Unknown owner capabilities must remain explicit. Tests requiring ungranted game,
provider, deployment or external-network permissions are reported as blocked or
unverified without preventing unrelated safe implementation work. Completion,
runtime evidence, orchestration compliance, and release/deployment status are
reported separately.
