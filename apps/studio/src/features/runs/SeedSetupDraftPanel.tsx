import { useEffect, useState } from "react";

import type { SeededRunV2Client } from "@studio/client";
import {
  SeedRequestV2Schema,
  WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION,
  type TargetCatalogResponse,
  type TargetDescriptor,
  type TargetSeedSupportV2,
} from "@studio/contracts";
import { canonicalJsonComplete } from "@studio/document";

export interface SeedDraft {
  mode: "explicit" | "derive_once";
  requestedSeed: string;
}

/** Copy-only comparison context, not an owner admission or native build attestation. */
export interface SeedDraftSetupIdentity {
  workflow_id: string;
  workflow_revision: string;
  workflow_definition_digest: string;
  execution_mode: TargetDescriptor["execution_mode"];
  execution_profile: string;
  game_profile: string;
  save_profile: string | null;
  inference_profile: string | null;
  context_capability: string | null;
  provider_capability: string | null;
  compatibility_revision: string;
  capability_revision: string;
}

interface SeedSetupDraftPanelProps {
  client?: Pick<SeededRunV2Client, "listSeedTargetSupportV2">;
  catalog: TargetCatalogResponse;
  target: TargetDescriptor;
  draft?: SeedDraft;
  onChange: (draft?: SeedDraft) => void;
  /** Required in the actual run-setup flow; older stand-alone viewers may omit it. */
  setupIdentity?: SeedDraftSetupIdentity;
  requireSetupIdentity?: boolean;
}

type Support =
  | { state: "loading" }
  | { state: "unavailable"; reason: string }
  | { state: "ready"; entry: TargetSeedSupportV2 };


/** Restore only a closed, current-owner local draft. Never admit or launch. */
export function restoreLocalSeedDraft(
  text: string,
  catalogRevision: string,
  instanceId: string,
  allowedModes: readonly SeedDraft["mode"][],
  expectedSetupIdentity?: SeedDraftSetupIdentity,
): SeedDraft {
  if (new TextEncoder().encode(text).length > 4096) throw new Error("Draft exceeds the local import limit.");
  let decoded: unknown;
  try { decoded = JSON.parse(text); } catch { throw new Error("Draft is not valid JSON."); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Draft envelope is invalid.");
  const record = decoded as Record<string, unknown>;
  const envelopeFields = expectedSetupIdentity
    ? ["catalog_revision", "instance_id", "schema_version", "seed_request", "setup_identity", "status"]
    : ["catalog_revision", "instance_id", "schema_version", "seed_request", "status"];
  if (Object.keys(record).sort().join(",") !== envelopeFields.join(",")
    || record.schema_version !== (expectedSetupIdentity ? "studio.seed-setup-draft/v2" : "studio.seed-setup-draft/v1")
    || record.status !== "local_draft_only_not_admitted_or_launched") {
    throw new Error("Draft envelope is not a local-only seed configuration for this setup.");
  }
  if (record.catalog_revision !== catalogRevision || record.instance_id !== instanceId) {
    throw new Error("Draft belongs to a different target or catalog revision.");
  }
  if (expectedSetupIdentity
    && canonicalJsonComplete(record.setup_identity) !== canonicalJsonComplete(expectedSetupIdentity)) {
    throw new Error("Draft setup identity differs from the selected workflow, profile or context.");
  }
  const request = SeedRequestV2Schema.safeParse(record.seed_request);
  if (!request.success || !allowedModes.includes(request.data.mode)) {
    throw new Error("Draft seed mode is invalid or unsupported by the current owner.");
  }
  const rawRequest = record.seed_request;
  if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) {
    throw new Error("Draft seed request is invalid.");
  }
  const expectedFields = request.data.mode === "explicit" ? "mode,schema_version,seed" : "mode,schema_version";
  if (Object.keys(rawRequest).sort().join(",") !== expectedFields) {
    throw new Error("Draft seed request has unexpected fields.");
  }
  return request.data.mode === "explicit"
    ? { mode: "explicit", requestedSeed: request.data.seed }
    : { mode: "derive_once", requestedSeed: "" };
}

