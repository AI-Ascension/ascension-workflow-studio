# 15 — Performance, bounded resources, and lifecycle

## Workload envelope

Use the Phase-1 maximum graph bounds as the authoritative ceiling; the Studio
must handle admitted definitions or explicitly decline unsupported size before
misrepresenting them. Proposed benchmark targets are in `quality/benchmarks.json`.
They are engineering acceptance targets, not measured capabilities or promises.
If owner bounds are lower, test at those bounds and document the narrowed envelope.

Benchmark cold load, graph parse/import, first useful render, edit response,
typed validation, worker layout, large run timeline, stream bursts, resnapshot,
repeat open/close and prolonged idle/active sessions. Record exact hardware/OS,
browser/runtime versions, build mode, data sizes and sampling method.

## Implementation patterns

Normalize semantic entities and use targeted subscriptions/selectors. Keep node
and edge renderers stable; memoize where measurements justify it. Do not re-render
all canvas nodes for every event or keystroke. Separate editing state from runtime
overlay and authoring history. Use bounded history and virtualized lists/timelines.

Move large parse/lint/layout jobs to workers with cancellation and edit-generation
binding. Workers have no provider/game/network authority. Lazy-load expensive
code editing/replay panels. Verify workers/code editor behavior under production
CSP; a fast dev build does not prove production compatibility.

Batch stream updates for painting while retaining authoritative order. Do not
silently coalesce away unknown/settled/rejected transitions. On overflow mark
stale and recover via snapshot. Limit concurrent subscriptions and close them
when views change/logout/unmount; abort outstanding read requests appropriately.
Accepted mutating commands remain owned by the server, not an AbortController.

## Memory and listeners

Set bounds for event buffers, graph history, imported files, clipboard, artifacts,
worker requests and object URLs. Revoke blob URLs, terminate idle workers, remove
listeners and dispose subscriptions on route/session lifecycle. Stale Promise
responses cannot repopulate a logged-out or switched workspace. Test React
Strict Mode effect double invocation: it must never duplicate a mutation.

Do not cache live records in a service worker. Cache only appropriate static
content or explicitly consented draft recovery data. Static bundle version
changes require compatibility re-admission, not a silent live-contract assumption.

## Threshold changes

A missed target is a recorded failure with measured bottleneck and scoped fix.
Do not reduce fixture size, increase thresholds after seeing results, disable
features or reclassify failed work as optional without a reviewed decision.
Separate engine overhead from UI/transport overhead; do not blame provider latency
for expensive browser rendering.
