# Management context-control catalog

Studio consumes the existing authenticated `GET /v1/context-bindings` response through its
same-origin owner client. This catalog is separate from memory/session capabilities and
policy limits. It does not add an endpoint, wire field, capacity or owner execution behavior.

The strict consumer mirrors producer identifier, collection, enum, grant and uniqueness
validation, including all five descriptor ceilings:

| Field | Accepted descriptor range | Meaning |
|---|---:|---|
| max_items | 1..64 | selected references |
| max_notes | 0..16 | notes; zero permits none |
| max_context_bytes | 1..131072 | bytes per input/schema/configuration buffer |
| max_objective_bytes | 1..512 | explicit objective bytes |
| max_control_events | 1..4096 | recorded/retained events |

These ranges validate metadata. The current producer does not pass smaller selected values
into rendering or journaling. The UI therefore presents reference information without
claiming selected-limit execution. No objective/context relation is invented.

Descriptors hash compact UTF-8 JSON in Rust serde struct order with an empty digest field.
The catalog hashes `[owner_id, owner_version, descriptors]`, preserving array order and
including sealed descriptor digests. Sorted-key JSON is not this encoding. Unknown and
missing fields, duplicate identities, unsupported enum values and bad grant relations reject
before hashing. Unsupported node kinds may be valid metadata but never become Studio
analyze/decide options. Ambiguous owner matches are also unselectable.

The response reader counts bytes while streaming and cancels on overflow; Content-Length
is not authority. Absent bodies, invalid/truncated UTF-8 and raw duplicate keys reject.
Existing bounded JSON guards remain 2MiB, depth32, 20,000 values and 64KiB encoded strings.
A maximal producer-shaped catalog with 128 descriptors, 16 kinds/sources, all 11 operations
and maximal supported identifiers/versions fits these guards in tests. Safe positive integer
versions are supported; larger Rust u64 versions are explicitly unsupported, never rounded.
Raw numeric tokens must use plain unsigned integer spelling within JavaScript's safe range,
matching producer u64 wire admission; fractions, exponents and negative zero reject before conversion.
Consumer parser guards are not newly published owner capacities.

The Designer invalidates selectable bindings during loading, refresh and client/principal
change, and ignores late prior responses. Failed refreshes cannot fall back to legacy
capability hints. Disabled, denied, unattached, stale and unsupported descriptors remain
inspectable without selectable options. Existing unmatched workflow references remain visible
and unchanged in both graph and list inspectors; the owner still validates the workflow.
No expiry clock is inferred from a v1 catalog without an expiry field.

`contracts/context-control-catalog.lock.json` pins the exact producer fixture to reviewed
Harness merge `f6484069298847b09b66d242942497b942a3dc18`. SHA256 is
`539b87429d4918b55755adab67bb6ed71989e6d90be165b5a396d3124f342c31`.
Its embedded `9978214` origin remains historical. Fixture mode uses the actual default
producer catalog, which discloses `context.fixture.v1`, instead of inventing ten supported
references. Self-consistent fixture hashes establish integrity, not authentication.

Contract/client/UI tests and synthetic management-route browser journeys cover admission,
limits, unavailable states and refresh safety. Browser interception verifies the real client
decoder and presentation with a synthetic response; it is not running-owner evidence.
The unchanged authenticated loopback-owner lane remains separately attributed.
Harness consumer-pin drift integration, selected-limit enforcement, saved-policy migration,
token accounting and native/provider execution remain outside this increment.
