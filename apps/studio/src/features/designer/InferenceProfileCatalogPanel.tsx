import { StatusBadge } from "../../components/StatusBadge";
import type { InferenceProfileCatalogState } from "./useInferenceProfileCatalog";
import { useState } from "react";
import {
  findCredentialBearingProfileFields,
  type InferenceProfileDescriptor,
} from "@studio/contracts";
import type { StudioClient } from "@studio/client";
import {
  revisionDraftFor,
  useInferenceProfileRevisionEditor,
  type InferenceProfileRevisionState,
  type InferenceProfileRevisionDraft,
} from "./useInferenceProfileRevisionEditor";

export function InferenceProfileCatalogPanel({ state, refresh, client }: {
  state: InferenceProfileCatalogState; refresh: () => void; client: StudioClient;
}): JSX.Element {
  const catalog = state.status === "available" ? state.catalog : undefined;
  // The published contract carries no credential, endpoint, executable or
  // prompt byte. This runs the contract's own leak guard over the catalog
  // actually on screen: if a future field ever leaked one, the panel says so
  // instead of quietly rendering it.
  const leaks = catalog ? findCredentialBearingProfileFields(catalog) : [];
  const editor = useInferenceProfileRevisionEditor(client, refresh);
  return <section className="panel-card" aria-label="Inference profile catalog">
    <div className="panel-title">
      <div><p className="eyebrow">Authoring inference references</p><h2>Owner inference profile catalog</h2></div>
      <StatusBadge tone={catalog ? "success" : "muted"}>{state.status}</StatusBadge>
    </div>
    <button className="button button-secondary" onClick={refresh}>Refresh inference profile catalog</button>
    {state.status === "pending" ? <p role="status">Loading owner profile catalog. No profile can be selected while it is unverified.</p> : null}
    {state.status === "unavailable" ? <p role="status">{state.reason}</p> : null}
    {leaks.length ? <p className="field-error" role="alert">The owner response disclosed credential-bearing fields ({leaks.join(", ")}); it is withheld from this view.</p> : null}
    {catalog && leaks.length === 0 ? <div data-testid="owner-inference-profile-catalog">
      <p className="muted">Owner {catalog.owner_id} · {catalog.owner_version}</p>
      {catalog.descriptors.length === 0 ? <p>No inference profiles were disclosed.</p> : null}
      {catalog.descriptors.map((descriptor) => <section
        key={`${descriptor.profile_id}:${descriptor.version}`}
        aria-label={`Inference profile ${descriptor.profile_id}`}>
        <h3>{descriptor.profile_id}</h3>
        <p>{descriptor.version} · {descriptor.state} · adapter {descriptor.adapter}</p>
        <p>Node kinds: {descriptor.node_kinds.join(", ")}</p>
        <p className="muted">Context compatibility: {descriptor.context_compatibility.length ? descriptor.context_compatibility.join(", ") : "unconstrained"}</p>
        <p className="muted">Owner grants: select {descriptor.grants.select ? "yes" : "no"} · edit {descriptor.grants.edit ? "yes" : "no"}</p>
        <InferenceProfileRevisionEditor descriptor={descriptor} editor={editor} />
      </section>)}
      <p className="muted">This catalog is reference information only. It publishes no credential, provider endpoint, executable or prompt byte, and it cannot widen a node's allowed operations or edit protected policy.</p>
    </div> : null}
  </section>;
}

/** The write half of the grant split.
 *
 * The owner publishes `grants.edit` precisely so a consumer can render a
 * capability-driven unavailable state instead of hiding the profile. So a
 * profile that is readable but not editable still renders, still explains
 * itself, and offers NO control that could only fail — not a disabled button
 * that looks like a lost permission, and not a silent no-op.
 *
 * When the grant IS present, the form carries exactly the members the owner's
 * request accepts. There is deliberately no field for an adapter, a model, a
 * grant, a node kind, an operation, an endpoint or a credential: an edit
 * inherits all of those from the revision it edits, so there is nothing here
 * to set and nothing here that could widen a profile. */
