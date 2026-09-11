# Tested candidate preview package

Status: built and verified locally; **not deployed** by the Studio lead.

`candidate2.zip` packages the four files from the locally tested production `dist/`.
`candidate2.manifest.json` binds every byte length/hash and the transport archive.
It matches `docs/evidence/recorded-run-local/build-assets.json` exactly.

- Candidate: `1.0.0-candidate.2`
- Schema: `d5098e5f969d99707d3ad1d97acdbc803285b93f1eb1dcfe5dc3f63c534192af`
- Protocol inventory: `41d760f8c41064c4e6b49a48dbe6e1a6c8f2a9958afbc50374986a54858fd598`
- Release inventory: `4984edd81b7562bc561a2b592c95f8202f8e0cdbe59d708ae8b0307af3a68231`
- Archive: `292647c36c202970f255c643b06278ad7e13618e2236af11d998e3cffabe5eb9`

The coordinator owns transfer, validation, host activation, real-run LAN browser proof
and rollback. Use `docs/operations/RECORDED_RUN_PREVIEW.md`. This ZIP is a **static
application deployment package**, not a recorded-run import bundle.
