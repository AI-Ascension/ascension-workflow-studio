# Support journeys

Operator-facing reference for pairing, drafts, conflicts, validation, publication,
run control, replay, recovery and support export. Each step names the exact Studio
surface, the owner contract it relies on, and what the Studio deliberately does not do.

## 1. Pairing (memory only)

1. Open **Compatibility → Session credential**.
2. Enter the bearer token and the authenticated actor subject. Both live only in this
   tab's memory; nothing is written to `localStorage`, `sessionStorage`, a service
   worker or the crash-recovery buffer.
3. Choose **Live owner API** and click **Check owner connection**.
4. **Clear session** removes the token and actor scope from the tab immediately.

Unavailable/forbidden states are explicit: a failed health check shows an error and the
fixture adapter is never silently substituted for a live claim. The subject must match
the owner identity bound to the token because the harness re-checks it on every control
command.

## 2. Drafts and autosave

- The designer loads `draft.<definitionId>` from the owner and autosaves semantic
  document plus layout sidecar with the displayed revision and etag preconditions.
- The header badge shows `saved`, `saving`, `offline` or `conflict`; offline never
  claims a server save.
- A lost save response leaves the local candidate intact and offers **Retry save** with
  the same mutation identity, so the owner deduplicates it.

## 3. Conflicts

When the owner reports a conflict, the panel retains **base / local / remote**:

- **Apply non-overlapping merge** — merges objects key-by-key and refuses concurrent
  array changes (delete-versus-edit, reordered branches) and conflicting scalars.
- **Save local as new draft** — creates a new draft id and preserves the local candidate.
- **Reload remote…** — protected behind an explicit discard confirmation with a
  keep-local escape.
- **Cancel resolution** — hides the panel and preserves local content; **Review
  divergence** reopens it.
- The merged candidate is revalidated against the owner; stale validation is never
  inherited.

## 4. Validation and publication

- **Validate** binds the layout sidecar to the client canonical semantic digest, shows
  the owner definition digest and diagnostics, and surfaces compiler identity
  separately from the definition and layout digests.
- **Publish revision** submits the exact digest and revision; responses distinguish
  `published`, `already_published` and `conflict`. Publishing never starts a run.
- Adaptive region edits change only authored bounds; publishing creates a new immutable
  definition and an active run stays pinned to its admitted digest. No plan is applied
  to an active run from the browser.

## 5. Run inspection and control

- **Runs** shows status, revision, cursor, recovery admission, budget, pending
  operation, and the admitted definition digest (pinned).
- Commands are limited to Pause, Resume, Step and Cancel at their admitted states.
  Step requires an admitted paused boundary. No cursor setting, node skipping, forced
  retry, direct game action or plan editing exists.
- Command identity is generated once per intent. A transport failure enters
  **unknown** rather than failed-to-apply, and **Check outcome** re-sends the identical
  request so the owner returns the stored outcome.
- The historical cursor (see below) disables live controls while a recorded cut is
  displayed.

## 6. Replay and compare

- **Replay / Compare** runs the owner's offline replay for two run ids and reports
  matched/diverged with the first divergence.
- The run-context panel shows each run's revision, status, outcome and pinned
  definition digest, and states that comparison is descriptive evidence, not causal
  proof that an edit improved gameplay. Layout is excluded from semantic identity.

## 7. Crash recovery (opt-in, local)

- **Local crash recovery** is off by default. When enabled it stores only sanitized
  authoring data (document, layout, raw text) in IndexedDB with a 24-hour TTL, bounded
  counts/bytes and principal binding.
- Tokens, live run snapshots, provider outputs and commands are never stored.
- Quota exhaustion drops older records and keeps the newest candidate.
- **Recover unsaved candidate** is an explicit reauthorization; records from another
  principal are never offered.

## 8. Support export

Two bounded, redacted exports are available:

- **Export redacted JSON** (Replay / Compare) uses the owner's redacted artifact route
  for a run.
- **Export recovery** (designer) downloads the local sanitized recovery records for the
  current principal.
- **Export** (designer) writes a digest-bound Studio bundle (definition + inert layout
  + provenance) that is not executable until the owner validates it.

Exports never include credentials, provider prompts/outputs, private game bytes or
unsanitized text. See [RUNBOOK.md](RUNBOOK.md) for the operational sequence and
[DEVELOPMENT.md](DEVELOPMENT.md) for local setup.
