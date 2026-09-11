# Candidate 3 tested preview

Prepared locally; not activated by this lead. Coordinator owns actual Train export,
same-byte interoperability, host activation, served hashes and LAN browser proof.
This build accepts only `1.0.0-candidate.3`. The candidate2 privacy-patch package
remains unchanged for its currently active release and preserved history.

- Package: `candidate3.zip` (static website, not an import bundle).
- Archive SHA256: `459dd4d34807f7d6e4fc05e54643e044f126132cf083d44a6e215627b61bed32`.
- Release inventory digest: `52891bfb9614672cba058e1527b5c653b55e0c321f7a5aef6f8461569c77a821`.
- Four files, 871,744 bytes; exact inventory: `candidate3.manifest.json`.
- Schema SHA256: `a6c32127290f4d5e670d8863f97a74a7b8e3e411e735d81394b51fe1578b4eb6`.
- Protocol inventory SHA256: `580c1cf3be4bb3e4eb37b9acd9166808b7386b0eb84286cc0798a0d88e35bb35`.

Validation: 98 unit tests (8 valid/25 invalid owner vectors included); 8 Chromium
production-browser tests; six privacy differential probes plus three valid
baselines; equal legacy-failed summaries from Studio CLI and candidate3 oracle.
Candidate2 proofs are preserved under `history/recorded-run-candidate2/`, verified
byte-for-byte against privacy-patch commit `f18b735`. Both candidate2 deployment
packages remain under this directory. Every candidate3 owner artifact byte and
every declared tooling hash were independently compared to the source worktree.
The package was reread and checked against all browser-tested dist hashes/lengths.

Privacy gates cover manifest and all record profiles. Known payload source streams,
diagnostic digests, disposition pairs and shared pre-parse record limits are
enforced. Optional profile punctuation and generic identity equality remain valid.
All six designer nodes retain the verified contrast fix. Chromium coverage and
page-heap observations do not establish cross-browser or total peak-memory bounds.
