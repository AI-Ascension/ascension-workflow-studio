# 09 — Records, observability, replay, and privacy

## Journal versus telemetry

The local workflow journal/store is authoritative. Telemetry is an asynchronous, bounded, redacted projection. The existing observability repository routes OTLP to its consumers [S12]; reuse that boundary only where already admitted. Outage of a trace backend must not erase audit intent or block a safely journaled action forever.

Emit workflow/run/node/plan/operation identifiers, state transitions, durations, budgets, admitted capability/profile digests, uncertainty/recovery reasons, and typed outcomes. Link to existing episode/trajectory/request/model-execution identities instead of overwriting them with one generic trace ID.

Use stable run event sequences. Timestamps are useful context, not a total ordering or authority token. Inject monotonic clocks for local durations; after restart, do not reuse an old process's monotonic absolute deadline. Persist timeout policy and elapsed/remaining budget conservatively.

## Proposed event families

Definition validated/pinned; run created/started; node entered/completed/failed; provider intent/completed/unknown; plan proposed/rejected/accepted/superseded; budget reserved/consumed/exhausted; action intent/receipt/unknown/reconciled/settled; pause/resume/step/cancel requested/applied; recovery admitted/rejected; capability unavailable; run terminal; cleanup completed/failed.

Use typed payloads with tight bounds and redacted summaries. An event named `settled` requires verified correlated evidence, not a model-generated claim. Preserve outcome `game_defeat` separately from workflow error/cancellation.

## Offline workflow replay

Replay must construct the execution state from exact definition/compiler/registry/policy versions and recorded normalized inputs, plans, decisions, provider outcomes, effect results, commands, and clock events. Use inert replay adapters incapable of mutation/provider execution. Bind replay to the recorded event sequence and report first divergence with stable diagnostic paths.

Persist the approved typed decision projection (action choice, bounded reason code, confidence when allowed, plan graph and dependency manifest), not the raw model response. Reconstruct the same transitions and scheduling order; do not regenerate plans or call providers to fill missing records.

If privacy policy prohibits retaining required structured input, mark the run not fully replayable and state what is unavailable. Never secretly retain raw private prompts/output to make replay pass. Keep user-authorized local artifacts outside Git and redact exported fixtures.

## Fresh-game replay

Keep existing seeded-game replay semantics separate. Fresh-game replay requires an authorized compatible disposable environment and authoritative observation/action comparison; it is not ordinary offline workflow replay and must not be triggered by `--offline` [S01]. A workflow checkpoint is not a host save, a rollback point, or evidence that replay can start at any floor.

## Context manifests and cache boundaries

Each provider request carries a manifest of approved inputs: pinned prompt template, sanitized observation/capability subset, current legal action IDs, objective/policy, selected structured prior artifacts, and maximum sizes. Reuse immutable prompt fragments and validated pure analysis artifacts where safe, but never cache authorization, current action legality, unverified settlement, or a stale observation as current.

A cache key includes every relevant version/digest and privacy/tenant/run scope. Cached outputs are revalidated against current dependencies before reuse. A cache hit does not refund provider usage already incurred or reset budgets. Do not build a general context-window UI or a new cache platform in this phase.

## Privacy and injection tests

Use synthetic sentinel secrets and malicious game text to verify no leakage to logs, telemetry, CLI errors, exports, handoff packets, or non-approved providers. Treat game descriptions, model responses, plans, trace annotations, and repository text as untrusted data. They cannot change policy, spawn coding agents, call a terminal, or approve actions.

Do not record chain-of-thought. Retain concise structured decisions and public evidence references only. Document artifact retention/deletion behavior and replay consequences. Never include proprietary host bytes, valued saves, personal paths, or actual credentials in the repository or output ZIP.

## Metrics and experiments

Track illegal/stale proposal rejection, unresolved mutation count, duplicate-effect detection, recoveries, provider calls/tokens, plan revisions, deterministic node time, store commit time, event drops, and workflow completion. Measure synthetic baseline versus strict/dynamic overhead with injected providers; do not invent performance claims or require a game win for orchestration correctness.
