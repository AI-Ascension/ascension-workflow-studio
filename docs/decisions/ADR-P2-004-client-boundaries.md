# ADR-P2-004: Use narrow relative-path clients

Status: accepted for Phase 2.

`OwnerApiClient` is limited to the admitted management routes, uses same-origin relative paths, keeps bearer tokens in memory, and decodes responses with Zod schemas. `FixtureClient` implements the same interface for deterministic local inspection and is surfaced in the UI as a fixture mode.
