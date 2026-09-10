# 03 — Canonical document and lossless round-trip

## Authoritative representation

Use the implemented Phase-1 definition contract and compiler unchanged. The
frontend's typed edit model is an adapter, not another executable workflow format.
React Flow nodes/edges/viewport are view data; its `toObject()` output must never
be submitted as a gameplay definition [S02].

Import pipeline: enforce file/type/byte/depth limits -> reject duplicate JSON keys
and invalid numbers -> inspect schema/version -> owner-contract decode -> build
semantic edit model -> attach matching layout sidecar -> advisory diagnostics.
Backend validation is required before publish and run. Synthetic reference files
are useful adapter cases but not sufficient compiler conformance evidence.

Export pipeline: semantic edit model -> exact owner-contract fields -> owner
canonicalization/validation -> immutable artifact or bounded draft envelope.
Export layout separately or in an explicitly versioned non-executable Studio
bundle. The runnable definition extracted from that bundle is still Phase 1.

## Digest rules

Maintain independent source-file SHA-256, compiler definition digest, layout
revision/digest, registry digest, and API artifact digest. A raw file hash is not
a compiler semantic digest. Learn exactly which metadata/ordering/normalization
is covered by the producer; do not invent canonicalization in TypeScript.

No-edit import/export must preserve semantic identity under the owner compiler.
Where exact raw-byte preservation is promised, retain the imported original bytes
separately; do not claim byte identity after formatting. Layout-only edits must
leave compiler semantics/digest unchanged. Semantic edits create a new candidate
and invalidate prior validation. A version/label change may be semantic under the
owner contract: follow it rather than assuming metadata is excluded.

Preserve array order unless the producer explicitly declares it unordered. Do not
sort priority branches, first-match cases, action sequences, or argument arrays
just to stabilize serialization. Canonical comparison tests must cover Unicode,
null versus absent, zero versus missing, safe integer bounds and defaults.

## IDs and nesting

Use stable workflow/graph/node/edge IDs from the definition. A view key is qualified
by graph path and pinned subworkflow reference where needed. A runtime occurrence
uses node_execution_id; repeated loop visits are not one object.

Copy/paste assigns new IDs only to pasted local semantic elements and remaps all
internal references transactionally. References to pinned external subworkflows
remain external. Detect dangling data bindings, guard references and edge endpoints.
Reject collisions rather than silently merging nodes. A collapsed visual group
is not an executable subworkflow or parallel region.

## Unknown or incompatible content

Unsupported schema/registry versions open in read-only archival mode with original
bytes retained. Explain why editing/publishing is unavailable. Never strip unknown
fields and export an apparently valid but changed strategy. Unknown presentation
fields may be rejected or isolated under the declared sidecar compatibility policy;
unknown execution fields cannot become editable arbitrary bags.

Redacted/forbidden data stays redacted. A forward-compatible archival viewer must
not treat preservation as permission to render HTML, execute templates, fetch
URLs, reveal hidden fields, or persist prohibited content.

## Required round-trip corpus

Cover strict and dynamic definitions, typed ports, unknown-guard branch, nested
loops/subworkflows, selection interrupts, protected composites, budgets, pinned
references, annotations/layout, and every supported node kind. At least one test
must detect an accidental semantic change caused by a visual edge reconnect.
For each corpus case run the real compiler on both sides and compare admitted
semantic output/digest and deterministic recorded-input behavior where supported.

Property tests perform sequences of layout-only operations and assert no semantic
change; edit/undo restores the previous semantic candidate; paste/remap resolves
all references; text->canvas->text preserves all supported values. These are
product tests, not the package's minimal fixture checker.
