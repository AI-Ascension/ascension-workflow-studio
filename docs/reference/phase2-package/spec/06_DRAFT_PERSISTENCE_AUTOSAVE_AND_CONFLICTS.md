# 06 — Draft persistence and concurrent edits

## Store ownership

Use a harness-owned authoring persistence port backed by the implemented Phase-1
transactional infrastructure or an admitted owner-local store. Persist semantic
candidate, layout sidecar, editor/raw-text state where allowed, base published
reference, author identity, validation status/digests and document revision.
Store accepted changes atomically. Do not access runtime tables from Studio or
save only in localStorage. Draft content can be semantically incomplete; metadata,
size, authorization and parser safety must still be validated.

Layout has no authority. Treat it as typed inert data and keep it out of compiled
semantic digests. Invalid sidecar references produce a repair preview or clean
layout regeneration without modifying execution semantics.

## Revisions and conditional saves

Use strong ETags/If-Match or the existing equivalent compare-and-swap contract
for the complete authoring document [S08]. Separate a document revision from a
compiled definition revision and a run revision. Every save includes expected
revision plus client mutation ID and payload digest when supported for lost-
response deduplication. New drafts use create-if-absent semantics.

Do not accept `If-Match: *` as a force-overwrite option in the UI. Two browser tabs
saving the same draft must produce an explicit conflict, not last-write-wins.
The server condition is checked transactionally with the write. UI disabled
controls alone cannot enforce this.

Autosave coalesces local edits with bounded delay and a maximum outstanding save
count. A response only marks the exact sent edit generation saved. Edits made
while the request is pending stay dirty. Reordering of replies never resets the
current editor to an old server snapshot. Include explicit Save and status text.

## Conflict workflow

Retain base, local and latest remote documents. Offer a graph-aware three-way
diff by stable IDs and typed property paths. Non-overlapping presentation-only
changes may merge automatically if tested; semantic conflicts, delete-vs-edit,
reordered branch arrays and changed pinned refs require review. Do not silently
merge two independent run strategies because JSON paths differ.

Offer keep-local-as-new-draft, review-and-merge, reload-remote after explicit
local export/discard, and cancel. A merged candidate receives a fresh revision
and full validation; previous validation is not inherited. Always preserve the
unmerged local content until resolution/export succeeds.

## Offline and crash behavior

On disconnect, show Unsynced/offline and never claim server save. Allow local
editing of already admitted material. An opt-in bounded crash-recovery buffer
may use IndexedDB for sanitized authoring data, with TTL, principal/workspace
binding, clear/export controls and storage-quota handling. No tokens, live run
snapshots, provider outputs or browser commands in persistent storage.

Reconnection fetches current server revision and resolves conflicts before saves.
It must not flush queued launch/pause/resume/cancel commands. Account/server
switch clears in-memory credentials, live projections and incompatible drafts;
recoverable local data is isolated and explicitly reauthorized.

## Required fault cases

Lost save response; duplicate save ID; conflicting same ID; server write then
restart; quota/full disk; malformed persisted sidecar; stale autosave response;
parallel tabs; actor loses edit permission mid-save; imported raw syntax error;
layout-only update; base revision removed from visible registry. No test is
satisfied by an in-memory-only fake store.
