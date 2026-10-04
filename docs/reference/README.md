# Portable view of the Phase 2 reference package

The retained Phase 2 instruction package originally contains
`prompts/workstreams/CON.md`. Windows reserves the basename `CON` even when it has
an extension, so the extracted Git view stores that member as
`prompts/workstreams/CON-contracts.md`. Its contents are unchanged.

[`phase2-portable-paths.json`](phase2-portable-paths.json) records the original
repository commit, exact original metadata hashes, and the original-to-extracted
filename mapping. All other member names and all package bytes, including
`PACKAGE_MANIFEST.json` and `SHA256SUMS`, remain unchanged. The workstream identifier
`CON` remains valid and is not renamed.

From the repository root, run:

```text
node --test tools/verify-checkout-portability.test.mjs
node tools/verify-checkout-portability.mjs
```

The check validates every original manifest/checksum entry through the mapping,
rejects missing, extra, changed or symlink package members, and checks all tracked
filenames against Windows naming rules. CI runs these checks before the product
checks. No filesystem protection or sparse-checkout workaround is required for an
ordinary clone of the corrected tree.

The package's historical tools and instructions describe its original member
identities. To run those tools unchanged, reconstruct the original member names
on a filesystem that admits them, using the mapping in reverse, and verify the
original checksums before running the package-only tests. Do not rewrite its
manifest, checksum list, source-provenance records, or historical instructions to
make them describe this extracted view. This repository retains the extracted
payload, not an original source ZIP; these checks establish payload integrity,
not the availability or checksum of an external ZIP.

This reference package is planning input. Package verification does not establish
Studio runtime, provider, deployment, or native-game acceptance.
