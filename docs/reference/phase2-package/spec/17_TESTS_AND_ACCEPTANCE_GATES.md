# 17 — Verification and release gates

## Evidence ladder

G0: package integrity — instruction files/fixtures/checksums only.
G1: source/unit/component — real Studio and owner adapter implementation tests.
G2: browser — real built application in supported engines, interaction/security/
visual/accessibility checks against explicit test boundaries.
G3: actual Phase-1 integration — exact implemented harness service, canonical
compiler/registry/store/command/event APIs with deterministic ports behind it.
G4: authorized native integration — only where separate host/provider/profile
permission exists; reuse exact compatible Phase-1 evidence with proper limits.
G5: release readiness/delivery — reproducible bundle/locks/docs/security review
and linked draft PRs. Deployment/merge are separate and not implied by G5.

Do not substitute G0 fixtures, a mock HTTP server, screenshots or an agent's prose
for G3. Phase-2 integrated functionality can be established with the real harness
and deterministic declared game/provider ports without launching a proprietary
host. Any broader native gameplay claim needs G4.

## Required suites

Unit: semantic/document adapters, guards/forms, edit history, ID remapping,
layout isolation, diff/conflict logic, event projection, command controller,
permission matrix and strict boundary decoders. Property tests for round-trip,
layout invariance, undo and replay chunk-order/dedup invariance.

Contract: every used operation against pinned Phase-1 artifacts and actual owner
validators. Validate both successful and error responses. Test old-client/profile
behavior for additive owner changes. Use current repo-policy, format, lint,
Rust tests, typecheck and copied-artifact checks.

Component/browser: actual canvas/list/forms keyboard and pointer editing,
immutable publication, drafts/autosave/conflicts, dynamic region, node details,
run controls, replay modes, loading/error/offline/unsupported states. Use Playwright
or the existing admitted equivalent; test Chromium, Firefox and WebKit where
supported. Record unavailable engines as unverified rather than calling Chromium
coverage universal.

Process: actual built static bundle and harness server on isolated loopback;
authentication, real durable drafts through restart, exact compiler round-trip,
workflow continuing after browser close, lost command receipt reconciliation,
server reconnect snapshot/cursors, session revocation, concurrent operators,
no-effect read/validate/replay and no duplicate mutations under UI repeat events.

Security/fault: execute every applicable `quality/fault-cases.json` entry; include
forged requests, origins/hosts, input injection, oversized data, parser chunk
splits, gaps, corruption, stale revisions, authority changes and slow clients.
No blanket retry of a failing E2E suite to hide flakiness.

Accessibility/visual: automated scans plus manual keyboard/single-pointer/
screen-reader/zoom assessment. Inspect actual sanitized screenshots at specified
viewports/themes. Do not assert complete WCAG conformance from axe alone [S04].

Performance: run bounded benchmark profiles and report percentile/count/units,
not unsupported speed claims. Reproduce suspected leaks with repeated lifecycle.

## Acceptance traceability

Each requirement links to a WP and named acceptance case. Each case records setup,
action, expected behavior, negative assertion and required evidence tier. Execution
records add actual test path/command, source heads/digests, exit code and artifact.
No default 'passed' statuses in seed templates. Blocked and unverified cases remain
in the final matrix with owner and next step.

An independent D3 verifier runs checks on the candidate commit. The D0/D1
integration owner reruns relevant gates on the exact combined candidate; disjoint
branch passes do not prove integrated compatibility. A late dependency/lock/schema
change invalidates affected evidence and requires rerun.

Browser names must match executed evidence. A Chromium-engine run does not by itself
prove branded Microsoft Edge compatibility, and Playwright WebKit is not an
installed Safari test. Record engine/browser version and distinguish actual
branded-browser checks from engine coverage.
