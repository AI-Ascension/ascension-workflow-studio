# 02 — Architecture and ownership

## Product repository

`AI-Ascension/ascension-workflow-studio` owns the React/TypeScript application,
UI state and document adapters, layout format, browser API client, presentation
components, browser tests, static bundle, and Studio operating documentation.

`AI-Ascension/sts2-harness` owns canonical workflow semantics, validation, runtime,
authenticated management operations, workflow registry, durable run state, and
additive web/draft adapters. Static serving is an adapter; application build tools
and UI source do not move into the Rust-only harness. No sibling implementation
imports or cross-checkout path dependencies.

`AI-Ascension/ascension-workflow` owns first-party catalog/conformance delivery.
Consume exported, digest-pinned definitions and fixtures rather than copying
unattributed implementations. `sts2-protocol` receives an artifact only through
its normal ownership/two-consumer admission, not as a convenient schema dump.
Gateway/MCP/mod retain their current authority. Browser endpoints never forward
arbitrary game routes. Watchdog may supervise approved process ownership but does
not acquire a Studio-driven gameplay action channel.

## Runtime topology

```text
Browser: Studio static bundle
  -> same-origin harness web/browser adapter
     -> existing definition/draft/management ports
     -> existing scheduler/action kernel -> MCP -> gateway -> mod -> host
  <- authenticated status/events/artifact projections
```

Static serving can run in the Phase-1 service or a separately supervised adapter
process if required by an existing architecture. It cannot own/restart/cancel
the gameplay scheduler or write the runtime database behind the owner's ports.
Default to the in-service adapter and justify any extra process in an ADR.

No application-level BFF with duplicated authorization, scheduler, command ledger,
or API translation database. A configured reverse proxy may route same-origin
paths; its role does not include execution decisions. UI code uses relative,
allowlisted paths, not arbitrary user-supplied upstream URLs.

## Five independent frontend state domains

1. Authenticated connection/capability state: session principal, support, server
   identity, API/registry digests, connection quality. Tokens remain in memory.
2. Authoring semantic document: actual canonical definition fields with stable IDs.
3. Presentation sidecar: positions, viewport, collapsed view groups and annotation
   display. It cannot contain guards, policy, runtime status, or execution cursors.
4. Live projection: owner status/events keyed by server, run, revision, sequence,
   node invocation and plan revision. No client scheduling.
5. Historical view: immutable pinned records with an explicit replay cursor and
   permanently disabled live commands until switching back to verified live mode.

A run overlay attaches to its exact definition digest. Viewing a newer draft or
another run must not reuse cached node status based on a coincidentally equal ID.

## Ports and artifacts

`DefinitionClient`, `RegistryClient`, `DraftClient`, `RunClient`, `CommandClient`,
`ArtifactClient`, and `SessionClient` are bounded browser adapters, not fictional
wire schemas. Derive them from the admitted operation map. Keep transport parsing,
domain adapters, visual projection, and components separate.

The harness owns persistence for Studio drafts through a narrow `AuthoringStorePort`
or the existing registry store API. Studio owns the sidecar schema; harness stores
its admitted bounded data beside the semantic draft with an atomic revision.
The engine never reads layout to decide execution. SQL/storage implementation
remains harness-local. Do not let the browser open a database/file path.

## Offline behavior

Offline editing/inspection may use already loaded, explicitly approved data. It
never publishes, starts runs, fabricates new live status, or queues hidden control
commands to send later. A crash-recovery draft buffer is opt-in, scoped to the
principal/workspace and bounded; server-backed draft persistence is mandatory.
