# Studio architecture

The application is split into four boundaries:

- `packages/contracts` contains strict wire decoders and document/layout contract types.
- `packages/document` owns canonical semantic identity, layout sidecars, qualified IDs, edit history, and bounded graph operations.
- `packages/client` owns the relative owner adapter, explicit fixture adapter, safe command construction, and event projection recovery.
- `apps/studio` owns React presentation, React Flow projection, list-editor parity, navigation, and accessible status surfaces.

The browser does not schedule workflows, infer game actions, modify accepted runtime plans, or bypass protected action boundaries. Dragging changes the layout sidecar; semantic edits go through typed graph operations and history transactions.

The [management context-control catalog](context-control-catalog-adoption.md) has distinct
producer validation, fixture provenance and unavailable-state handling from memory/session limits.
