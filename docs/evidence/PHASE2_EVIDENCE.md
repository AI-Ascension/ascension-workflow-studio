# Phase 2 evidence packet

This packet separates product evidence from package integrity and unresolved owner capabilities.

## Product evidence currently available

- `npm run typecheck` passed.
- `npm run lint` is wired to the same strict TypeScript project check and is expected to pass with typecheck.
- `npm test` passed: 3 files, 10 tests. The tests cover canonical semantic identity, layout binding, edit history, digest-bound bundle round-trips, owner event projection recovery, SSE framing, same-origin enforcement, safe commands, and the rendered library/designer/list-editor shell.
- `npm run build` passed. Vite emitted a static source-map-free bundle under `dist/`.
- `npm audit --audit-level=moderate` passed with zero vulnerabilities for the pinned dependency graph.
- A local `vite preview` served `index.html`, JavaScript, and CSS with HTTP 200 responses. No real browser engine is installed in the environment, so browser-engine and screenshot gates remain unverified.
- The exact merged Phase 1 harness head passed its owner `management` suite (6 cases) and `management_sqlite` suite (5 cases) with `--locked`; see `phase1-owner-tests.json`.
- The checked-in catalog, contract schema, canonical vector, conformance fixture, and owner management source digests are pinned in `contracts/accepted/phase1-integration.lock.json`.

## Capability and evidence limits

The live adapter is real code against the merged owner routes, but this worktree does not claim a live process run. Draft persistence, publish, browser pairing, session revocation, plan inspection, and artifact retrieval are absent or unavailable in the admitted Phase 1 surface. Fixture mode is explicit and deterministic; its evidence cannot satisfy live process acceptance.

The runtime did not expose callable D0→D1→D2→D3 Luna Max child sessions. No subprocess chain or false attestation was substituted. The exact blocked and partial requirement entries are in `requirement-ledger.json`.

The production bundle contains a single minified JavaScript chunk of roughly 518 kB before gzip because React Flow is included in the initial route. Vite reports this as a chunk-size warning; the static bundle is usable, and route-level code splitting is a follow-up.

## Next verification gates

Attach a served static bundle to a real authenticated harness process, exercise strict and dynamic owner round-trips, run browser engine/accessibility/security checks, generate the delivery checksum/SBOM packet, and review the remaining owner adapter gaps before any Phase 2 merge or release decision.