export function SeedSetupDraftPanel({ client, catalog, target, draft, onChange, setupIdentity, requireSetupIdentity = false }: SeedSetupDraftPanelProps): JSX.Element {
  const [support, setSupport] = useState<Support>({ state: "loading" });
  const [copyStatus, setCopyStatus] = useState("");
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    setCopyStatus("");
    setImportText("");
    setImportStatus("");
    if (!client) {
      setSupport({ state: "unavailable", reason: "This adapter does not expose owner-authenticated seed support." });
      return;
    }
    setSupport({ state: "loading" });
    void client.listSeedTargetSupportV2().then((current) => {
      if (cancelled) return;
      // Compare to THIS admission form's catalog as well as the independent
      // V1 snapshot already checked by the client. Never accept a stale hint.
      if (current.catalog_revision !== catalog.catalog_revision || current.targets.length !== catalog.targets.length
        || current.targets.some((entry) => {
          const original = catalog.targets.find((item) => item.instance_id === entry.target.instance_id);
          return !original || canonicalJsonComplete(original) !== canonicalJsonComplete(entry.target);
        })) {
        setSupport({ state: "unavailable", reason: "Owner seed support no longer matches the visible target catalog." });
        return;
      }
      const entry = current.targets.find((item) => item.target.instance_id === target.instance_id);
      if (!entry) {
        setSupport({ state: "unavailable", reason: "Selected target is absent from owner seed support." });
        return;
      }
      setSupport({ state: "ready", entry });
    }).catch(() => {
      if (!cancelled) setSupport({ state: "unavailable", reason: "Seed support could not be authenticated and checked." });
    });
    return () => { cancelled = true; };
  }, [client, catalog, target]);

  const permitted = support.state === "ready" ? support.entry.durable_candidate_binding_modes : [];
  const seedRequest = draft?.mode === "explicit"
    ? { schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION, mode: "explicit", seed: draft.requestedSeed }
    : { schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION, mode: "derive_once" };
  const identityReady = !requireSetupIdentity || Boolean(setupIdentity);
  const valid = Boolean(identityReady && draft && permitted.includes(draft.mode) && SeedRequestV2Schema.safeParse(seedRequest).success);
  const copy = async (): Promise<void> => {
    if (!valid || !draft || !globalThis.navigator?.clipboard?.writeText) return;
    const record = {
      schema_version: setupIdentity ? "studio.seed-setup-draft/v2" : "studio.seed-setup-draft/v1",
      catalog_revision: catalog.catalog_revision,
      instance_id: target.instance_id,
      seed_request: seedRequest,
      ...(setupIdentity ? { setup_identity: setupIdentity } : {}),
      status: "local_draft_only_not_admitted_or_launched",
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(record, null, 2));
      setCopyStatus("Local draft copied; effective seed is not yet known.");
    } catch {
      setCopyStatus("Clipboard unavailable; no run was submitted.");
    }
  };

  const restore = (): void => {
    if (support.state !== "ready" || !identityReady) return;
    try {
      const recovered = restoreLocalSeedDraft(importText, catalog.catalog_revision, target.instance_id, permitted, setupIdentity);
      onChange(recovered);
      setImportStatus("Local seed draft restored for this exact owner target. No run was submitted.");
    } catch (error) {
      setImportStatus(error instanceof Error ? `Import rejected: ${error.message}` : "Import rejected.");
    }
  };

  return <section className="panel-card" aria-label="Seed setup draft">
    <h3>Seed setup preparation</h3>
    <p className="muted">Read-only owner capability discovery. A seed draft is never sent by the legacy Start run action. No native seeded launch is advertised or authorized here.</p>
    {support.state === "loading" ? <p role="status">Checking current owner seed support…</p> : null}
    {support.state === "unavailable" ? <p role="status">{support.reason}</p> : null}
    {support.state === "ready" ? <>
      <p>Candidate binding: {support.entry.durable_candidate_binding_modes.join(", ") || "none"}.
        Ready candidates: {support.entry.ready_candidate_modes.join(", ") || "none"}.
        Native launch setups: {support.entry.supported_launch_setups.length}.</p>
      <label className="field-label">Seed draft mode
        <select aria-label="Seed draft mode" value={draft?.mode ?? "none"} onChange={(event) => {
          const mode = event.target.value;
          if (mode === "none") onChange(undefined);
          else if (mode === "explicit" || mode === "derive_once") {
            if (permitted.includes(mode)) onChange({ mode, requestedSeed: mode === "explicit" ? draft?.requestedSeed ?? "" : "" });
          }
        }}>
          <option value="none">No seed draft (legacy run)</option>
          {permitted.includes("explicit") ? <option value="explicit">Explicit seed draft</option> : null}
          {permitted.includes("derive_once") ? <option value="derive_once">Generate once on owner admission (draft)</option> : null}
        </select>
      </label>
      {draft?.mode === "explicit" ? <label className="field-label">Requested seed (UTF-8, maximum 64 bytes)
        <input aria-label="Requested seed draft" type="text" value={draft.requestedSeed}
          onChange={(event) => onChange({ mode: "explicit", requestedSeed: event.target.value })} />
      </label> : null}
      {requireSetupIdentity && !setupIdentity ? <p role="status">Select exact execution and game profiles and a verified workflow digest before copying or restoring a seed draft.</p> : null}
      {setupIdentity ? <details><summary>Exact copied setup identity</summary>
        <pre>{JSON.stringify(setupIdentity, null, 2)}</pre>
        <p className="muted">These are selected revisions and profiles, not a verified native game build or settled owner receipt.</p>
      </details> : null}
      {draft ? <>
        <p role="status">{valid ? "Draft passes canonical seed validation." : "Draft is invalid or no longer supported by this owner. No request will be sent."}</p>
        <p>Requested seed: {draft.mode === "explicit" ? (draft.requestedSeed || "(empty)") : "owner derive-once request"}.
          Effective seed: unavailable until an authoritative settled owner receipt.</p>
        <p className="muted">Matching seed text alone does not reproduce a run. Exact build, profile, context, baseline and accepted launch parameters must match.</p>
        <button className="button button-secondary" type="button" disabled={!valid} onClick={() => void copy()}>
          Copy local draft configuration
        </button>
        {copyStatus ? <p role="status">{copyStatus}</p> : null}
      </> : null}
      <label className="field-label">Paste local seed draft configuration
        <textarea aria-label="Paste local seed draft configuration" value={importText}
          onChange={(event) => { setImportText(event.target.value); setImportStatus(""); }} />
      </label>
      <button className="button button-secondary" type="button" disabled={!importText || !identityReady} onClick={restore}>
        Restore local seed draft
      </button>
      {importStatus ? <p role="status">{importStatus}</p> : null}
    </> : null}
    {draft && support.state !== "ready" ? <button className="button button-secondary" type="button" onClick={() => onChange(undefined)}>Clear unsupported seed draft</button> : null}
  </section>;
}
