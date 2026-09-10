# Studio operations runbook

Start with `npm ci` and `npm run build`, then serve the resulting `dist/` directory through the approved same-origin static host. Use the Compatibility view to inspect the active adapter and owner health. A live connection failure should leave the operator in an explicit error state; it must not silently turn into a live claim over fixture data.

For an unsaved draft, review the autosave status. A capability-gated live save stays local to the current editor and is marked unsynced. A fixture conflict retains the server revision in the adapter record for review. Use the list editor to inspect or recover semantic content without relying on canvas drag operations.

Before operating a run, confirm the displayed run ID, definition digest, revision, recovery admission, and actor scope. Pause/resume/step/cancel requests are sent only with the displayed expected revision. Replay and export use offline/redacted owner routes. No run control is issued for a historical or unsupported state.

Rollback is a static bundle replacement after a reviewed build. No deployment, database migration, harness startup, or provider/game action is performed by this repository.
