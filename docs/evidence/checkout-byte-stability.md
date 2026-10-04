# Byte provenance across Git checkouts

Contract locks, checksum lists, retained release artifacts, historical snapshots,
and recorded-run inputs identify exact bytes. `.gitattributes` marks their owning
directories `-text`, so Git does not convert those bytes when Windows uses
`core.autocrlf=true`. No recorded digest is changed, and the verifiers continue
hashing actual file bytes rather than a newline-normalized substitute.

Run `node tools/verify-contract-pins.mjs` and
`node tools/verify-byte-stability.mjs`. Windows CI runs both, plus the existing
contract-pin tests and archive-portability checks, after a normal checkout.

The audit covers all five tracked `SHA256SUMS` inventories, current and historical
`studio-pin.json` files, every tracked contract `.lock.json`, their local consumed
artifacts, the retained preview ZIPs' archive digests, and the original Phase 2
package through its portable filename map. The Studio bundle's retained HTML,
CSS and JavaScript are covered by `docs/evidence/studio-bundle.SHA256SUMS`.

`contracts/live-owner-ci.lock.json` pins repository commits and is byte-stable;
it does not claim a local source-file digest. Remote producer-source hashes in
the admission and inference-profile locks belong to their separate pinned
repositories and remain checked by the existing producer-seal job. Historical
preview manifest member hashes refer to members inside retained ZIPs rather
than independent extracted files; the recorded archive digest is checked here.
Recorded ZIPs and their index are explicitly byte-stable. This preserves local
provenance; it adds no deployment, provider, or native-game acceptance claim.
