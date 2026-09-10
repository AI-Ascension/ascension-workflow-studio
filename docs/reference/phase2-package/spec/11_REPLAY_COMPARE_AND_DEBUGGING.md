# 11 — Replay, comparison, and debugging

## Three modes that must never be conflated

**Live inspection** displays current authoritative runtime status and permits
supported commands only with current authorization and state.

**Historical inspection** reads retained events/snapshots/artifacts with a UI-only
cursor. Scrubbing, stepping display events and jumping to nodes send no runtime
mutation/provider/game requests.

**Offline workflow replay** invokes the implemented Phase-1 replay capability on
approved retained inputs, with zero game/provider calls. The browser presents its
result and divergence report; it does not execute a second replay engine.

Fresh-game replay is a separate existing runtime operation requiring explicit
live permission. It is not required to make the historical UI useful and must
not be triggered by a Replay button without distinct labeling and confirmation.
No mode can rewind game state or resume from an arbitrary visual node.

## Timeline and details

Display run-scoped events grouped by node invocation/plan/operation/command.
Allow filtering by phase, event kind, error/recovery, and correlation IDs. Use
virtualized pagination with a bounded in-memory window. Show missing retention
ranges and redaction explicitly; do not synthesize omitted transitions.

Cursor position must identify a consistent recorded cut. Unavailable projection
information remains unknown. If the owner supplies snapshots, reuse them to avoid
unbounded replay from event zero. UI step-forward changes only the display cursor;
call it 'Next recorded event' or 'Next invocation', not 'Execute next'.

## Comparison

Compare definition revisions (semantic and layout diff) separately from run
projections. Align run events by stable semantic identity plus invocation context,
not equal timestamps or list indexes. Report unmatched paths and plan changes.
Do not label a different model or seed result a causal improvement from a graph edit.

Backend replay results include source digest, replay engine/schema revision,
approved-input identity, divergence location and unavailable evidence. Display
what is confirmed without extrapolating to native host determinism. A redacted
record may legitimately be non-replayable.

## Debug controls and breakpoints

A local historical bookmark is presentation-only. A live breakpoint is optional
only where Phase 1 exposes a safe authenticated pause-at-boundary operation with
revision semantics. Otherwise offer manual Pause and historical bookmarks, not
a browser hook that pretends to stop the engine between dispatch and settlement.
Never mutate state via 'Set next node', 'Skip error' or 'Mark success'.

## Export and retention

Export a bounded sanitized replay/support bundle via owner artifact APIs, with
origin, versions, digests and retention limitations. Browser filenames are safe
and links cannot request arbitrary filesystem reads. No screenshots or raw JSON
with secrets in shared test evidence. Revoke auth/clear cached projections on
account change; a browser Back action cannot reveal a previously forbidden run.
