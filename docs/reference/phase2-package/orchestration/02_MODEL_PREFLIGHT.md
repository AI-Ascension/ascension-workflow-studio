# Luna Max preflight and attestation

## Requested configuration

All D1/D2/D3 descendants: model `gpt-5.6-luna`, reasoning effort `max`. Official
OpenAI model documentation lists Luna and supports `max`; current config docs
expose default subagent model/effort and concurrent-thread controls [S09-S11].
These sources do not prove the installed account/client accepts or actually uses
the settings, nor do they establish recursive depth availability.

## Mandatory read-only test

Record client executable/version, relevant supported config schema, actual spawn
interfaces, permission inheritance, available model/effort selection, and active
thread/depth limit. Do not copy personal/global configs or credentials wholesale.

Apply scoped supported role/default configuration, preserving sandbox and approval
settings. Test an actual D0 -> D1 -> D2 -> D3 read-only chain. Record tool-returned
thread IDs and parent IDs, requested/effective model/effort metadata and timing.
Verify D3 is not allowed to spawn. Close the test chain and reclaim slots.

Do not add a guessed `agents.max_depth` setting; this key was not found in the
reviewed config reference. Enforce the policy using the actual supported runtime.
Do not edit reserved spawn schemas, use hidden nested shell clients or create
fake thread records to claim ancestry. Model names in an agent's own text are
not proof of effective execution settings.

## Config examples

`config/codex.fragment.toml` is an inert example, not a global-config overwrite.
Current documented keys include `agents.default_subagent_model`,
`agents.default_subagent_reasoning_effort`, and
`agents.max_concurrent_threads_per_session` [S10]. Per-role files can declare
`model` and `model_reasoning_effort` when supported. Explicit spawn overrides
may take precedence; inspect actual spawn results, not just the example file.
No fast tier, alternate account/provider or higher-cost root mode is requested.

Root is the actual launched root model and cannot truthfully change its identity
by prompt. The requirement is for descendants. Product-time gameplay providers
remain Phase-1 configured and are unrelated to this coding-team model choice.

## Failure and qualification

Unavailable model/effort: record blocker; no silent replacement with another
model, `xhigh`, default effort or account. Unsupported recursion: no flattened
workers relabeled D2/D3. Continue safe independent source discovery/contract
preparation without calling that hierarchy-compliant implementation.

Accepted config but unobservable effective metadata: evidence is configuration-
only, not verified execution. Keep the attestation gate qualified. Valid code/test
evidence still has value, but model compliance must not be invented.

Use `orchestration/agent-attestation.schema.json` and the null-valued template.
A real verified record includes sanitized tool evidence references and actual
IDs. The template is deliberately `not_run`; package validation cannot pass
an actual model/depth-compliance gate.
