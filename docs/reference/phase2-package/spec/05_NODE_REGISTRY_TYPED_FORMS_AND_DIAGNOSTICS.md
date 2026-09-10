# 05 — Registered nodes, typed forms, guards, and diagnostics

## Registry admission

Read a digest-bound node registry from the actual Phase-1 owner. Each entry must
identify type/version, display-safe description, typed ports, config schema,
capability requirements, effect class, policy restrictions, allowed graph regions,
and protected/internal status. Presentation hints never override runtime schema.

If no registry projection exists, add a minimal owner-exported projection. Do not
infer mutation capability from an icon/name or replicate an exhaustive hardcoded
node list that will drift. Cache per server/schema/registry digest, not globally.
Update invalidates forms, advisory validation and publish eligibility.

## Required authoring forms

Create explicit, testable editors for each admitted family: observe/wait, route,
typed guard, analysis/decision provider reference, protected action, bounded loop,
subworkflow invocation, dynamic region, checkpoint/artifact, pause/approval and
terminal/error routing. Only include a family actually supported by Phase 1;
unsupported capabilities appear with reasons and cannot be published as runnable.

Use schema bounds for lengths, collections, numeric ranges and enum values.
Represent missing/unknown separately from false/zero/empty. Validate resource
and timeout units. Timeouts are configured in the owner unit, never converted
from animation duration or wall-clock formatting. Credential values are never
entered in a workflow form; use approved credential/profile references only.

## Typed guard builder

Expose a structured expression builder with registered fields and operators,
expected operand types, explicit three-valued outcomes and a preview against
approved synthetic/recorded data. Preview is pure evaluation of the owner's
admitted expression semantics or a clearly advisory client check; never a new
game execution path. No eval(), expression JavaScript, remote code or shell.

Show branch priority/order where semantic. Include unknown/unavailable routing
and flag missing exits. Reordering a guard branch is a semantic edit even when
its visual coordinates remain unchanged. Do not guess values from absent fields.

## Diagnostics lifecycle

Track local input, structural, type, capability, policy and authoritative compiler
findings separately. Associate each with candidate document revision, registry/
policy/capability digest and exact graph/node/edge/property path. A stale asynchronous
validation result cannot mark a newer draft valid. Cancel/debounce advisory work
and tag every worker/API result with the originating edit generation.

Diagnostics need severity, stable code, short explanation, relevant path and a
safe navigation target. Preserve backend typed errors without exposing server
paths, stack traces or raw unsanitized payloads. A malformed response is connection/
contract failure, not an empty valid diagnostics list.

## Raw JSON mode

Use a bounded lazy-loaded editor or accessible textarea plus diagnostics. Display
raw text and parsed semantic model as separate states while syntax is invalid.
Do not erase malformed text, coerce types or update the canvas with a half-parsed
object. Applying valid raw text is a single semantic history transaction and
requires explicit review when it changes many nodes. No network schema resolution.

An incomplete draft may be saved as bounded authoring data but cannot be marked
runnable until the canonical compiler accepts it. Imported unknown versions stay
archival/read-only rather than becoming unrestricted generic JSON execution.
