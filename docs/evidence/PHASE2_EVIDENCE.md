# Phase 2 evidence packet

This packet separates product evidence from package integrity and unresolved owner capabilities.

## Product evidence currently available

### Continuation — 2026-09-11

- Merged Studio commit `8db49dc2bb8a76f42c5b7baa225117c09ee76200` preserves exact unsupported-workflow import text in a read-only archival panel. The text is excluded from draft persistence, validation, and publication.
- `npm test -- --run --pool=threads --maxWorkers=1` passed: 4 files, 99 tests. `npm run build` also passed at the merged source head.
- Against the built local preview, the three Studio browser journeys passed in Chromium and Firefox: fixture designer, run/replay navigation, and unsupported-import archival retention. Firefox required a user-local dependency/font root and a test-only content-sandbox workaround. This local VM cannot create WebKit's required EGL display; the GitHub-hosted WebKit CI result below supplies the cross-engine execution evidence.
- Merged Studio commit `e9037d3a210dc967a82d23f48948e4d49aa4bd87` adds the GitHub Actions validation workflow. Main-head run `34624430891` passed clean installation, lint/typecheck, unit tests, production build, Chromium, Firefox, WebKit, and the recorded-run Chromium regression.
- Merged Studio commit `b7347fc` adds a GitHub-hosted authenticated live-owner Chromium regression. Run `34628564577` built the pinned `sts2-harness` binary, started it with the test bearer token, verified `/v1/health`, and used the built Studio bundle through the same-origin adapter. The browser entered the token and subject, received “Owner reports ok,” and activated live-owner mode. This proves pairing and mode selection only; it does not prove browser draft persistence, publication, revocation, plan inspection, or artifact retrieval.
- Merged Studio commit `257ccec` extends that regression in run `34630449100`: after pairing and entering live mode, Chromium returns to Library, creates a draft, and observes “Autosaved to the active adapter.” The same-origin proxy removes the browser-only `Origin` header before forwarding owner mutations, so the authenticated loopback owner accepts the save. This proves browser draft creation and autosave, but not browser validation, publication, revocation, plan inspection, or artifact retrieval.
- Merged Studio commit `f64efdf` extends the journey in run `34631851055`: Chromium validates the saved draft and receives the owner validation digest. Clone provenance is encoded as the owner’s strict `{ summary, synthetic }` annotation and retains the source semantic version, avoiding the prior unknown-field and type decode failures. This proves browser validation, but not browser publication, revocation, plan inspection, or artifact retrieval.
- Merged Studio commit `02ecd93` extends the journey in run `34632504542`: Chromium publishes the validated draft and observes the immutable owner-revision outcome (or the idempotent already-published outcome). This proves browser publication, but not browser revocation, plan inspection, artifact retrieval, or published-definition reload.

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
- The additive owner authoring contract merged through [PR #57](https://github.com/AI-Ascension/sts2-harness/pull/57) as [`172b41022e0de9d66ab5ee94b06ac4b99238cad2`](https://github.com/AI-Ascension/sts2-harness/commit/172b41022e0de9d66ab5ee94b06ac4b99238cad2), with the `max_output_tokens` live-filter fix merged through [PR #64](https://github.com/AI-Ascension/sts2-harness/pull/64) as [`651a5225cc608303710014cc5ddf0160541662f9`](https://github.com/AI-Ascension/sts2-harness/commit/651a5225cc608303710014cc5ddf0160541662f9). Its focused owner checks passed for revision-bounded draft writes, idempotency, conflicts, immutable publication, secret-like rejection, SQLite reopen, HTTP route mapping, and missing-draft 404 behavior. A real authenticated synthetic process also completed the authoring flow; no live browser attachment is claimed.

## Product changes covered by this packet

The Studio draft now includes a non-canvas semantic list editor alongside the React Flow canvas, typed definition limits and node fields, ordered guard editing, bounded raw JSON import, archival handling for unsupported schemas, secret-safe portable bundles, template cloning with provenance, multi-selection copy/paste ID remapping, guarded edge reconnection, layout alignment, diagnostics-to-target navigation, bounded history and SSE projection helpers, draft conflict inspection with three-way merge, bounded run controls, replay comparison, and explicit fixture/live capability states. The permission-scope ADR, checksummed bundle, SPDX SBOM, and browser screenshot are included as review artifacts.

## Capability and evidence limits

The live adapter is real code against the merged owner routes, including draft persistence, conditional save, capability validation, and publication. A live synthetic process completed create, save, validate, publish, and reload checks. GitHub-hosted Chromium evidence now covers authenticated browser pairing, live-mode selection, draft creation, autosave, validation, and publication. Browser session revocation, plan inspection, artifact retrieval, and published-definition reload remain unavailable. Fixture mode is explicit and deterministic; its evidence cannot satisfy native gameplay acceptance.

The runtime did not expose callable D0→D1→D2→D3 Luna Max child sessions. No subprocess chain or false attestation was substituted. The exact blocked and partial requirement entries are in `requirement-ledger.json`.

The desktop fixture journeys now have Chromium and Firefox coverage, and GitHub Actions also passes the configured WebKit suite. The 390px-through-desktop responsive matrix, 200/400 percent zoom, manual screen-reader review, production host CSP headers, and browser permission/revocation states remain unverified. The production bundle contains a single minified JavaScript chunk of 553,475 bytes because React Flow is included in the initial route; Vite reports a chunk-size warning, and route-level code splitting remains a follow-up.

Phase 2 is merged. No release, deployment, live game session, or native hierarchy claim is made by this packet.

## Next verification gates

Exercise browser validation, publication, revocation, plan inspection, and artifact retrieval against the authenticated owner; then complete the responsive, accessibility, and production-host security matrix before a release decision.
