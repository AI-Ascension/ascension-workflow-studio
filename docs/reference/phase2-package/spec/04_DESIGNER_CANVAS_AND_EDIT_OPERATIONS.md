# 04 — Visual Designer

## Application structure

Provide Library, Designer, Runs, Replay/Compare, and Compatibility/Settings routes.
Use durable IDs in deep links, never tokens or raw payloads. A Studio header shows
server identity, connection health, current workspace, explicit fixture/live mode,
and effective role. Designer shows draft name, base published revision, save state,
validation state and immutable/run pin separately.

Desktop: searchable palette/outline on the left; central controlled graph; selected
item properties on the right; diagnostics and contextual details below. Panels
resize within sensible minimums and collapse on narrower viewports. A semantic
list/table view offers equivalent editing without the canvas.

## Required canvas operations

Add registered node at a deliberate position; select/multi-select; connect typed
ports; reconnect an edge; inspect/edit guard; remove selected semantic elements
with an impact preview; pan/zoom/fit/minimap; align/distribute selected nodes;
auto-layout with undo; copy/paste bounded subgraphs; undo/redo; search by ID/type/
label; navigate into/out of nested graphs; select diagnostics and reveal target.

Every operation goes through a semantic edit command or a layout edit command,
not direct uncontrolled mutation of React Flow state. Group compound operations
into atomic history entries. Deleting a node requires explicit cleanup or rejection
of affected data bindings and incoming/outgoing control edges. Do not reconnect
neighbors automatically: that can change ordering, guards and game strategy.

Prevent invalid connections locally for immediate feedback; still run authoritative
backend validation. Errors identify the endpoint/type/guard issue. Color may
supplement but not replace a shape/icon/label. Distinguish control edges, data
bindings, guarded branches, recovery/error paths, and runtime traversal overlays.

## Protected and adaptive regions

Show the protected gameplay action as a locked composite. It may be placed where
the node registry permits; its internal admission/dispatch/reconciliation/settlement
steps are explanatory read-only detail. Locked internals are not hidden editable
JSON. No unlock/force/skip affordance.

Strict graphs support authored conditional branches, bounded loops, and AI decision
nodes. Label strict as fixed orchestration, not deterministic model output.
Adaptive regions show the permitted operation set, budgets, input/output contract,
replanning triggers and boundary. Editing them changes a draft definition only.
Live generated nodes are separately styled and always read-only.

## Nesting and layout

Use explicit graph navigation and breadcrumbs; retain viewport/focus per graph.
Render pinned reusable subworkflows with version/digest badges and an inspect-
reference command. Editing a library reference requires an intentional fork or
new version; it cannot silently modify all consumers. Visual grouping never creates
execution parallelism, a loop, or a subworkflow.

Run auto-layout in a bounded worker for larger graphs. Results include the exact
edit generation; discard obsolete results after user changes. Apply layout as one
undoable operation. Preserve manual pins where specified. No CDN or network calls
for layout. Do not animate a graph to simulate real run progress.

## Interaction correctness

Text fields, code editors, and accessible controls must not trigger graph-level
delete, paste, undo or keyboard shortcuts accidentally. Show shortcuts in a help
panel and provide menu/button alternatives. Unsaved changes are preserved or
explicitly discarded on navigation. Dirty state and server-saved state are distinct.
Provide error boundaries that retain recoverable draft data after rendering failure.

Read-only modes suppress semantic mutation in both UI and command reducers; adding
an invisible button is not authorization. A simulated canvas demo may exist only
as a clearly labeled test fixture route excluded from production by policy.
