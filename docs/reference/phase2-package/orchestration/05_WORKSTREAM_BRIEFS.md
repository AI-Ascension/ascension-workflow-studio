# Workstreams and dependency-ordered packets

Every packet is owned through D0 → D1 → D2 → D3. Dependencies in `tasks.json`
are normative; this index is a reading aid. A completed mock does not pass a real-service gate.

## FDN — Foundation and ownership

Own admission, exact repo creation, permissions, model preflight and cross-boundary ADRs. Do not rewrite Phase 1.

| WP | Mission | Dependencies | Requirements |
|---|---|---|---|
| WP-00 | Runtime model/depth preflight | None | P2-001, P2-002, P2-003 |
| WP-01 | Safe exact-repository bootstrap | WP-00 | P2-004, P2-005, P2-006 |
| WP-02 | Actual Phase-1 contract admission | WP-01 | P2-007, P2-008, P2-009 |
| WP-03 | Architecture, permissions and threat-model ADRs | WP-02 | P2-010, P2-011, P2-012 |

## CON — Contracts and document semantics

Own narrow admitted clients, semantic/layout types, registry and compiler round-trip. No second runtime.

| WP | Mission | Dependencies | Requirements |
|---|---|---|---|
| WP-04 | Typed client and compatibility discovery | WP-03 | P2-013, P2-014, P2-015 |
| WP-05 | Semantic document and layout contracts | WP-03 | P2-016, P2-017, P2-018 |
| WP-06 | Node registry and typed property forms | WP-04, WP-05 | P2-019, P2-020, P2-021 |
| WP-07 | Canonical import/export and property conformance | WP-05, WP-02 | P2-022, P2-023, P2-024 |
| WP-08 | Authoritative validation and diagnostics | WP-04, WP-06, WP-07 | P2-025, P2-026, P2-027 |

## DSG — Designer and visual interaction

Own usable controlled canvas/list/forms/nesting/history/raw/dynamic interaction. Protected operations stay immutable.

| WP | Mission | Dependencies | Requirements |
|---|---|---|---|
| WP-09 | Application shell and read-only vertical slice | WP-04, WP-05 | P2-028, P2-029, P2-030 |
| WP-10 | Controlled canvas and equivalent outline | WP-09, WP-06 | P2-031, P2-032, P2-033 |
| WP-11 | Edit transactions, history and bounded clipboard | WP-10, WP-07 | P2-034, P2-035, P2-036 |
| WP-12 | Strict nesting, guard and protected-composite UX | WP-10, WP-06, WP-08 | P2-037, P2-038, P2-039 |
| WP-13 | Raw mode and safe JSON portability | WP-11, WP-08 | P2-040, P2-041, P2-042 |
| WP-14 | Adaptive-region editor and read-only plan graph | WP-12, WP-08 | P2-043, P2-044, P2-045 |

## AUT — Authoring lifecycle

Own server-backed drafts, conditional writes/conflicts, publication and pinned templates. Publishing is not execution.

| WP | Mission | Dependencies | Requirements |
|---|---|---|---|
| WP-15 | Owner-backed durable draft and publication adapters | WP-03, WP-05 | P2-046, P2-047, P2-048 |
| WP-16 | Autosave and offline recovery UX | WP-15, WP-11 | P2-049, P2-050, P2-051 |
| WP-17 | Three-way conflict and semantic/layout diff | WP-16, WP-07 | P2-052, P2-053, P2-054 |
| WP-18 | Exact validation, publication and launch flow | WP-08, WP-15, WP-20 | P2-055, P2-056, P2-057 |
| WP-19 | Catalog templates and subworkflow provenance | WP-13, WP-18 | P2-058, P2-059, P2-060 |

## RUN — Browser and live operations

Own scoped browser admission, bounded status/events, safe command UX and run details. No direct gameplay verbs.

| WP | Mission | Dependencies | Requirements |
|---|---|---|---|
| WP-20 | Scoped browser pairing/session and static adapter | WP-03, WP-04 | P2-061, P2-062, P2-063 |
| WP-21 | Authenticated event transport and snapshot attachment | WP-20, WP-04 | P2-064, P2-065, P2-066 |
| WP-22 | Pure display reducer and resynchronization | WP-21, WP-05 | P2-067, P2-068, P2-069 |
| WP-23 | Run inspector, invocation details and safe artifacts | WP-22, WP-09 | P2-070, P2-071, P2-072 |
| WP-24 | Safe runtime command controller | WP-23, WP-20, WP-18 | P2-073, P2-074, P2-075 |

## INS — Inspection and replay

Own historical views, comparative debugging and optional read-only adjacent integrations. No live mutations from history.

| WP | Mission | Dependencies | Requirements |
|---|---|---|---|
| WP-25 | Historical replay and comparative debugging | WP-23, WP-07 | P2-076, P2-077, P2-078 |
| WP-27 | Optional map and observability capabilities | WP-23, WP-04 | P2-082, P2-083, P2-084 |

## QLT — Quality and independent review

Own tests, accessibility/visual/performance/security verification and final evidence audit. Reject mock-only integration.

| WP | Mission | Dependencies | Requirements |
|---|---|---|---|
| WP-26 | Server authorization and content-security implementation | WP-20, WP-13 | P2-079, P2-080, P2-081 |
| WP-28 | Accessible interaction and responsive implementation | WP-10, WP-12, WP-16 | P2-085, P2-086, P2-087 |
| WP-29 | Performance workers and bounded lifecycle | WP-22, WP-11, WP-13 | P2-088, P2-089, P2-090 |
| WP-30 | Cross-browser production UI acceptance | WP-19, WP-24, WP-25, WP-28, WP-14 | P2-091, P2-092, P2-093 |
| WP-31 | Actual Phase-1 service integration suite | WP-30, WP-15, WP-20 | P2-094, P2-095, P2-096 |
| WP-32 | Concurrency, restart and network fault matrix | WP-31, WP-26, WP-29 | P2-097, P2-098, P2-099 |
| WP-33 | Independent adversarial security and privacy review | WP-26, WP-31 | P2-100, P2-101, P2-102 |
| WP-34 | Visual and manual accessibility acceptance | WP-30, WP-28 | P2-103, P2-104, P2-105 |
| WP-38 | Independent final integrated acceptance | WP-32, WP-33, WP-34, WP-36, WP-37 | P2-115, P2-116, P2-117 |

## DLV — Build and delivery

Own reproducible artifacts, current CI, runbooks, linked draft PRs and honest completion. No auto merge/deploy.

| WP | Mission | Dependencies | Requirements |
|---|---|---|---|
| WP-35 | Reproducible static build and acceptance bundle | WP-30, WP-26 | P2-106, P2-107, P2-108 |
| WP-36 | Developer/operator runbooks and migration notes | WP-35, WP-24, WP-25, WP-17 | P2-109, P2-110, P2-111 |
| WP-37 | CI and cross-repository integration checks | WP-35, WP-31, WP-33, WP-34 | P2-112, P2-113, P2-114 |
| WP-39 | Linked draft-PR delivery and final report | WP-38 | P2-118, P2-119, P2-120 |