function InferenceProfileRevisionEditor({ descriptor, editor }: {
  descriptor: InferenceProfileDescriptor;
  editor: ReturnType<typeof useInferenceProfileRevisionEditor>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<InferenceProfileRevisionDraft>(() => revisionDraftFor(descriptor));
  const label = `Adopt a revision of ${descriptor.profile_id}`;

  if (!descriptor.grants.edit) {
    return <p className="muted" data-testid={`inference-profile-edit-unavailable-${descriptor.profile_id}`}>
      Revision editing is unavailable: the owner publishes this profile with
      {" "}<code>edit no</code>. It can be read and selected, but only the owner can adopt a revision of it.
    </p>;
  }

  const update = (key: keyof InferenceProfileRevisionDraft) =>
    (event: { target: { value: string } }) =>
      setDraft((current) => ({ ...current, [key]: event.target.value }));

  // Outcome state is per profile REVISION, so this editor reads and clears
  // only its own. A sibling's adoption or conflict is never rendered here and
  // is never cleared by opening or cancelling this one. The version is part
  // of the key because a catalog may hold two revisions of one profile_id.
  const outcome = editor.stateFor(descriptor.profile_id, descriptor.version);

  return <div data-testid={`inference-profile-revision-editor-${descriptor.profile_id}`}>
    {open ? <div>
      <p className="muted">Editing against served revision digest <code>{descriptor.digest.slice(0, 16)}…</code>. The owner accepts this only if that revision is still the accepted head.</p>
      <label>New version<input aria-label={`New version for ${descriptor.profile_id}`} value={draft.version} onChange={update("version")} placeholder="1.1.0" /></label>
      <label>Prompt revision<input aria-label={`Prompt revision for ${descriptor.profile_id}`} value={draft.prompt_revision} onChange={update("prompt_revision")} /></label>
      <label>Settings revision<input aria-label={`Settings revision for ${descriptor.profile_id}`} value={draft.settings_revision} onChange={update("settings_revision")} /></label>
      <label>Supported settings (comma separated)<input aria-label={`Supported settings for ${descriptor.profile_id}`} value={draft.supported_settings} onChange={update("supported_settings")} /></label>
      <label>Max input bytes<input aria-label={`Max input bytes for ${descriptor.profile_id}`} value={draft.max_input_bytes} onChange={update("max_input_bytes")} /></label>
      <label>Max output tokens<input aria-label={`Max output tokens for ${descriptor.profile_id}`} value={draft.max_output_tokens} onChange={update("max_output_tokens")} /></label>
      <label>Max provider calls<input aria-label={`Max provider calls for ${descriptor.profile_id}`} value={draft.max_provider_calls} onChange={update("max_provider_calls")} /></label>
      <button className="button button-primary" onClick={() => void editor.submit(descriptor, draft)} disabled={outcome.status === "submitting"}>
        {outcome.status === "submitting" ? "Adopting…" : "Adopt revision"}
      </button>
      <button className="button button-quiet" onClick={() => { setOpen(false); editor.reset(descriptor.profile_id, descriptor.version); }}>Cancel</button>
      <RevisionOutcome state={outcome} profileId={descriptor.profile_id} />
    </div> : <button className="button button-secondary" onClick={() => { setDraft(revisionDraftFor(descriptor)); setOpen(true); editor.reset(descriptor.profile_id, descriptor.version); }}>
      {label}
    </button>}
    {!open && <RevisionOutcome state={outcome} profileId={descriptor.profile_id} />}
  </div>;
}

/** Renders each outcome as the distinct thing it is.
 *
 * `adopted` and `replayed` are NOT the same event and are not collapsed: a
 * replay means this mutation id was already applied, and presenting it as a
 * fresh adoption would double-count one edit. `conflict` names the revision
 * that won and requires an explicit human re-author — no overwrite, no
 * automatic retry. */
function RevisionOutcome({ state, profileId }: {
  state: InferenceProfileRevisionState;
  profileId: string;
}): JSX.Element | null {
  if (state.status === "adopted") {
    return <p role="status" data-testid="inference-profile-revision-adopted">
      Adopted. A definition may now pin exactly <code>{state.adoption.reference}</code>.
      {" "}The catalog has been re-read from the owner; what it publishes is what a later admission resolves.
    </p>;
  }
  if (state.status === "replayed") {
    return <p role="status" data-testid="inference-profile-revision-replayed">
      Already applied under this mutation id, so nothing was duplicated. The accepted revision is <code>{state.adoption.reference}</code>.
    </p>;
  }
  if (state.status === "conflict") {
    return <p role="alert" className="field-error" data-testid="inference-profile-revision-conflict">
      A concurrent edit to {profileId} won the swap; this edit was not applied and was not retried.
      {" "}The accepted revision is <code>{state.adoption.reference}</code>. Re-author the edit against that revision to proceed.
    </p>;
  }
  if (state.status === "refused") {
    return <p role="alert" className="field-error" data-testid="inference-profile-revision-refused">
      The owner refused this edit ({state.refusal}): {state.detail}
    </p>;
  }
  return null;
}
