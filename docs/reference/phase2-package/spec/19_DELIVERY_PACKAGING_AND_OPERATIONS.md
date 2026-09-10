# 19 — Delivery, packaging, and operations

## Required usable deliverables

A production-built Studio static bundle; admitted source/toolchain/dependency
locks; artifact manifest/checksums and license/SBOM inventory; real owner adapters
where needed; tested browser application; source-linked tests; compatibility and
requirement/fault matrices; original operator/developer documentation; sanitized
screenshots and manual accessibility report; linked draft PRs and final report.

The Studio repository contains this instruction package with provenance or an
accepted reference, not an assertion that its package checks were product tests.
Do not commit generated secrets, personal paths, browser session state, private
traces, game assets or build caches. Static release artifacts follow each owner's
policy and are not uploaded publicly without authorization.

## Build and hosting handoff

Verify package manager install from a frozen lock, typecheck/lint/test, production
build, browser tests against production CSP, static manifest/path checks, and
bundle acceptance by the harness web adapter. The startup documentation states
how the operator points an existing service at a verified bundle and explicitly
enables browser admission. It does not silently install, deploy, bind externally,
modify DNS, generate trust anchors or start a game/provider.

A development server is not the production serving path. Test path-base routing,
asset resolution, SPA refresh, offline/missing assets, current bundle/API mismatch,
malformed manifest, and prohibited file serving. No runtime CDN dependencies.

## Operations runbook

Cover pairing/session revocation, opening an existing run, editing/saving a draft,
conflict resolution, authoritative validation, publishing without running, launching
an admitted revision, safe pause/resume/step/cancel, reconnect/unknown effects,
historical inspection, redacted support export, optional capabilities, storage
recovery, and bundle rollback. Rollback preserves the harness database and running
definition pins. Downgrade refuses incompatible schemas instead of deleting them.

## Git and delivery

Use issue/PR dependency links across Studio and necessary owner changes. Do not
create duplicate issues for existing work. Assign to the authenticated operator
where supported, without guessing a user from old examples. Use disjoint worktrees,
small scoped commits and exact candidate SHAs. Resolve scoped CI failures and
conflicts; never hide failing checks, bypass branch protection or auto-merge.

The final report states source heads, created repository/visibility if any, issues/
PRs/commits pushed, tests and evidence levels, real model/depth attestation,
requirement exceptions, blockers, ownership and next safe steps. State explicitly
whether merge/release/install/deploy/live execution happened; default no.

## Completion rule

Source completion, browser verification, actual Phase-1 integration, native-host
scope, release readiness and deployment are separate outcomes. Do not label a
mock-only implementation complete. Do not stop useful bounded work merely because
native credentials are absent; finish all safe implementation/tests and identify
the precise unverified gate. No unattended agents or unowned subprocesses remain.
