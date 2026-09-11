# Local recorded-run verification

## Review corrections, 2026-09-11

Current evidence now describes the candidate2 privacy-patch build. The previous
candidate2 package and manifest remain in `artifacts/recorded-run-preview/`, and
its original test evidence is retained in commit `2959d09`.

`npm test -- --reporter=dot` passed 90 tests across all four suites.
`npm run test:recorded-browser` with the variables below passed 8 Chromium tests,
including its production build and both TypeScript checks. The added worker test
rejects six raw action/provider-request placements in manifest, common gameplay
and opaque identities; every failed import retains the previous recording,
renders no synthetic secret, offers no replacement, and causes no outgoing request
or page error. `privacy-browser.json` records this result.

`node tools/check-recorded-privacy.mjs
../recorded-run-sts2-protocol/history/recorded-run-candidate2` passed all six negative
probes and all three valid baselines. `privacy-comparison.json` binds their exact
ZIP hashes and each decoder's error code. The generated `studio-invalid/` vectors
are synthetic review derivatives, separate from the protocol artifact inventory.
The same preserved oracle passed `tools/check-recorded-summary.mjs` on
`contracts/recorded-run-candidate/golden/legacy-failed.zip`, still 8 events/1 accounting,
process completed, gameplay episode_failed and actions unknown.

Browser environment:

```sh
FONTCONFIG_FILE=/tmp/ascension-browser-audit/fonts.conf \
LD_LIBRARY_PATH=/tmp/ascension-browser-libs/root-20260910/usr/lib/x86_64-linux-gnu:/tmp/ascension-browser-libs/root-20260910/lib/x86_64-linux-gnu \
npm run test:recorded-browser
```

`node tools/record-build-evidence.mjs` records the browser-tested build.
`python3 tools/deploy/package-preview.py dist artifacts/recorded-run-preview/candidate2-privacy-patch.zip`
created four files totaling 868,850 bytes; release digest
`f5722374a5de4e7bd3393b42a64479b43c78cd7a0889d71f629e8d0885f3ca35`.
Local package is prepared only; coordinator owns deployment and served hashes.

## Original candidate2 gate (historical)

Evidence is from the isolated Studio worktree and synthetic protocol fixtures.
It is not Train export or LAN deployment evidence. Candidate version is
`1.0.0-candidate.2`, pinned by `contracts/recorded-run-candidate/studio-pin.json`.

Checks passed:

- `npm run lint` (both TypeScript projects, including browser tests).
- `npm test`: 66 tests at the complete-suite gate. Two additional limit cases were
  then added; `npm test -- packages/recording/src/import.test.ts` passed all 48
  importer tests, with the 20 unchanged client/document/app tests already passing.
  The importer set includes all 6 valid and 21 invalid protocol ZIP vectors.
- `npm run test:recorded-browser` with documented font/library variables: 7 Chromium
  tests passed, including production build, file picker and DEFLATE, import errors,
  idempotent re-import, explicit replacement, absent accounting, unsupported records,
  numeric observations, pagination and original editor behavior.
- `node tools/check-recorded-summary.mjs ../recorded-run-sts2-protocol
  contracts/recorded-run-candidate/golden/legacy-failed.zip`: equal summaries from
  independent Studio decoder and protocol oracle, 8 events / 1 accounting record.
- Invalid fabricated settlement via Studio CLI: exit 1, `evidence_mismatch`.
- `python3 -m py_compile tools/deploy/preview-server.py tools/deploy/package-preview.py`.
- Static deployment packaging: four files, 865,841 total bytes; exact inventory
  agrees with the browser-tested `dist/` build.
- `git diff --check`: passed. Original phase-2 contrast patch remains unchanged
  (SHA-256 `5d17048b413b520ac49bef8ee99f9a88917cc3575926ef04d8a3ae867360b3ae`).

`recording.png`, `failure.png`, `observation.png`, and `designer-dark.png` show the
production build. `import-browser.json` records no page errors or imported network
requests. `designer-colors.json` verifies all six nodes use text rgb(16,34,56) on
rgb(219,234,254), with readable controls/minimap. DejaVu test font limitations do
not affect the measured node contrast.

`pagination-browser.json` records a synthetic 25,000-record import at about 6.2 s,
100 timeline DOM rows per page, and working stream filtering. Post-import page JS
heap was approximately 29.4 MB; this metric excludes worker/native allocations and
does not claim total peak memory. The worker is terminated after import.

`build-assets.json` is the exact four-file hash inventory for coordinator deployment.
The pre-existing React Flow application chunk warning (>500 kB) remains a build
performance follow-up; it did not prevent any tests. Only Chromium was exercised
in this local pass. Independent review and actual Train interoperability remain
coordinator-managed admission gates.
