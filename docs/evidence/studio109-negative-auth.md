# Studio #109 — negative auth, Origin and CSRF conformance

Scope: the AC5 acceptance item *"Consumer schema/pin tests and negative
auth/Origin/CSRF tests pass; no production credentials or private captured
content appear in fixtures, exports or logs."*

This record is deliberately narrow. It does not claim AC1, AC2, AC3 or AC4.

## What was added

| Artifact | Gate |
| --- | --- |
| `tests/process/studio109-owner-negative-auth.test.mjs` | Real-process negative auth/Origin/CSRF conformance against the pinned owner |
| `packages/client/src/context-owner-catalog.test.ts` | Consumer decoding of the owner's typed refusals |
| `package.json` → `test:owner-negative-auth` | Reproducible entry point |
| `.github/workflows/validate.yml` → *Owner negative authentication, Origin and CSRF (Studio #109 AC5)* | CI wiring in the authenticated live-owner job |

The process test starts the owner binary from `contracts/live-owner-ci.lock.json`
and speaks raw HTTP/1.1 to its loopback management port. Raw sockets are
required because the live-owner fixture proxy strips the browser `Origin`
header before forwarding (`tools/live-owner-test-server.mjs`), so no
browser-driven request can reach the owner carrying an `Origin`. `fetch` also
normalises header names and refuses to emit an empty `Origin`, which would make
the case-insensitivity and empty-value cases untestable.

## Observed owner behaviour at the pinned revision

Verified against `AI-Ascension/sts2-harness@674a4ee2121ae218b78a8bffcda1ad09ceacfec8`
(the revision named by `contracts/live-owner-ci.lock.json`).

| Case | Result |
| --- | --- |
| Valid bearer, no `Origin`, `GET /v1/context-bindings` | `200`, catalog schema `ascension.context-control.owner-catalog.v1` |
| No credential | `401 authentication_required` |
| Invalid credential | `401 authentication_required` |
| `Origin: https://evil.test` (valid credential) | `403 origin_forbidden` |
| `Origin: null` | `403 origin_forbidden` |
| `Origin: ` (present, empty) | `403 origin_forbidden` |
| `origin:`, `oRiGiN:`, `ORIGIN:` | `403 origin_forbidden` |
| `Origin` with **no** credential | `403 origin_forbidden` (guard precedes authentication) |
| `Origin` + `POST /v1/studio/drafts` | `403 origin_forbidden`, no new revision written |
| Cross-site-simple `Content-Type: text/plain` on `POST` | `400 content_type_required` |
| `Content-Type: application/json; charset=utf-8` | `400 content_type_required` |
| `OPTIONS` preflight | `400 method_not_allowed`; no `Access-Control-Allow-Origin` on any response |
| Bearer credential echoed in body/log | not observed |

The state-changing case is proven non-mutating: the draft's revision etag is
captured after the positive control and re-read after the refused `Origin`
create, and is unchanged.

## Limits recorded, not redefined

- **`Sec-Fetch-Site` is not a gate.** `Sec-Fetch-Site: cross-site` with a valid
  bearer returns `200`. The guard keys on the `Origin` header alone, so a
  non-browser client that omits `Origin` is indistinguishable from the
  same-origin adapter. Loopback binding plus the bearer credential — not
  `Sec-Fetch-*` — are what restrict this surface at this revision.
- **No CORS.** No `Access-Control-Allow-Origin` is published and `OPTIONS` is
  rejected, so the Studio adapter only works same-origin. This is a
  constraint, not a header-based CSRF defence.
- **Guard coverage at the pin.** The harness asserts `origin_forbidden` once,
  against the unauthenticated `/v1/health` route
  (`crates/harness/tests/management.rs`). Authenticated routes,
  state-changing routes, `Origin: null`, empty `Origin`, mixed-case spellings
  and cross-site-simple content types were previously untested.

## Separate finding — AC2 scoped tokens are not issuable (not fixed here)

AC2 requires that a *metadata token* cannot read retained bytes, edit
notes/objective, commit or resume, and that revocation and grant expiry apply
during a long-lived session. That premise does not hold at the pinned owner:

- `EnvironmentAuthenticator::from_profile`
  (`crates/harness/src/management/auth.rs`) mints exactly one credential per
  profile with the scope `workflow:*`.
- `AuthContext::can` treats `workflow:*` as satisfying every requirement.
- There is no CLI or owner surface to issue a narrower credential: the `serve`
  command accepts only `--listen`, `--store` and `--auth-profile`.

Empirically, the single served credential authorizes context read, draft author,
publish, live submission and control preflight on the same token.

Consequence: AC2 cannot be satisfied by a Studio-side test, and must not be
recorded as implemented. Satisfying it requires a harness-side change to issue
separately scoped, revocable, expiring grants. That is a cross-repository
prerequisite tracked by the owner children already linked from #109 — not
something this lane can honestly claim.
