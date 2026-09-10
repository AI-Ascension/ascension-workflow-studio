# 03 — Canonical definitions, compilation, and versioning

## Definition ownership and representation

Own `ascension.workflow/v1` in the harness. The files in `contracts/` are proposed seed contracts with synthetic examples, not an already accepted protocol release. Before implementation, finish the runtime-specific node schemas, type registry, numeric/size bounds, and error codes under an ADR. Export a digest-bound artifact for the new repository to consume.

JSON is the mandatory canonical authoring/execution representation for v1. YAML is optional authoring syntax only after safe normalization tests; no custom tags, implicit dates, alias expansion, remote includes, or duplicate mapping keys. Shipping JSON alone satisfies the initial product. No executable JavaScript/Python/shell in definitions.

Separate `WorkflowDefinition`, `CompiledWorkflow`, `WorkflowRun`, `NodeExecution`, `AdaptivePlan`, and `GameOperation`. A graph file cannot contain a live cursor or authorize a current lease.

## Required semantic fields

Identity: schema ID/version, workflow ID, immutable semantic version, definition digest calculated by the compiler, author/source provenance, game adapter profile, required capabilities, policy reference/digest, entry graph, typed inputs, graphs/nodes/edges, node registry version, bounded budgets, and output contracts.

Policy is an independently approved registry item. Definitions may tighten limits, but never expand deployment policy. An embedded `require_settlement: false` or `mutation_limit: 2` is not a valid policy override; reject forbidden fields and values.

Keep `workflow_id`, `workflow_run_id`, definition revision, node ID, node-execution ID, plan ID/revision, run/episode/trajectory IDs, provider-execution ID, action ID, operation ID, session IDs, lease ID, boot/fencing epoch, request ID, and trace ID distinct. Use opaque validated identifiers/newtypes; do not derive authority from a human-readable name.

## Compiler pipeline

1. Enforce byte/depth/string/collection limits before or during parsing. Reject duplicate JSON keys, trailing garbage, non-finite values, unsafe integers, unknown schema versions, and unrecognized fields. JSON Schema alone does not reject duplicate keys after parsing.
2. Resolve only local registered node kinds, policy refs, capability refs, and pinned subworkflows. Never fetch remote schema refs during normal admission.
3. Validate node-specific config, typed inputs/outputs, required bindings, graph endpoints, stable IDs, graph invocation dependencies, allowed exits, and budget propagation.
4. Typecheck expressions and data dependencies. Reject reading an output before the producing node can execute, even when the control graph itself is connected.
5. Validate control-flow structure: reachable nodes, reachable terminal/error exits, no ambiguous ordered branch, no unrestricted cycle, bounded explicit loops/subworkflow depth, no implicit mutation parallelism.
6. Compile deterministic transition tables, policy/capability requirements, protected composite operations, and context/input manifests.
7. Compute a semantic digest with a documented canonicalization algorithm and golden vectors; persist source bytes and canonical artifact identity. Presentation metadata is never executable.
8. Produce diagnostics with workflow/node/field paths and stable codes, never secrets or arbitrary payload dumps.

## Graph semantics

Represent control edges and typed data bindings separately. Each node exposes named outcome ports: success plus explicit errors/unavailable/timeouts as applicable. Ordered guards use unique priority and first-true semantics. `unknown` has its own route; it is not silently false. Exhausted routes produce a typed workflow error.

Use a DAG per graph body. Repetition occurs through an explicit `loop` node referencing a body graph with a positive maximum iteration count and named exit outcomes. Subworkflow/graph invocation cycles are forbidden in v1; composition depth is bounded. This permits repeated gameplay without arbitrary graph cycles.

A strict run cannot edit nodes, edges, or pinned subworkflows. A loop's iteration count is durable and cannot reset on retry or restart. Compile nested bounds and use a global run limit so nested loops cannot multiply into unbounded work.

Guard expressions are typed ASTs: literal, approved-field reference, exists, eq/ne, ordered comparisons, and/or/not, bounded membership, and explicitly typed arithmetic where needed. Distinguish unavailable, null, false, zero, and empty. No general-purpose eval or user-defined functions. Numeric overflow yields a typed error.

## Node catalog

Implement observe, await-stability, route/guard, analyze, decide, adaptive-region, execute-action, subworkflow, bounded loop, checkpoint, emit-artifact, pause/approval, and terminal nodes. Node kinds require registered configs and typed outcome contracts. Unknown kinds fail admission.

`execute-action` is one protected composite operation, not user-rewirable dispatch and settlement pieces. `adaptive-region` returns a typed proposal/artifact to the fixed outer graph. Neither control edge labels nor a model-generated plan can jump inside the protected operation.

## Immutability and semantic diff

A published version is immutable; same identity/version with different semantic bytes conflicts. Cosmetic document annotations are bounded and excluded from semantic execution hash; preserve them losslessly as non-executable metadata. A semantic change produces a new revision. Provide inspect/diff output showing changed capabilities, policy, provider/prompt refs, guards, bounds, and graph structure.

No live definition hot migration in v1. Existing runs are pinned. Offline replay loads the original exact artifact or reports missing/incompatible bytes; it must not resolve a floating latest version.

## Acceptance

Positive fixtures cover strict AI decisions, every supported stage, nested bounded loops, available/unavailable capabilities, graph composition, and equivalent canonical bytes. Negative fixtures cover duplicate keys, unknown nodes/fields, unreachable nodes, invalid references, type mismatches, ambiguous priorities, all unbounded cycles, malformed ASTs, overflow, remote refs, excessive size, and policy escalation.

The seed JSON Schema intentionally leaves bounded node configuration extensibility for the implementer. Production completion requires strict node-specific schemas plus semantic validation, not merely passing the seed schema.
