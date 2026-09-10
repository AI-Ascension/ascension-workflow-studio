# Hierarchy and scheduling

## Required tree

D0 root directs eight workstream types. D1 workstream leads delegate bounded WPs
to D2 coordinators. D2 coordinators delegate implementation and independent
verification to different D3 specialists. D3 is terminal. Real thread parentage,
model and effort settings must be recorded; role names are not evidence.

Every implementation WP has a D3 implementer and a separate D3 verifier/reviewer.
A coordinator may hand work to a successor but cannot fabricate child IDs or
claim a flat direct-root pool is three levels deep. The root integrates, resolves
owner conflicts and manages gates; it does not use broad direct edits to bypass
the requested hierarchy.

## Resource ledger

Default ceiling: 12 live descendants, including leads/coordinators/reviewers.
Honor a lower actual tool/runtime ceiling. Reserve descendant slots before any
spawn; release on confirmed closure. A blocked parent holding a slot counts.
Default active topology is two D1 leads, one D2 coordinator each, and up to two
D3 leaves per coordinator (eight descendants), leaving spare capacity for a
review/preflight/repair chain within the ceiling. If only one full chain fits,
serialize work rather than flatten ancestry or exceed capacity.

Schedule from `tasks.json` only when dependencies and write leases permit it.
One worktree writer per overlapping path domain. Shared schema, lockfile and
entrypoint changes have a single integration owner. A workstream lead may not
reserve all slots and leave no room for leaves. No runtime permission escalation
or hidden process spawning to bypass depth/thread limits.

## Workstream responsibilities

FDN: baseline admission, repository bootstrap, architecture and threat model.
CON: owner artifacts, typed client/document/registry/validation contracts.
DSG: shell, visual editor, nesting/raw mode and dynamic-region interaction.
AUT: server-backed drafts, concurrency, publish, catalog/template portability.
RUN: browser admission, live transport/projection/inspector and command controls.
INS: historical replay/comparison and optional approved adjacent views.
QLT: security, accessibility, performance, browser/process/fault tests and review.
DLV: reproducible build, operating docs, CI integration and draft-PR handoff.

Workstream names describe organization, not unrestricted repository write rights.
Each packet has explicit source pins, allowed paths, acceptance IDs and prohibited
effects. An FDN packet cannot grant permission to run a native game or publish a
repository publicly just because a downstream task would benefit.

## Evidence and review

D3 implementer returns exact diff/commit and tests. Independent D3 verifier checks
source and executes acceptance/negative cases on that candidate. It may add tests
in a separate owned area but cannot sign off its own product fix without another
reviewer. D2 accepts only evidence-backed results; D1 checks seams; D0 integrates
and reruns affected gates at exact combined heads.

Reject empty scaffolds, mock-only completion, swallowed failures, unreachable UI,
unused code, model prose as API evidence, and screenshots unrelated to the built
candidate. Reopened tasks retain prior evidence marked stale rather than deleting
history. New required work is added with dependency/requirement IDs, not hidden
under an already completed task.

## Progress and stopping

Send bounded meaningful status updates during execution, not per-file chatter.
Record blockers with exact safe next action. On context handoff, persist sanitized
state and close/hand off workers explicitly. On completion/cancellation, revoke
write leases and account for all agent threads and owned child processes.
