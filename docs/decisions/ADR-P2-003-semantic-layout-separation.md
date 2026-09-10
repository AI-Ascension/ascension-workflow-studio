# ADR-P2-003: Keep semantic content separate from layout

Status: accepted for Phase 2.

Workflow JSON is canonical semantic content. React Flow positions are stored in a versioned layout sidecar keyed by qualified graph/node IDs. Dragging can update positions without changing the semantic digest. Layout validation rejects dangling or duplicate bindings before a bundle is considered usable.
