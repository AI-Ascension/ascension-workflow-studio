# 09 — Event projection, replay cursors, and reconnection

## Display reducer only

A pure client reducer may build a display projection from owner snapshots/events.
It must not choose graph branches, execute guards for scheduling, call providers,
advance workflow state independently, or infer settlement from elapsed time.
Canonical runtime status remains the Phase-1 owner's output.

Cache identity includes server/tenant-or-workspace principal scope, workflow_run_id,
definition digest, relevant schema version and projection epoch. Graph node IDs
alone are insufficient; repeated invocations use node_execution_id. Dynamic nodes
also include plan ID/revision and containing region invocation.

## Consistent initial attachment

Fetch an authorized snapshot with a documented event watermark/cursor, then
subscribe strictly after that watermark. If the existing owner API cannot supply
a consistent cut, add a tested owner operation rather than guess. Apply only
matching events after the cut and periodically reconcile with current snapshots.

Transport delivery may duplicate, disconnect or batch. Persist the last fully
applied cursor only as allowed sanitized session state; do not acknowledge an
incomplete chunk. Deduplicate by the owner's durable identity, not timestamp.
Separate event sequence, run revision, authority epoch and wall-clock time.
Reject unsafe numeric ranges during decoding; use exact representations admitted
by the owner. Never silently round 64-bit IDs in JavaScript.

If the owner uses contiguous per-run sequences, detect gaps explicitly. If event
filtering/redaction makes sequences noncontiguous, use the declared authorized
projection cursor/advance contract; do not treat every filtered event as a gap.
No cross-run or cross-principal cursor reuse. Heartbeats do not complete nodes,
resolve commands or advance semantic state.

## Gap and stale behavior

On a genuine missing range, retention expiry, schema mismatch or inconsistent
snapshot: stop applying later events, label the view resynchronizing/stale,
disable controls based on uncertain state, request a new authoritative snapshot
and resume at its watermark. Preserve historical gap evidence. Do not mark unknown
nodes completed just to reconnect the graph visually.

Server identity/digest changed: clear affected caches, re-admit compatibility,
reauthorize session as required, and rebuild the projection. An optimistic client
UI must not cover a new authority epoch with the old run's state.

## Bounded streaming implementation

Handle split UTF-8 code points, split JSON/SSE records, CRLF, comments, multi-line
SSE data, empty fields, truncated final chunks, duplicate frames, oversized frames
and malformed payloads. Bound frame bytes, queued events, per-run histories,
concurrent subscriptions and retry backoff/jitter. Use cancellation/cleanup for
unmounted views. Never reconnect in a tight loop after 401/403.

Use a server-side read projection that prevents slow consumers from blocking the
scheduler. In the browser batch visual updates; retain or refetch all critical
lifecycle events even when summaries are coalesced. If a queue overflows, abandon
that projection and resnapshot rather than silently dropping settlement evidence.

## Command reconciliation

`command_requested`/accepted means admission, not application. Resolve each command
by stable ID and expected revision, then display applied/rejected/unknown/expired
as the owner reports. A missing event is not a reason to resend with a new ID.
Browser reconnect never replays a generic mutation outbox automatically.

## Verification

Replay the same authorized record stream via single events, batches, duplicates,
different chunk boundaries and reconnect points; compare final display projections
with the authoritative snapshot. Inject out-of-order events, retention gaps,
revocation, changed digests and slow subscribers. Verify all controls remain
blocked when their prerequisites cannot be established.
