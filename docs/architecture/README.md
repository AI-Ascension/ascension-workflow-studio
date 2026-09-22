# Studio architecture

The application is split into four boundaries:

- `packages/contracts` contains strict wire decoders and document/layout contract types.
- `packages/document/src/index.ts` is a public re-export facade. It owns canonical semantic
  identity, layout sidecars, qualified IDs, edit history, and bounded graph operations, split
  into cohesive modules: `semantic-document` (definition type), `owner-nodes` (owner kinds,
  output ports, binding validation, default/convert configs), `json` (canonical JSON),
  `bounded-json` (bounded parsing and definition import classification), `digest` (semantic and
  definition-identity digests), `layout` (layout sidecars and flow projection), `document-edits`
  (structural edits and clipboard), `bundle` (digest-bound bundle I/O), `merge` (three-way merge),
  and `history` (undo/redo).
- `packages/client/src/index.ts` is a public re-export facade. It owns the relative owner
  adapter, explicit fixture adapter, safe command construction, and event projection recovery,
  split into cohesive modules: `errors` (shared error taxonomy), `types` (client interfaces and
  the `StudioClient` contract), `transport` (relative-base/identifier helpers), `targets`
  (target admission/configuration guards), `fixture-catalogs`, `records` (owner record decoding),
  `provider-policy` (policy upload guards), `projection` (run projection, SSE parsing, safe
  commands), `context-service` (read-only Context client), `owner-api` (live owner adapter), and
  `fixture` (in-memory fixture adapter).
- `apps/studio` owns React presentation, React Flow projection, list-editor parity, navigation, and accessible status surfaces.

The browser does not schedule workflows, infer game actions, modify accepted runtime plans, or bypass protected action boundaries. Dragging changes the layout sidecar; semantic edits go through typed graph operations and history transactions.

The [management context-control catalog](context-control-catalog-adoption.md) has distinct
producer validation, fixture provenance and unavailable-state handling from memory/session limits.
