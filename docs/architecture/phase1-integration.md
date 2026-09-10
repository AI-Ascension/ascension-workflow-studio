# Phase 1 integration admission

The Studio consumes the merged Phase 1 owner contracts at the exact heads recorded in [phase1-integration.lock.json](../../contracts/accepted/phase1-integration.lock.json). The harness remains the only execution, compiler, persistence, command, replay, and gameplay authority. The browser package owns presentation, document editing, layout, runtime decoding, and bounded adapter behavior.

The admitted management surface is an authenticated loopback API under the relative `/v1` base. It includes health, capabilities, definition validation/inspection/diff, run submission, run snapshots, bounded event pages, revision-safe commands, offline replay, and redacted export. The Studio's `OwnerApiClient` sends these requests with same-origin relative paths and validates each response at runtime.

The owner does not export a definition list, node registry, draft persistence, publish, session pairing/revocation, plan inspection, command lookup, or usable artifact retrieval route. Those gaps are represented by typed capability gates. The library uses the pinned first-party catalog in `contracts/accepted/phase1/workflows`; live mode says when it is showing that static catalog. Fixture mode is a deterministic test adapter and is labeled in every relevant workspace.

The served Phase 1 runtime is documented by the owner as synthetic loopback management. The Studio therefore presents live owner routes as admitted transport contracts without claiming native game/provider execution. The available runtime also did not expose callable D0→D1→D2→D3 Luna Max child sessions. That orchestration limitation is recorded in the lock and in the compatibility view; the implementation does not manufacture a hierarchy attestation.
