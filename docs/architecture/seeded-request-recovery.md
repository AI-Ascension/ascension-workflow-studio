# Seed-v2 exact request recovery (partial Studio #111)

This additive client capability addresses one part of T2. It does not enable
seed authoring in the application, claim launch setup support, or complete
Studio #111. Existing v1 and fixture clients are unchanged.

Reconciled against Studio `dff2c752` after merged PR #264: its original v1
submission readback, explicit missing-only retry, authentication normalization and
generation fences are preserved. That current-tab v1 recovery is separate from
this opt-in seeded-v2 exact-body replay; neither adds durable application setup UI.

## Owner contract and authority

The consumed Harness revision remains
`3a641cc6669818e4709c3a58a68ef41302d8860a` in
`contracts/live-owner-ci.lock.json`. Its
`management/service_seed_v2_submit.rs` authenticates and binds request and actor
digests before looking up an existing operation. Existing operations reconcile
against their historical admission. Missing operations undergo owner target
revalidation. Its `management/production_seed_v2_replay_tests.rs` contains
`served_seed_v2_replays_lost_responses_with_the_pinned_key_after_rotation_and_restart`:
exact request replay after SQLite reopen/catalog rotation retains the operation,
configuration digest and effective seed, performs no current-key draw and makes
zero runtime calls. That is source provenance, not a newly executed native test.

Recovery therefore replays original bytes to the original relative v2 endpoint
with newly supplied authentication. It does not request a new preflight, rebuild
an admission, regenerate a request ID or derive a seed locally. Local storage is
untrusted input, not authorization. The owner still enforces access, conflicts,
historical-record integrity and the unreceived-operation admission path.

## Opt-in API and privacy

`OwnerApiClientOptions.seededRecoveryStorage` accepts a synchronous private
storage implementation exposing `getItem` and `setItem`. No storage
is selected by default and the application does not opt in in this increment.
The application integrating this API must choose an appropriate private,
origin-local lifetime and provide explicit recovery UI. It must serialize writers for a scoped request
across tabs/clients; Web Storage get/set is not a cross-tab compare-and-set
transaction. This partial API does not provide multi-tab arbitration. Supplying durable storage
is a deliberate decision to retain workflow content locally, not a guarantee of
encryption, isolation from same-origin scripts, or persistence against user/browser
storage clearing. A session-scoped implementation survives a page reload but not
a closed tab; a persistent implementation can outlive the tab.

The storage namespace includes the normalized API base, authenticated subject and
request ID. Values contain only the exact validated submission body: seed,
workflow definition, target/profile/context identifiers and original admission.
Bearer tokens and request headers are never stored. There is no console output,
export inclusion, provider request, telemetry or remote-storage write added by
this capability. These records must not be copied into portable workflow exports,
public bug reports or provider input. The caller must never use a shared or
publicly synchronized storage backend for private workflow bodies.

Before any new submission the client stores and reads back the exact body.
Unavailable storage, quota failure, failed readback or a different body under an
existing request ID blocks that attempt before network dispatch. Previous unknown
outcomes remain unknown. Credentials/subject changes do not delete or replay old
records. Constructing a client never reads or automatically sends a pending request.

After reauthentication, an operator can explicitly invoke
`recoverSeededRunV2(requestId, independentlyWitnessedOriginalBody)`. The required
second argument is the exact serialized request body from a separately trusted,
immutable original-dispatch record, **not** another value read from mutable
`seededRecoveryStorage`. If that independent evidence is absent, the client
fails closed and sends no request. A digest saved beside the mutable body is not
an independent witness. The integration must preserve this evidence separately
and verify its provenance; the client cannot establish provenance for caller
supplied strings. A mismatched original rejects before network dispatch. Only
then does the client bound and validate stored JSON and check
request/target/workflow identities and the definition digest before dispatch. A
wrong subject or base has no matching record. A session change during validation
or receipt handling refuses acceptance. No retry loop is installed.

## Retention and cleanup

All responses retain the exact body, including `resolved`. Transport loss,
malformed replies, authentication failure, conflict and server errors retain it
as well. A resolved network response proves owner settlement, not that the
application durably recorded the receipt or workflow run ID. Deleting the sole
request before that acknowledgement would lose recovery across a crash between
client acceptance and application persistence. This client therefore performs no
automatic cleanup and never alters a changed record when accepting a response.

There is no discard API, receipt acknowledgement transaction or background expiry
in this increment. Before integrating the API, an application must define durable
receipt storage and a deliberate retention/discard policy. Removing local recovery
data does not cancel a possibly admitted owner operation. The application's
storage implementation owns bounded retention and lifetime; this client's existing
in-memory unresolved capacity is unchanged. Replaying a retained settled request
continues to rely on owner deduplication, not on a client-side exactly-once claim.

## Remaining feature gates

At the consumed revision there is no target seed-support catalog. Newer Harness
PR #839 merged as `2678a325e23a70753b36baddcc1da83a6944083b` adds authenticated
`GET /v2/workflow-targets` with independent durable candidate and currently-ready
modes. Its `supported_launch_setups` is strictly empty; candidate support is not
launch readiness. Future Studio adoption must review/pin that contract separately,
validate descriptor/catalog binding and preserve this distinction.

T1 controls, requested/effective display and T2 copy/setup identity and browser
reload journey are not implemented here. Unsupported character/difficulty/
modifier/context choices must not be manufactured from seed text or inferred
from candidate support. T3 still requires owner integration and authorized native
settlement through Studio #107, Harness #96/#103 and game-mod #78/#79. All five
were open when checked 2026-10-22. Repeated seed text alone proves no equivalent
build/profile/context or reproducible native run.

## Evidence boundary

New tests use synthetic fetch and storage implementations. They test exact
multibyte/derive-once request replay after client replacement, storage failure,
identity isolation, conflict, corruption, session change and retention lifecycle.
They do not prove a browser storage lifetime, owner-process restart in this
consumer, downstream game start, provider behavior or native settlement.
