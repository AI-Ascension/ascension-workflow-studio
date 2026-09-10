# ADR-P2-007: Rebuild projections on event uncertainty

Status: accepted for Phase 2.

The client accepts only contiguous events for the selected run and definition digest. Exact duplicates are ignored. Gaps, foreign identities, conflicting sequence payloads, owner retention gaps, and schema transitions return a resnapshot result instead of guessing state or scheduling work.
