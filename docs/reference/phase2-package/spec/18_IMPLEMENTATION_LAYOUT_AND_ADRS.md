# 18 — Implementation layout and design decisions

## Proposed Studio layout

Adapt to existing admitted repository standards; do not create empty packages.

```text
apps/studio/src/
  app/                 routing, session shell, connection modes
  features/library/    templates, published revisions
  features/designer/   canvas, outline, forms, edit commands
  features/drafts/     autosave, conditional save, conflicts
  features/runs/       projections, inspector, command UX
  features/replay/     historical cursor, compare, replay reports
  features/compatibility/ capability and connection diagnostics
  components/          small reusable accessible presentation components
  workers/             parse/lint/layout jobs with bounded inputs
packages/contracts/    admitted generated types and boundary decoders
packages/document/     canonical/editor/layout adapters, no interpreter
packages/client/       declared API operations and validated transport
packages/testing/      explicit synthetic data and test utilities only
contracts/accepted/    producer artifacts, digests, provenance and operation map
tests/                 unit, property, contract, browser, process, fault suites
docs/                  architecture, security, compatibility, operations, evidence
```

Use exact package manager/runtime versions in lock/config files after live
verification. Do not force an outdated Node/Rust version from this package.
Keep pure adapters free from browser globals for testing. Rust web/store changes
belong in harness-owned modules with proper ports, not this TypeScript tree.

## Required ADRs before depending implementations

A01 Phase-1 artifact/API compatibility admission and additive change scope.
A02 Semantic edit model, layout sidecar, identity/canonicalization boundaries.
A03 Draft store ownership, conditional saves, raw text and publication transactions.
A04 Browser auth/origin model, token/session lifecycle and static hosting.
A05 Snapshot/event cursor, filtering/gap handling and command uncertainty.
A06 Node registry/forms, raw mode, protected composites and dynamic regions.
A07 Replay/historical modes and prohibition on live graph mutation.
A08 Accessible canvas/list parity, visual system and supported viewports/browsers.
A09 Toolchain/dependencies/licenses/CSP workers and performance envelope.
A10 Build artifact distribution, owner acceptance and non-deployment handoff.

ADRs must decide observable behavior and alternatives, identify owners, list tests
and unresolved assumptions, and bind to source artifacts. They cannot waive
non-bypassable execution safety or quietly delete required functionality.

## Standards

Follow current per-repository budgets and languages. TypeScript strict mode,
exhaustive discriminated unions, no `any` at hostile boundaries, typed failures,
bounded resources and explicit lifecycle cleanup. Generated sources carry
provenance/regeneration commands and exact exemptions. No catch-all `utils` or
`manager` modules. No unsafe HTML, arbitrary eval, production placeholders or
silent error-swallowing. Pin one owner for lockfiles, schema artifacts and shared
entrypoints; use narrow reviews for each change.
