# ADR-P2-001: Keep execution authority in the harness

Status: accepted for Phase 2.

The Studio is a projection and authoring client. Validation, compilation, persistence, scheduling, command admission, replay, settlement, and gameplay authority stay in `sts2-harness`. A browser control sends a typed owner command and displays the result; it never performs a local action or starts a second scheduler.
