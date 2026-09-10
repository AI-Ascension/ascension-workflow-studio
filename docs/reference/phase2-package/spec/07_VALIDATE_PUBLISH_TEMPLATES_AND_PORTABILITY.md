# 07 — Validation, publication, templates and portability

## Publication is not execution

A publish action validates and registers one immutable definition revision through
the Phase-1 owner. It does not start a run, invoke a provider, mutate a game, commit
a repository or release software. A Run dialog is separate and selects the exact
published digest, admitted instance/profile, applicable policy and capability
snapshot, budget and explicit confirmation when live effects are possible.

The draft revision sent for validation is bound to all results. Publishing checks
that candidate, registry/policy/capability expectations and user permission remain
valid. Never enable Run because a previous draft was valid or the canvas looks
connected. The backend performs current capability/authority admission again.

## Publish transaction and uncertain response

Use the actual owner API, conditional revision and idempotency contract. Record a
stable command/publication identity before sending where the owner supports it.
Resolve a lost response by querying the publication result/registry binding; do
not create a fresh version merely to see whether it succeeds. When resolution
is unavailable, show unknown and require a deliberate refresh/review.

An already published definition is read-only. Editing creates a new draft based
on its reference. Existing runs stay pinned. Rollback chooses a previous admitted
revision for a new run; it does not rewrite old runs or undo game state.

## Templates and reusable subworkflows

Browse pinned `ascension-workflow` catalog artifacts with origin, version, license,
capability requirements and evidence status. Clone a template into a new draft
with provenance; do not modify the upstream artifact or replace stable IDs
unnecessarily. Resolve reusable subworkflows by exact version/digest and typed
input/output bindings. Show unavailable or unsupported references explicitly.

Ship practical authoring journeys using existing campaign, combat, map, shop,
selection and failure-handling templates, capability-gated to the actual runtime.
Do not claim every expert-state research item is implemented. Studio exposes
what Phase 1 supports, not a fictional universal game workflow library.

## Import/export contract

Mandatory import/export is bounded UTF-8 JSON: canonical Phase-1 definitions and
a versioned Studio document bundle containing definition plus inert layout and
provenance. The bundle is not executable until the definition is extracted and
validated by the owner. Export with safe filenames and browser download APIs;
never accept an arbitrary server filesystem path from the browser.

No required archive or remote-URL importer. If archive/YAML support is added,
strict size/path/compression/alias checks and an ADR are required; it must not
block Phase-2 delivery. Reject executable payloads, prototype keys where unsafe,
remote schema refs, external asset loads, duplicate keys and unsupported versions.
Use a preview with named semantic differences, permissions and capability status.

## Diff and compare

Offer independent semantic, layout and run-outcome differences. Semantic diff
uses canonical stable identities and actual owner order/default rules. Report
node/edge/guard/config/policy/budget/pinned-ref changes. A layout-only diff must
not be labeled a strategy change. Comparing two runs is descriptive evidence,
not causal proof that a graph edit improved gameplay.
