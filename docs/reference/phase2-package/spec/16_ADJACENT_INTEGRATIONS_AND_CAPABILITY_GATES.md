# 16 — Adjacent integrations without scope expansion

## Catalog and conformance

Consume first-party workflows and acceptance vectors from `ascension-workflow`
via explicit source/artifact pins. A template should open in Studio, validate
with the actual harness and export with equivalent semantics. Add Studio-specific
conformance consumption records to the delivery repository only where needed.
Do not create a new catalog with unexplained divergent copies.

## Map view

The gameplay map and the orchestration graph are different graphs. An optional
side panel may show `ascension-map-visualizer` or the existing admitted visible-map
read projection. Pin map generation/instance/schema and show stale/unavailable
state. No hidden topology, inferred future outcomes or navigation actions through
a drawing. Lack of a map integration must not block authoring or generic run
inspection. Do not rebuild the map visualizer in Phase 2.

## Observability

Link approved trace/run identifiers to configured observability views or show
bounded approved summaries. A trace deep link is not permission to expose raw
prompts/outputs. No embedded credential tokens or arbitrary event-provided URLs.
Keep the authoritative run journal in Phase 1; observability is a secondary
consumer, not a command store or runtime source of truth.

## Context tools and other future UI

If a separately implemented context-window UI exists, link it through an admitted
read-only capability with clear data policies. Do not assume it was implemented,
copy its code, expose reasoning tokens or implement it as a hidden Phase-2
requirement. This package is workflow Studio, not every organization's UI project.

## Watchdog and service ownership

Add health/readiness metadata only if required by current deployment contracts.
Browser disconnect or a static bundle reload cannot cause watchdog to restart a
game/harness. An optional web adapter can be supervised, but gateway/harness
process authority remains unchanged. Do not install services or restart the host.

## Capability UX

Present feature availability with verified profile, schema version, permission,
source/evidence status and actionable explanation. Distinguish unavailable,
unsupported, forbidden, stale and disconnected. Hide or disable only the affected
optional feature; mandatory core integration gates remain explicit. A missing
feature is not silently supplied by a stub or a private unversioned endpoint.
