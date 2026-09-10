# ADR-P2-010: Produce a static, source-map-free bundle

Status: accepted for Phase 2.

Vite emits a static bundle with source maps disabled and no implicit server, scheduler, deployment, or provider effect. Delivery records include the build command, bundle inventory, dependency lock, and known limits. The large React Flow chunk is tracked as a performance follow-up.
