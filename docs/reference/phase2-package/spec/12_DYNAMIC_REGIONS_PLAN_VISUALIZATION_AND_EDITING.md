# 12 — Dynamic-region authoring and live plan visualization

## Two different graphs

The authored definition contains strict structure and declared adaptive regions.
A generated plan is a bounded runtime artifact accepted by the Phase-1 planner/
validator. They have separate IDs, revisions, authority and lifetimes. Render
them as separate layers/panels; never flatten generated nodes into the authored
definition or autosave a live plan as though a user edited the workflow.

## Draft dynamic-policy editor

Expose the owner's permitted subworkflow choices and registered analysis/decision
node types, typed inputs/outputs, topology/parallelism/depth/plan-size bounds,
call/token/time budgets, replanning triggers, dependency validity, and declared
fallback/unavailable routes. Read allowed values from admitted registry/policy.
Definitions may tighten policy, not grant themselves a more privileged provider,
script tool, arbitrary network access, mutation channel or spawn capability.

Changing strict to dynamic requires an explicit semantic diff and validation;
it does not loosen protected execution. A dynamic region must not expose an
'execute arbitrary tool' palette item. Validate both authored region structure
and possible admitted operation constraints under the backend contract.

All edits target a draft. Publish creates a new immutable definition for a later
run. Do not offer Apply to active run unless an already implemented, explicitly
admitted safe migration contract exists and is separately scoped; it is not a
required Phase-2 feature.

## Live plan inspector

Show proposed/accepted/rejected/superseded plan revisions when those artifacts
are approved for retention. Use exact containing region/node invocation, source
observation identity, accepted definition/policy digests, registered operations,
budget reservations, dependency validity and short structured reason codes.
Rejected proposals may be unavailable for privacy; show status without fabricating
a graph. Do not expose private reasoning, prompts or raw provider outputs.

The active accepted plan is read-only. A superseded plan is historical, not a
new branch the browser can execute. Selecting an old plan never changes the live
region. Show supersession reason and distinguish in-flight obsolete analysis
from currently admitted work as the owner reports it.

## Stable visual presentation

Within one plan revision, preserve node positions by qualified semantic IDs.
For revision changes, compute a display diff and keep unchanged positions where
unambiguous. Use badges for added/removed/rejected nodes, not color alone. An
optional frozen layout/view must not freeze the live state projection silently.

## Required demonstrations

Use two controlled inputs that lead the existing Phase-1 dynamic engine to two
different accepted analysis DAGs. Observe both through Studio, compare revisions,
then show a rejected authority-expanding plan and a stale/superseded result.
The UI must reflect backend evidence, not generate random graphs for animation.
Demonstrate authoring a new bounded region revision and leaving the old active
run pinned to its original digest.
