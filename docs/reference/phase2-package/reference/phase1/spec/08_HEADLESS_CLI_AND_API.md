# 08 — Headless management: CLI, API, and operating semantics

## Placement and adapters

Implement the `sts2-workflow` CLI and a harness-owned management API/server adapter. Keep compiler/reducer logic shared and authoritative in Rust. The new delivery repository uses the built CLI/API as a client for conformance tests. Do not write a browser client or a second API-side scheduler.

Default API bind is authenticated loopback only. Reading secrets happens through the configured credential mechanism, never checked-in workflow files. Remote exposure, TLS/proxy infrastructure, and production deployment require separate authorization and are not phase-1 completion prerequisites.

## Process lifetime and ownership

The long-lived `serve` process owns workflow scheduling, the transactional store, management API, and declared runtime/provider child processes. `run` submits a validated definition or registered artifact and returns a durable run ID; it is not the lifetime owner of the gameplay task. Closing the submitting CLI or event client must not cancel an accepted workflow. Reconnecting with `status`/`events` reconstructs state from the service. A service restart uses the recovery admission contract before scheduling resumes.

A foreground synthetic fixture runner may compose the same engine for tests, but must not create different graph semantics or bypass the service's authority checks. `serve` must not take over gateway lifecycle ownership: gateway remains the authority for game instances; the harness owns only its declared MCP/provider children. Bounded shutdown accounts for accepted work and pending effects before releasing resources.

Installation as an OS service, deployment, proxy setup, or host restart is not authorized by implementing `serve`. Those remain separate operations.

## Required CLI surface

```text
sts2-workflow serve --listen <loopback-address> --store <local-path> --auth-profile <name>
sts2-workflow validate <definition.json> --capabilities <manifest.json>
sts2-workflow inspect <definition.json> --format json
sts2-workflow diff <old.json> <new.json> --format json
sts2-workflow run <definition.json> --instance <id> --profile <name>
sts2-workflow status <run-id> --format json
sts2-workflow events <run-id> --after-sequence <n> --limit <n>
sts2-workflow pause <run-id> --expected-revision <n>
sts2-workflow resume <run-id> --expected-revision <n>
sts2-workflow step <run-id> --expected-revision <n>
sts2-workflow cancel <run-id> --expected-revision <n>
sts2-workflow replay <run-id> --offline
sts2-workflow export <run-id> --redacted --output <approved-path>
```

These are proposed commands; finish their precise exit codes and schemas before implementation. Validate/inspect/diff/offline replay never launch a provider or game. `run` must explicitly distinguish synthetic versus live profiles and reject missing live permission/capability configuration.

Ship noninteractive JSON output plus readable summaries. Stable error classes should cover invalid input, incompatible capability, stale command revision, forbidden command, unresolved effect, unavailable service, exhausted budget, store failure, and replay divergence. Do not convert every error to exit code zero with an error-looking string.

## Proposed API

Use a versioned, bounded interface, for example:

```text
POST /v1/workflow-definitions/validate
POST /v1/workflow-runs
GET  /v1/workflow-runs/{run_id}
GET  /v1/workflow-runs/{run_id}/events?after_sequence=N&limit=N
POST /v1/workflow-runs/{run_id}/commands
GET  /v1/workflow-runs/{run_id}/artifacts/{artifact_id}
GET  /v1/capabilities
GET  /v1/health
```

Provide a resumable event stream or bounded polling over the same durable event sequence. Streamed delivery can duplicate; consumers deduplicate by run/sequence. Reconnection requests a durable cursor and gets an explicit gap/retention response when unavailable. Slow clients must not block gameplay or force unbounded in-memory buffering.

The status contract includes workflow/run/episode identity; definition and policy digest; current cursor and subworkflow stack summary; accepted plan revision; budget use/reservation; waiting reason; pending operation classification; authority/recovery capability; workflow status; game outcome; last progress sequence; and cleanup state. Filter sensitive fields for the caller's permission.

## Command semantics

Every write command has a unique command ID, expected run revision, authenticated actor scope, command kind, and bounded typed parameters. Duplicate same-ID/same-payload returns the existing outcome; conflicting reuse returns a conflict. Command acceptance and application are separate durable events. A reconnecting client can determine whether its command took effect without issuing a different one.

Pause closes admission and reports Pausing until in-flight safe operations settle or become explicitly unresolved. Resume verifies pinned artifacts, current authority, capabilities, budgets, and no unresolved effect. Step means one registered semantic unit; protected action nodes include reconciliation/settlement. Cancel does not undo state and cannot report safe terminal cancellation while effect uncertainty remains.

For v1, reject mutation commands that attempt to edit definitions in place, set the current cursor, skip a node, mark unknown work settled, force retry, lower hard policy, change a pending operation payload, switch a pinned version, or directly dispatch a game action.

An optional safe-point objective-update command needs an explicit ADR and same revision/budget controls. It is not required to support general live workflow migration.

## Security boundary

Authentication is required for control and sensitive read routes; loopback is not authentication. Verify authorization per run and action. Reject browser-origin requests by default; no wildcard CORS, no unauthenticated websocket, no bearer token in URLs or logs. Enforce body/header/time/connection limits, strict path parsing, no traversal/arbitrary local-file export, and safe content types.

Read-only diagnostics cannot gain write authority through nested payloads. Approval records are typed, actor-bound, one-use or scoped, revision-bound, and time-bounded; an AI-generated approval phrase is not an authenticated operator decision.

## Testing

Exercise service startup/shutdown, client disconnect with a continuing accepted run, reattachment, and the actual CLI binary and real loopback API processes with fakes behind declared runtime/provider ports. Test malformed bodies, duplicate commands, concurrent commands, stale revisions, auth failures, event reconnection/gaps, slow clients, process restart, stop during pending mutation, redaction, and zero game/provider calls from read/validate/replay commands.
