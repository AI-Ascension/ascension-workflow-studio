# Ascension Workflow Studio

Phase 2 local-first browser application for authoring and inspecting admitted
Ascension workflows. The Studio is a client and presentation layer: canonical
workflow validation, persistence, scheduling, command processing, and gameplay
authority remain in `AI-Ascension/sts2-harness`.

The implementation branch is being built from the merged Phase 1 owner heads.
See `docs/architecture/phase1-integration.md` and `docs/operations/DEVELOPMENT.md`
for the current compatibility lock and local commands.

The current product includes a checked-in catalog library, React Flow designer,
keyboard list editor, semantic/layout separation, fixture and relative live
adapters, owner validation, owner-backed draft and publication adapters,
run inspection, revision-safe controls, event projection recovery, replay, and
redacted export. The draft adapter targets the additive authoring PR recorded in
`docs/architecture/phase1-integration.md`; a Phase 1-only owner still reports
those routes as unavailable.
The exact evidence boundary is recorded in `docs/evidence/PHASE2_EVIDENCE.md`;
fixture behavior does not stand in for a live harness process.

Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`
to reproduce the local checks. Phase 2 is delivered as a draft implementation
branch; this repository does not deploy or auto-merge.
