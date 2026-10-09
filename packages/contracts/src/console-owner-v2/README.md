# Console owner v2 identity candidate

This directory adds a bounded source candidate for the top-level `OwnerIdentityCorrelationV2` only. It is not the invocation envelope, an admitted request, a trusted principal, a serializer, or a transport. It is not exported from `packages/contracts/src/index.ts` and is not wired into the UI or existing schemas.

## Pinned Console source

The decoder mirrors the following files from Console commit `bc03102f873508cccd6ec2661288e0c33d83ae3d`:

- `crates/context-service/src/harness_context_owner_wire/identity.rs` — SHA-256 `86860851f3ce56a4200c839926d76c5b80cbf289dc1ad8691d55b07103334100`.
- `crates/context-service/src/harness_context_owner_wire/validation.rs` — SHA-256 `7e563ceaa04429325f61ba1a83912cf52cc4e2873cc00503ec728d612ea4dda7`.

The required closed shape is `{ console, console_scope, harness }`. It has no `schema_version`. Every struct field is required and unknown fields refuse. Console identity contains `issuer`, `subject`, `audience`, `credential_id`, `grant_id`, `grant_generation`, and `grant_expires_at`; scope contains `project_id`, `run_id`, `episode_id`, and `agent_id`; Harness identity contains `actor_subject`, `owner_id`, `workflow_run_id`, `credential_reference_id`, and `credential_expires_at`. Wire keys retain Rust's snake-case names.

## Bounds and semantics

`parseBoundedJson` first reads intrinsic typed-array view metadata, enforces the 1 MiB byte cap, and copies bytes to a fresh native `Uint8Array` without calling caller-owned getters, iterators, or copy methods. It then performs fatal UTF-8 decoding, strict JSON scanning, decoded-key duplicate checks, depth <=32, and a node budget of actual input bytes + 1. JSON numeric tokens remain raw text; no wire number passes through JavaScript `Number`. A shared-memory copy is not an atomic snapshot against a concurrent writer; only the resulting owned sequence is parsed consistently.

The candidate decoder rejects unknown, missing, and wrong-type fields before semantic checks. `grant_generation` is a `bigint` internally and retains the full numeric `u64` range; JSON wire fields remain numeric and unchanged. Expiry values are also represented as `bigint`. This candidate has no serializer, so it does not convert big integers back into JSON numbers.

Source-derived semantic checks follow Console's order: correlation text is nonempty, <=512 UTF-8 bytes, and excludes Unicode control scalars; identifiers are 1–128 ASCII bytes, start with an ASCII alphanumeric, and otherwise use ASCII alphanumerics or `._:-`. Console grant expiry and Harness credential expiry reject zero; grant generation zero is valid. Console subject must equal Harness actor subject, and Console scope run must equal Harness workflow run. The semantic refusal labels preserve `InvalidIdentifier`, `InvalidValue`, and `CorrelationMismatch` field names. JSON/typed-deserialization failures remain `json_decoding`; byte/depth/node limits remain `out_of_bounds`. Refusal messages carry only fixed categories and source field labels, never body bytes or identity values.

The returned frozen object is explicitly `kind: untrusted_owner_identity_correlation_v2`, `trust: untrusted`, `authority: none`. All identity values came from caller bytes. Neither this shape, a source pin, nor the local TypeScript type proves principal, grant, owner provenance, authentication, permission, or authorization.

## Tests and conformance boundary

`lossless-json.test.ts` and `identity.test.ts` contain authored synthetic vectors against the real parser and decoder entrypoints. They cover closed-field shape, correlations, bounds, Unicode, duplicate keys, hostile typed-array overrides, owned-copy behavior, and full-width integer token preservation. These examples are distinct from producer-generated reference vectors.

`producer-identity-conformance.test.ts` checks the committed [reference fixtures](../../../../tests/fixtures/console-owner-v2-identity/producer-contract.json): 47 typed identity cases and two depth-boundary cases. The fixtures were captured from a root-run isolated Rust oracle using byte-identical Console production identity/validation modules at the commit above, Rust 1.97.1, `serde` 1.0.229, `serde_json` 1.0.151, and all 11 dependency versions/checksums from Console's lockfile. Inputs, reference files, and nine positive Rust-produced wire outputs have recorded SHA-256 pins. Padding recipes reconstruct exact input bytes. Decimal strings occur only in comparison metadata; wire integers remain numbers.

The supervisor ran all 65 adjacent tests successfully, including distinct full-width integers, `-0`/fraction/exponent/overflow refusals, escaped duplicates, lone surrogates, body/depth boundaries, and typed-decoding-before-semantic error precedence. These checks establish agreement for the recorded cases at this synthetic seam. They do not prove full Console, owner, served-runtime, or native acceptance. The additional recorded generic floating-range observation is outside the asserted conformance set: the raw generic JSON tree retains numeric tokens and does not implement Rust's finite `f64` visitor or promise identical error precedence for every malformed generic number combined with another fault.

## Still outside this candidate

This is not `ContextOwnerInvocationV2`, an expected binding, any of the 20 operation arms, or a `HarnessResponseV1` variant. It does not establish full Console/Harness producer compatibility, schema negotiation, current principal or grant validity, revocation, permissions, CSRF, Host/Origin handling, credential transport, UI behavior, listener/readiness, response-loss recovery, deployment, or native acceptance. Keep Console's one-permission-per-grant rule and current principal/grant/revocation checks server-owned; future mutations must preserve CSRF. Future production composition must preserve exact Origin, use protected credentials over TLS or an authenticated tunnel, and must not automatically resend an ambiguous write; only explicit receipt lookup or cached-result recovery under fresh authorization may follow.

Studio issue #108 remains OPEN. Console #18, Studio #107, and Harness #94 remain dependencies. The historical native 4500-second window expired at `2026-10-08T09:56:08.009522Z`; this candidate renews no authority or execution window.
