# Candidate 2 privacy correction

Prepared locally; activation and served-byte verification belong to the coordinator.
`candidate2-privacy-patch.zip` is a static website deployment package, not a recording.
The original `candidate2.zip` and its manifest remain unchanged.

- Archive SHA256: `d24595db46054d09eb60698439b5170972585a30967c66fe55f712ddfab92d35`.
- Release inventory digest: `f5722374a5de4e7bd3393b42a64479b43c78cd7a0889d71f629e8d0885f3ca35`.
- Four files, 868,850 uncompressed bytes; exact names, sizes and hashes are in
  `candidate2-privacy-patch.manifest.json`.
- Wire version remains `1.0.0-candidate.2`; schema SHA256
  `d5098e5f969d99707d3ad1d97acdbc803285b93f1eb1dcfe5dc3f63c534192af`;
  protocol inventory SHA256
  `41d760f8c41064c4e6b49a48dbe6e1a6c8f2a9958afbc50374986a54858fd598`.

This build closes manifest and every-record identity privacy gates, including
common-gameplay and optional opaque branches. It also enforces reviewed source
and diagnostic mappings, disposition pairs, token controls and preallocation limits.
Generic recording/session tuple equality is still admitted without implying a join.
Both record files pass a shared 25,000-record preflight before record JSON parsing.

Validation: 90 unit tests, 8 Chromium production-browser checks, all six independent
privacy differential probes and their three valid baselines, and unchanged valid
legacy-failed summary against the preserved candidate2 oracle. Browser evidence is
under `docs/evidence/recorded-run-local/`. No host/provider/game action occurred here.
