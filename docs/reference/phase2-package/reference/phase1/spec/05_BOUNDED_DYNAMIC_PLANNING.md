# 05 — Bounded dynamic workflow planning

## What dynamic mode must actually implement

A dynamic region supports two concrete capabilities: selecting a pinned registered subworkflow, and composing a bounded typed DAG of registered analysis/decision operations. Merely choosing a different action inside a fixed decision node is not sufficient dynamic-workflow implementation.

The outer graph stays immutable. The region receives an immutable approved context, objective, policy digest, node-registry version, and remaining budget. It returns a typed `DecisionProposal` or approved structured artifact. The outer graph owns execute-action, recovery, and terminal transitions. A dynamic plan never dispatches a game action itself.

## Planner port

Use a provider-neutral `PlanSource` port, reusing the existing provider adapter boundary where possible. Its request includes workflow/run/region identity, source observation ID/generation, capability digest, objective revision, policy digest, dependency manifest, registered operation descriptors, pinned prompt refs, available structured prior artifacts, and remaining budget.

Its response is untrusted data: plan ID and candidate revision, base run revision, region ID, bounded nodes and dependencies, registered operations, typed bindings, proposed output binding, dependency predicates, cost reservation, and concise reason/evidence references. No executable code, raw tool URLs, arbitrary provider IDs, credentials, unrestricted prompts, hidden game fields, or arbitrary JSON-pointer reads.

Keep the planner's optional structured explanation bounded. Do not request, persist, or expose private chain-of-thought. Reason codes and relevant public observations are enough to audit plan adoption.

## Admission before execution

Validate syntax and semantic types, all registry references, acyclicity, max nodes/edges/depth, typed bindings, reachability to the declared output, complete dependencies, capabilities, policy, budget, allowed region, current run revision, and observation dependency validity. Reject unapproved providers, node kinds, script fields, mutation operations, policy edits, remote refs, and stale plan revisions.

Plans can only narrow capabilities and budgets inherited from their region. They cannot edit completed work, cross into another region, add an execute-action node, change admission/settlement, or modify the source objective/policy. Persist accepted plan bytes/digest and a `plan_accepted` event before any plan work starts.

## Plan revision semantics

Use optimistic revision checks. One plan revision may be active per region invocation. New candidates include the current base revision; competing candidates cannot both win. On supersession, cancel or ignore old cancellable pure work, release unused reservations, retain consumed costs, and reject late results from the superseded revision.

Replanning occurs at defined events: incompatible fresh observation, stage/turn change, changed required capabilities, unavailable/failed analysis, exhausted budget, authorized objective update, or explicitly signaled candidate invalidation. It does not run on every poll.

Set a maximum replan count per region invocation, a global replan budget, and a repeated-identical-plan/no-progress detector. Exhaustion follows a declared fallback branch or `NeedsOperator`; it never lowers safety checks or silently changes the gameplay strategy.

## Dependency-bound validity

Default to exact generation binding for actions and action catalogs. A plan may reuse pure analysis across generations only when a registered dependency projection proves compatibility under an explicit policy. Do not treat a model's statement that nothing changed as proof.

Record which observation fields/capabilities/objective/prompt/artifact revisions were used. Changed player HP, turn, hand, enemy intent, modal state, path availability, or resource availability invalidates a plan when that field is declared relevant. Missing/unknown required data invalidates reuse rather than becoming false or an empty collection.

Continue to use the existing bounded `ActionPlan` only through its original verified action path. Its cached sequence is not a dynamic workflow graph. Preserve the current eight-action cap and compatibility rules until an explicit tested decision revises them [S04].

## Parallel pure analysis

Support a small bounded set of registered analysis tasks on one immutable context, followed by an explicit join and synthesis/decision. Each task inherits a context allowlist, budget reservation, timeout, cancellation token, and output schema. It has no mutation handle, spawn-agent capability, file/network tool authority, or ability to launch unlimited analyses.

Do not confuse the implementation team's three-level Luna Max hierarchy with product-time gameplay agents. Product-time provider/model choice remains deployment-configured and does not inherit coding-agent privileges.

## Budgets and provider uncertainty

Reserve provider call count and maximum possible output allowance before dispatch. Account for actual usage after response; unknown usage remains reserved/estimated conservatively, not refunded to zero. Enforce model-call, token, elapsed-time, analysis-concurrency, plan-size, and run-step limits. A plan that cannot be admitted within budget fails before external work.

Timeout does not prove a provider call was never processed or billed. Persist provider execution identity and request digest. Reconcile only where the provider supports it; otherwise apply a separately declared retry policy with duplicate-cost risk recorded. Never imply universal provider idempotency.

## Useful fixture scenarios

Combat: one decision for a simple state versus registered threat/resource/candidate analyses before synthesis for a complex fixture. Map: approved visible map/capability data only, with capability-unavailable fallback. Shop: resource-budget analysis followed by one proposed current catalog purchase. Selection: route to the fixed supported selection workflow instead of adapting around a modal.

Tests must demonstrate at least two different accepted plan topologies on controlled inputs, rejection of forbidden nodes, deterministic offline replay of the chosen plan, cancellation of superseded work, stale-result rejection, and strict accounting through failure/restart.
