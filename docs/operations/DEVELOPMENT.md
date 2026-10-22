# Local development

The pinned toolchain is Node 24.16.0 and npm 11.13.0. From the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

The development server is bound to `127.0.0.1:4173`. The default Studio mode is the explicit fixture adapter. Select Compatibility, choose Live owner API, provide a bearer token and the authenticated owner subject in memory for the current tab, and check the connection when a loopback server is available. The live adapter only uses relative `/v1` paths. The subject must match the owner identity bound to the token because the harness checks it on every control command.

The static output is `dist/`. Build output does not contain source maps or credentials. This repository does not deploy or start the harness automatically.

## Live owner fixture diagnostics

The production policy browser fixture captures the owner and gateway stdout and
stderr outside its temporary data directory. Cleanup deletes that private data
directory and preserves an allowlisted diagnostic bundle under
`/tmp/studio-live-diagnostics/<fixture-name>/` (override the root with
`STUDIO_LIVE_DIAGNOSTIC_ROOT`). The copy allowlist excludes stores and key files;
the process report excludes environments. Captured stream bytes are preserved
verbatim. CI prints the streams and uploads the bundle when the live owner job
fails.

`owned-children-report.json` retains every child lifetime, including replaced
owners. Its UTC timestamps are observations by the fixture process:

- `started_at` records the spawn attempt.
- `stop_requested` records the time and reason (`restart` or `cleanup`) before
  the fixture signals a running child. An earlier unexpected exit keeps this
  field null.
- `exit.observed_at`, `exit.phase`, and `exit.stop_reason` record the process exit
  separately from pipe closure. A descendant holding a pipe open cannot relabel
  an earlier exit as cleanup.
- `cleanup_started_at` marks final cleanup, and `closed_at` marks pipe closure.
- `diagnostics_flushed` is true only after the combined log and both captures
  finish successfully. False means a stream failed or the existing bounded
  cleanup deadline expired; null means completion was not observed.

Start and exit markers in the stderr captures carry matching timestamps. The
exit marker is written through the child's capture stream after its output, and
normal cleanup waits for those streams to finish before copying the report.
Emergency process exit remains best effort and cannot promise a completed flush.
These observations support attribution of a reset; they do not establish the
cause of Studio #214 or claim that runtime execution succeeded.

The capture regression runs without Rust binaries and drives the real production
fixture with synthetic children:

```sh
node --test tools/live-owner-diagnostics.test.mjs
node --test --test-name-pattern='stubbed production capture' tools/live-owner-production-stack.test.mjs
```

It checks exact stdout/stderr bytes after fixture deletion, including large final
writes, and distinguishes a requested restart, an unexpected exit, and cleanup.
The production policy browser job separately exercises the pinned Rust stack.
