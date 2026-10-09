<!-- SPDX-License-Identifier: MIT -->

# Fixed Console owner request preparation

This module prepares complete HTTP/1.1 byte frames as **untrusted input**. It
does not listen, connect, forward, persist, authenticate, authorize, parse owner
responses, or establish a principal, grant, TLS/tunnel identity, or provenance.
It is a source prerequisite for Studio #108; it does not complete that issue.

`parsePreparationConfig(bytes)` accepts only `schema_version`, `mode`,
`expected_host`, and `expected_origin`. The schema is
`studio.console-owner-preparation.v1`, the mode is `prepare_only`, and the
configuration limit is 16 KiB. These fields are local configuration, not
owner-issued evidence. A null expected Origin requires an absent Origin header;
a configured Origin requires an exact match. Host also matches exactly.

`parsePreparationEnvelope(frame, config)` accepts only the three literal POST
targets in `routes.mjs`. It refuses normalization, queries, forwarding/principal
headers, duplicate authority headers, Transfer-Encoding, inconsistent lengths,
invalid UTF-8/JSON, decoded duplicate JSON keys, and excessive depth or size.
Limits are 8 KiB headers, 1 MiB body, depth 32, and 32 headers. The complete
bounded frame is copied into owned storage before inspection. Copying shared
storage does not promise an atomic snapshot of concurrent writer activity; the
resulting owned sequence is parsed consistently.

Bearer/CSRF values are syntax or presence only and are absent from the result.
The returned body is an owned but mutable `Uint8Array`; the TypeScript brand
and `authority: "none"` are local type distinctions, not security proofs.
Any future consumer must independently validate the exact bytes it uses against
the closed Console DTO schema and obtain current owner authentication,
authorization, recovery, and transport evidence. JSON framing alone is not DTO
conformance or permission to send or disclose anything.

Owner framing limits and Origin behavior are derived from Console commit
`bc03102f873508cccd6ec2661288e0c33d83ae3d`. Studio ingress paths and the local
configuration schema are additive preparation contracts. Existing `/v1` and
`/api/context` behavior is unchanged.

Run `npm run typecheck:fixed-owner-preparation` and
`npm run test:fixed-owner-preparation` with the repository-pinned Node 24.16.0.
The validation workflow runs both checks independently of the existing Vitest
suite. Served integration, semantic request/response contracts, browser/UI,
native/provider evidence, and deployment remain separate acceptance work.
