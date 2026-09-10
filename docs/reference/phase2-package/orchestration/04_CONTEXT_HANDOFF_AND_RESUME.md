# Bounded context and resumable handoff

Each task packet contains mission, WP/requirement/acceptance IDs, applicable specs,
exact source/artifact pins, allowed paths and prohibited effects, declared ports,
inputs/outputs, test commands, budget and review owner. Send links/excerpts for the
relevant contract rather than the whole repository. No private chain-of-thought
transcripts, credentials or unbounded logs in packets.

Maintain sanitized ledgers in an admitted ignored execution directory or approved
project evidence location: task status, dependency state, source locks, agent IDs/
parentage, write leases, decisions/ADRs, command results, blocked gates and current
integration candidate. Public evidence is separately redacted/reviewed.

Use status values `not_started`, `in_progress`, `blocked`, `implemented`,
`verified`, `integrated`, `reopened`; don't let an implementer's `done` skip review.
A source/artifact change marks affected validation stale. Evidence records bind
exact version, command, exit code and artifacts, not a vague green summary.

On CONTINUE: reload the manifest/ledger, inspect current Git state, verify no stale
write leases or live children are being duplicated, select dependency-ready WPs,
and resume at the failed/blocked gate. Never rebuild Phase 1 or reset the workspace
because the prior context was lost. Ask only for non-resolvable permission/input
that actually blocks a concrete next action; finish independent safe work first.

A result packet states changes, rationale summary, invariants preserved, tests,
failures, limits, exact commit/diff, review needs and open risks. It should explain
observable decisions, not hidden reasoning. Integration rejects stale source pins
and contradictory self-reported results until inspected.
