# Synthetic package fixtures

`fixture-index.json` declares exact expectations. A negative case passes the
package checker only when it is rejected at its specified layer. `accept` means
its seed shape is valid, not that it is a valid current Phase-1 API request.

The two valid layouts share the same exact definition-byte binding while node
positions differ. No layout field can override action policy. Semantic checks
also reject dangling references, duplicate layout entries and wrong bindings.

Display stream cases test duplicate handling, gaps, wrong bindings and conflicting
identities. They are a small **package checker**, not the product's reducer or an
execution kernel. Product tests must reimplement and broaden these expectations
in the admitted TypeScript/Rust test harness against the actual Phase-1 API.

The not-run attestation is intentionally empty. No sample fabricates a verified
agent. Invalid examples show that changing only a status string or letting a
D3 leaf spawn cannot qualify as proof.

Never send these fixtures to a live game, provider, or valued deployment. The
original copied Phase-1 fixtures are likewise synthetic and capability-unverified.
