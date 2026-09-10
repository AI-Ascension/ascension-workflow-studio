# 10 — Run Inspector and operational controls

## Read model

Show workflow and episode identity, exact definition/policy/registry digests,
instance/profile and authority capability, current workflow status, game outcome,
waiting reason, active node invocations, subworkflow stack, active plan revisions,
budget consumed/reserved/unknown, pending operation and reconciliation status,
cleanup state, and event freshness. Redact by the caller's permission.

A workflow failure/cancellation is not necessarily game defeat. An admitted action
is not a settled effect. A complete graph animation is not an outcome. Surface
`NeedsOperator` and unresolved operation IDs with factual recovery instructions.
Never offer a button that fabricates no-effect evidence.

Selecting a node shows its individual invocations, inputs/outputs permitted for
retention, timings, registered decision summary, diagnostics and trace/artifact
references. Do not show private reasoning transcripts or unsanitized provider
responses. Display unavailable/redacted data as such, not blank success.

## Commands

A central runtime command controller—not component effects—owns in-flight command
IDs, payload digests, expected run revision and pending/resolved UI state. Reuse
the owner's command idempotency and lookup mechanism. Read authorization and
current prerequisites immediately before submission; backend rechecks them.

| Command | Required meaning |
|---|---|
| Start | Launch exactly the selected immutable revision/profile after admission |
| Pause | Stop new admissions, show Pausing while reconciliation/settlement continues |
| Resume | Re-admit authority/capabilities/budget and require no unresolved effect |
| Step | One Phase-1 semantic unit; protected actions include their safety lifecycle |
| Cancel | Stop future work; not undo, forced completion, or a kill-before-reconcile shortcut |

Only show supported operations. Single-step is enabled only at an admitted paused
safe boundary. Do not add cursor setting, node skipping, force retry, direct game
action, kill-host, unlock composite or arbitrary plan-edit commands.

## Lost responses and duplicate interaction

Generate command identity once per deliberate user intent before transport.
Disable duplicate interaction locally but assume duplicate network deliveries
can happen. Same ID/same payload resolves to existing outcome; conflicting reuse
is visible error. A timeout enters Unknown/Checking, not Failed-to-apply. Query
outcome/current state before allowing another conflicting intent.

Recheck expected revision on confirmation. If it changed, cancel the old dialog
and show current context rather than silently using a fresh revision to execute
an obsolete request. The UI cannot guarantee stop at an exact game tick and must
not describe Pause as instantaneous. Multiple tabs/operators rely on server CAS,
not a browser mutex alone.

## Context and navigation

Live mode has a persistent LIVE/freshness marker. Historical cursor mode changes
header and disables live controls, even if a run is still active. Switching run,
workspace, server or role discards stale command affordances and requires matching
state. A selected graph node from an old draft cannot identify a live invocation.

After logout or tab close, the accepted workflow remains under Phase-1 ownership.
On reauthentication, attach by the durable run ID. Do not create a replacement run
because the browser forgot its previous command response.

## Operator evidence

Provide redacted copy/export of a support packet: version/digests, run/command IDs,
status/reason codes, cursor/gap classification and selected permitted artifacts.
Exclude secrets, host paths, hidden state and large raw outputs. Resolve all
artifact/trace links against approved mappings, never arbitrary strings in events.
