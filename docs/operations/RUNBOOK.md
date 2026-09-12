# Studio operations runbook

Start with `npm ci` and `npm run build`, then serve the resulting `dist/` directory through the approved same-origin static host. Use the Compatibility view to inspect the active adapter and owner health. A live connection failure should leave the operator in an explicit error state; it must not silently turn into a live claim over fixture data.

For an unsaved draft, review the autosave status. The live authoring adapter uses owner-backed revision and etag preconditions, so a stale response becomes an explicit conflict. A Phase 1-only owner leaves the editor unsynced until the additive authoring owner PR is available. Review the server revision, then keep the remote copy, save the local candidate as a new draft, or apply a non-overlapping three-way merge. Use the list editor to inspect or recover semantic content without relying on canvas drag operations.

Publish only after owner validation reports no error diagnostics and the draft status is saved. Publication submits the exact semantic digest and expects an immutable owner response; an already-published digest is shown as idempotent. The Studio does not start a run as part of publishing.

Before operating a run, confirm the displayed run ID, definition digest, revision, recovery admission, and actor scope. Pause/resume/step/cancel requests are sent only with the displayed expected revision. Replay and export use offline/redacted owner routes. No run control is issued for a historical or unsupported state.

Rollback is a static bundle replacement after a reviewed build. No deployment, database migration, harness startup, or provider/game action is performed by this repository.

See [SUPPORT_JOURNEYS.md](SUPPORT_JOURNEYS.md) for the end-to-end operator journeys: pairing, drafts, conflicts, validation, publication, run control, replay, crash recovery and support export.

Recorded-run ZIP import is local, read-only inspection under **Recorded runs**.
See [import and CLI validation](../architecture/recorded-run-import.md) and the
[prepared LAN preview procedure](RECORDED_RUN_PREVIEW.md). The reviewed packaging,
static server and user-service assets live under `tools/deploy/`; their inclusion
does not install or activate a host service. Coordinator owns deployment and rollback.
