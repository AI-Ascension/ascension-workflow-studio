# Contract seeds and admission

These are **proposed Studio-owned presentation/attestation seeds**, not a second
workflow schema, not executable game contracts, and not a claim that a Phase-1
API supports their fields. Validate them for package integrity, then discover,
adapt, review and version the actual contract before implementation uses it.

`studio-layout-v1.schema.json` carries inert positions and notes and binds exact
workflow reference bytes through `definition_artifact_sha256`. That digest is
not the compiler's canonical semantic digest. The product must preserve the
owner's actual canonicalization, schema, capabilities and ordering semantics.

`command-view-v1.schema.json` models only client display certainty. An unknown
command has no applied revision. A matching authoritative applied receipt is
required before the product displays completion. It does not authorize dispatch.

`display-projection-fixture.schema.json` is a deliberately synthetic, contiguous
**authorized** stream for display-reducer tests. It does not redefine Phase-1
sequence or filtering behavior. Use the actual snapshot/watermark protocol and
server incarnation rules from the admitted contract. The package reducer never
chooses or executes workflow nodes, providers, or game actions.

`operation-needs.json` is a logical integration checklist. Null route/schema
values are deliberate unresolved fields. Replace them with source-backed
mappings in the execution lock; do not turn the names into guessed HTTP routes.
An absent needed owner operation gets a bounded additive owner PR, not a mock
that is reported as an implemented integration.

The Phase-1 schemas under `reference/phase1/contracts` are copied historical
seeds, preserved byte-for-byte. They are validated solely as supplied examples.
Actual implementation artifacts outrank all seeds.
