# ADR-P2-008: Make draft and credential limits explicit

Status: accepted for Phase 2.

Fixture drafts use an in-memory adapter record. Live draft persistence is capability-gated because Phase 1 has no draft route. The bearer token input is memory-only, disabled for autocomplete persistence, and never included in draft documents, exports, logs, or telemetry.
