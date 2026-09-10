# ADR-P2-005: Group semantic edits through bounded history

Status: accepted for Phase 2.

Graph operations create immutable candidate snapshots in a small undo/redo history. Layout changes remain view state. The list editor uses the same operations as the canvas, so keyboard editing does not create a separate semantic path.
