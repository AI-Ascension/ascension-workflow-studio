# Pinned map projection fixture

`visible-map.golden.json` is a byte-for-byte copy of the admitted read-only
visible-map projection from `sts2-game-mod`:

- source: `sts2-game-mod/protocol-artifact/runtime-map-v1/golden/visible-map.json`
- source sha256: `bbb959f20a5293032072ee9ab30c9489807ad185cec7d740f15dd929a9bfa622`
- schema: `visible-map-v1` (producer projection `runtime-map-v1`)

The Studio consumes it only as an inert read-only projection. It is not a
workflow graph, grants no navigation authority, and carries no hidden state.
