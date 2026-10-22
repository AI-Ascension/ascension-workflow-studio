# Original-request submission recovery

Studio retains an uncertain V1 run submission under the request identity used
for target preflight. A lost reply, malformed success response, timeout, or HTTP
error can occur after the owner reserved or launched a run. In particular,
Harness can report an unresolved launch-observation failure with HTTP 409.
The status code alone cannot establish that no run was created.

## Operator flow

After an uncertain POST, **Check original submission** performs a read-only
lookup of the retained request. Studio keeps the reviewed definition, target,
profiles and request ID in the current tab. It blocks cancellation, selection
changes, adapter changes and replacement run identities while that submission
is unresolved. Navigating to another workspace does not discard the panel.

| Owner result | Studio action |
| --- | --- |
| `missing` | Offer an explicit **Retry the same request**, with exactly the retained bytes and ID. No automatic POST occurs. |
| `pending` | Keep the original identity. Check again, or inspect a reserved run if its ID is available. |
| `submitted` | Adopt the returned original run and revision, then release the pending setup. |
| `failed` | Keep the identity and offer inspection if a reserved run exists. Failure does not prove rollback or authorize another launch. |
| Unavailable, unauthorized, malformed or mismatched readback | Keep the identity without retry permission. HTTP 404 is not a recovery `missing` result. |

A first submission refused locally before its fetcher is called can return to
setup and be cancelled. The client marks that case explicitly with
`RunSubmissionNotStartedError`. The UI never infers it from an HTTP status or
message. A later local refusal cannot release an earlier ambiguous attempt.

The adapter refuses concurrent POST/readback operations for the same identity.
A new readback revokes any previous retry permission until it returns a valid
`missing` result. At most 32 unresolved requests are retained by one client.
The owner remains the authority for admission, idempotency and execution.

## Contract and transport

The copied schema and vectors in `contracts/management-recovery/` are pinned
to Harness `8ba0c73d55107583a5b21fcae5a5454797ba8110` in
`contracts/management-recovery.lock.json`. The contract-pin tool verifies their
SHA-256 digests. Tests consume the unmodified producer vectors and compare the
consumer decoder with the producer JSON Schema.

The consumer additionally requires exact JavaScript integer revisions, matching
requested/readback IDs and matching outer/nested submitted run IDs. The separate
`ascension.management-error/v2` envelope admits `write_state_unknown`;
the historical `ascension.management/v1` error vocabulary stays closed.

Submission and recovery use the relative owner base, memory-only credentials,
same-origin credential policy, no redirects and no caching. Each operation has
a 45-second deadline and a 64 KiB response limit. Decoding rejects malformed
UTF-8, duplicate keys, unpaired surrogates, nesting beyond 32, more than 16,384
JSON values and decoded strings above 4 KiB. Request bodies are limited to
1 MiB. Invalid success bytes retain uncertainty.

Preflight, POST and readback are bound to an authentication generation. Changing
the normalized token or actor subject fences the original operation, including
an A-to-B-to-A change. Reapplying identical normalized values for a health check
does not change that generation. Checks after awaited transport completion
prevent adoption if response cleanup changes the session. Credentials and
request bodies are not written to browser storage.

## Evidence and limits

Client, contract and UI tests cover retained post-launch errors, original-ID
readback, exact-byte explicit retry, concurrency, transport limits, authentication
changes and local refusals. Browser routes exercise these journeys with
synthetic responses. Fixture readback sees only that fixture's own in-memory
submissions; it does not imply an owner process or a native run.

This change does not repin `contracts/live-owner-ci.lock.json`, which still
uses Harness `3a641cc6669818e4709c3a58a68ef41302d8860a`. An older owner without
the recovery route leaves the request unresolved. Actual authenticated
lost-reply recovery against a current owner, native/provider execution and the
original Studio #214 runtime failure remain separate acceptance work.

Retention is memory-only for the current tab and client. Reload or tab closure
does not provide durable recovery; keep the tab open while reconciling. This
does not complete persisted reload recovery or integrate the separate seeded V2
setup flow.
