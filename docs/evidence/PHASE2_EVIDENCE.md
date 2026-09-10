# Phase 2 evidence packet

This packet separates product evidence from package integrity and unresolved owner capabilities.

## Product evidence currently available

- `npm ci` passed with the pinned lockfile, including `@playwright/test` 1.63.0.
- `npm run typecheck` and `npm run lint` passed for the strict app and Vite configuration projects.
- `npm test -- --run --pool=threads --maxWorkers=1` passed: 3 files, 20 tests. Coverage includes semantic identity and layout binding, bounded history, digest-bound bundles, secret-like field rejection, hostile JSON input rejection, future-schema archival classification, copy/paste ID remapping, guarded reconnection, alignment, three-way merge, owner event projection recovery, bounded SSE framing, same-origin enforcement, runtime owner decoding, owner capability forwarding, safe commands, and the rendered library/designer/list-editor shell.
- `npm run build` passed. The source-map-free Vite bundle is 553,475 bytes of JavaScript and 35,106 bytes of CSS; the emitted manifest and SHA-256 file are checked in.
- `npm audit --audit-level=moderate` passed with zero vulnerabilities for the pinned dependency graph.
- `npm sbom --sbom-format=spdx --sbom-type=application` passed and produced `studio-sbom.spdx.json` for the checked-in application dependency graph.
- A local `vite preview` served `index.html`, JavaScript, and CSS with HTTP 200 responses. The Chromium Playwright project then passed both real browser journeys (2/2) with an isolated user-local Debian library/font root and `--disable-dev-shm-usage`; the reviewed screenshot is `screenshots/studio-designer-chromium.png`.
- The configured browser matrix contains Chromium, Firefox, and WebKit. The Chromium project passed 2/2. Firefox and WebKit launch checks remain blocked by host libraries absent from the verification image; their downloaded engines and exact missing-library output are recorded in the command history.
- The exact merged Phase 1 harness head passed its owner `management` suite (6 cases) and `management_sqlite` suite (5 cases) with `--locked`; see `phase1-owner-tests.json`.
- The same head passed 28 workflow contract, dynamic planning, runtime, and durable store cases; see `phase1-workflow-tests.json`.
- A real temporary `sts2-workflow serve` process at the same source head returned the admitted health, capability, validation, inspect, run, status, events, replay, and redacted export responses; see `phase1-live-api.json`.
- The checked-in catalog, contract schema, canonical vector, conformance fixture, and owner management source digests are pinned in `contracts/accepted/phase1-integration.lock.json`.
- The copied Phase 2 package passes its integrity verifier and its 34 checker unit tests.
- The additive owner authoring candidate is in draft PR [#57](https://github.com/AI-Ascension/sts2-harness/pull/57). Its focused owner checks passed for revision-bounded draft writes, idempotency, conflicts, immutable publication, secret-like rejection, SQLite reopen, HTTP route mapping, and missing-draft 404 behavior. The owner PR is not merged, and no live browser-to-owner process run is claimed.

## Product changes covered by this packet

The Studio draft now includes a non-canvas semantic list editor alongside the React Flow canvas, typed definition limits and node fields, ordered guard editing, bounded raw JSON import, archival handling for unsupported schemas, secret-safe portable bundles, template cloning with provenance, multi-selection copy/paste ID remapping, guarded edge reconnection, layout alignment, diagnostics-to-target navigation, bounded history and SSE projection helpers, draft conflict inspection with three-way merge, bounded run controls, replay comparison, and explicit fixture/live capability states. The permission-scope ADR, checksummed bundle, SPDX SBOM, and browser screenshot are included as review artifacts.

## Capability and evidence limits

The live adapter is real code against the merged owner routes, while draft persistence, conditional save, and publication are wired to the additive owner candidate in draft PR #57. This worktree does not claim a live process run, and those routes remain outside the admitted merged Phase 1 surface until that PR is reviewed. Browser pairing, session revocation, plan inspection, and artifact retrieval are absent or unavailable. Fixture mode is explicit and deterministic; its evidence cannot satisfy live process acceptance.

The runtime did not expose callable D0→D1→D2→D3 Luna Max child sessions. No subprocess chain or false attestation was substituted. The exact blocked and partial requirement entries are in `requirement-ledger.json`.

The Chromium browser smoke covered the desktop fixture journeys. The full Firefox/WebKit launch matrix, 390px through desktop responsive matrix, 200/400 percent zoom, manual screen-reader review, production host CSP headers, live owner attachment, and browser permission/revocation states remain unverified. The production bundle contains a single minified JavaScript chunk of 553,475 bytes because React Flow is included in the initial route; Vite reports a chunk-size warning, and route-level code splitting remains a follow-up.

Phase 2 is still a draft PR. No merge, release, deployment, live game session, or native hierarchy claim is made by this packet.

## Next verification gates

Attach a served static bundle to a real authenticated harness process, exercise strict and dynamic owner round-trips, complete the cross-browser/accessibility/security matrix, and review the remaining owner adapter gaps before any Phase 2 merge or release decision.
