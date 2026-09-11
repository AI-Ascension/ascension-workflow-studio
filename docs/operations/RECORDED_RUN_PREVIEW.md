# Train preview deployment

Status: coordinator reports the original candidate2 release is deployed. The local
`candidate2-privacy-patch.zip` replacement is tested and prepared, not deployed by
this lead. Its adjacent manifest binds the reviewed transport and served-file hashes.
See `artifacts/recorded-run-preview/candidate2-privacy-patch.md` for the exact pin and
local verification. Candidate3 repinning awaits the protocol owner's final inventory.

The Studio lead reviewed and copied these coordinator-prepared assets into
`tools/deploy/`. This repository's local test package is
`artifacts/recorded-run-preview/candidate2.zip` with an adjacent exact inventory.
UFW, linger and Train unit validation below are coordinator-supplied evidence;
the Studio lead did not access the host. Coordinator must reverify at activation.

The preview remains private to `http://192.168.1.146:4173/`. The service binds that
IPv4 interface explicitly. The existing active UFW rule allows port4173 from
`192.168.1.0/24`; no public proxy or tunnel is part of this deployment.

## Release procedure

1. Finish Studio's build, tests and browser import verification. Record its source
   revision, dirty diff digest and pinned contract alongside the test evidence.
2. Run `python3 tools/deploy/package-preview.py <tested-dist> <output.zip>`.
   Preserve the adjacent `.manifest.json` file with the package. Its release digest
   binds the sorted per-file size/hash inventory; archive SHA256 binds transport bytes.
3. Transfer through the authenticated host connection into a new staging directory.
   Verify archive SHA256, safe regular-file entries, exact inventory, lengths and
   per-file SHA256 before promotion. Never unpack over the current preview.
4. Store the verified tree under
   `/home/completetrain/.local/share/ascension-workflow-studio/releases/<release-digest>/`.
   Preserve the previous build as a separate verified release for rollback.
5. Install `tools/deploy/preview-server.py` in that parent directory and the reviewed `tools/deploy/ascension-workflow-studio.service` unit
   in `/home/completetrain/.config/systemd/user/ascension-workflow-studio.service`.
   Update the `current` symlink atomically. Stop only the verified legacy preview PID
   holding port4173, then reload and enable/start the user service.
6. Verify the active service, bound listener, every served asset digest, and the same
   real recording import in a browser against the LAN URL. Capture browser errors,
   screenshots and exact source/export reconciliation. Recheck source fingerprints.
7. Reconnect independently after closing the deployment transport and confirm the
   service remains active and serves the tested bytes. Record final service state and
   release/rollback paths here. Do not infer independent LAN-client proof from the VM.

## Operations after installation

Run as `completetrain` on Train:

```sh
systemctl --user status ascension-workflow-studio.service
systemctl --user restart ascension-workflow-studio.service
journalctl --user -u ascension-workflow-studio.service -n 100
systemctl --user stop ascension-workflow-studio.service
```

The user manager has `Linger=yes`, so an enabled service can run without an open
Cockpit connection. The server resolves the release directory at startup; restart
after changing `current`. Rollback sets `current` atomically to the preserved previous
release, restarts the service, and repeats served-byte and browser checks. Exact
release paths will be recorded after deployment; no placeholder is a completed rollback.

The original recordings and seed-readiness release copies are never deployment targets.
