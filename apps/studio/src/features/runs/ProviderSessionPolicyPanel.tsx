import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ProviderSessionPolicyClient,
} from "@studio/client";
import type { ProviderSessionPolicyViewValue } from "@studio/contracts";
import { ClientError } from "@studio/client";

interface ProviderSessionPolicyPanelProps {
  client: ProviderSessionPolicyClient;
  runId: string;
}

type LoadState = "loading" | "ready" | "error";

const MAX_UPLOAD_BYTES = 1_048_576;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function ProviderSessionPolicyPanel({ client, runId }: ProviderSessionPolicyPanelProps): JSX.Element {
  const [value, setValue] = useState<ProviderSessionPolicyViewValue>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [importFile, setImportFile] = useState<File>();
  const [targetFile, setTargetFile] = useState<File>();
  const [selectedPolicy, setSelectedPolicy] = useState("");
  const [sourcePolicy, setSourcePolicy] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [approvalRefs, setApprovalRefs] = useState<Record<string, string>>({});
  const importInput = useRef<HTMLInputElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  const refreshId = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const currentId = ++refreshId.current;
    setLoadState("loading");
    setError(undefined);
    setApprovalRefs({});
    try {
      const response = await client.providerSessionPolicy(runId);
      if (currentId !== refreshId.current) return;
      setValue(response.value);
      setLoadState("ready");
    } catch (cause: unknown) {
      if (currentId !== refreshId.current) return;
      setError(errorMessage(cause));
      setLoadState("error");
    }
  }, [client, runId]);

  useEffect(() => {
    setValue(undefined);
    setNotice(undefined);
    setImportFile(undefined);
    setTargetFile(undefined);
    setSelectedPolicy("");
    setSourcePolicy("");
    setProposalId("");
    if (importInput.current) importInput.current.value = "";
    if (targetInput.current) targetInput.current.value = "";
    void refresh();
    return () => { refreshId.current += 1; };
  }, [refresh]);

  const perform = async (
    description: string,
    command: () => Promise<{ revision: number }>,
  ): Promise<void> => {
    if (busy || !value) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await command();
      setNotice(`${description} recorded at owner revision ${result.revision}. Refreshing current history…`);
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause));
      if (cause instanceof ClientError && cause.status === 409) {
        setNotice("The owner rejected this stale or conflicting change. Refresh history before trying again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const importPolicy = async (): Promise<void> => {
    if (!importFile || !value) return;
    if (!isBoundedJsonFile(importFile)) {
      setError(`Choose a JSON policy file no larger than ${MAX_UPLOAD_BYTES} bytes.`);
      return;
    }
    await perform("Policy import", async () => {
      const result = await client.importProviderSessionPolicy(runId, value.revision, await importFile.arrayBuffer());
      setImportFile(undefined);
      if (importInput.current) importInput.current.value = "";
      if (result.policy_sha256) setSelectedPolicy(result.policy_sha256);
      return result;
    });
  };

  const proposePolicy = async (): Promise<void> => {
    if (!targetFile || !value || !sourcePolicy || !IDENTIFIER_PATTERN.test(proposalId)) return;
    if (!isBoundedJsonFile(targetFile)) {
      setError(`Choose a JSON target file no larger than ${MAX_UPLOAD_BYTES} bytes.`);
      return;
    }
    await perform("Migration proposal", async () => {
      const result = await client.proposeProviderSessionPolicy(
        runId,
        proposalId,
        sourcePolicy,
        value.revision,
        await targetFile.arrayBuffer(),
      );
      setTargetFile(undefined);
      if (targetInput.current) targetInput.current.value = "";
      setProposalId("");
      return result;
    });
  };

  const adoptImported = async (): Promise<void> => {
    if (!value || !selectedPolicy) return;
    await perform("Initial policy adoption", () =>
      client.adoptImportedProviderSessionPolicy(runId, selectedPolicy, value.revision));
  };

  const setApprovalRef = (proposalIdValue: string, approvalRef: string): void => {
    setApprovalRefs((current) => ({ ...current, [proposalIdValue]: approvalRef }));
  };

  return <section className="panel-card" aria-label="Saved provider-session policy">
    <div className="panel-title">
      <div><p className="eyebrow">Saved policy owner</p><h2>Provider-session policy</h2></div>
      <button className="button button-quiet" onClick={() => void refresh()} disabled={loadState === "loading" || busy}>Refresh history</button>
    </div>
    <p className="muted">Policy bytes remain in the encrypted owner. Studio shows redacted history and sends each change with the displayed owner revision. Import, proposal, approval, and adoption require separate explicit actions.</p>
    <p className="field-unknown" role="note">Owner responses are metadata-only and report zero inference calls and zero game effects. Bearer credentials remain in this tab’s memory.</p>
    {loadState === "loading" ? <p className="muted" role="status">Loading policy-owner history…</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {notice ? <p className="field-unknown" role="status">{notice}</p> : null}
    {loadState === "error" ? <p className="muted">Policy history is unavailable or this owner does not grant access. No local policy state is substituted.</p> : null}
    {loadState === "ready" && value ? <>
      <p className="muted">Run <code>{value.run_id}</code> · owner revision <code>{value.revision}</code></p>
      <section aria-label="Current adopted policy">
        <h3>Current adopted policy</h3>
        {value.active ? <PolicyDetails policy={value.active} /> : <p className="muted">No policy is adopted for this owner.</p>}
      </section>
      <section aria-label="Import and initial adoption">
        <h3>Import and initial adoption</h3>
        <div className="control-grid">
          <label className="field-label">Policy JSON file
            <input ref={importInput} type="file" accept="application/json,.json" aria-label="Policy JSON file" onChange={(event) => setImportFile(event.target.files?.[0])} />
            <span className="field-help">Uploaded as its original bytes; maximum {MAX_UPLOAD_BYTES} bytes. Credentials and policy files are not written to browser storage.</span>
          </label>
          <button className="button button-secondary" disabled={busy || loadState !== "ready" || !importFile} onClick={() => void importPolicy()}>Import policy</button>
        </div>
        <div className="control-grid">
          <label className="field-label">Imported policy to adopt
            <select value={selectedPolicy} onChange={(event) => setSelectedPolicy(event.target.value)} disabled={busy}>
              <option value="">Select a saved policy…</option>
              {value.history.map((policy) => <option key={policy.sha256} value={policy.sha256} disabled={policy.active}>
                {policy.policy_id}@{policy.version} · {policy.sha256.slice(0, 12)}…{policy.active ? " · active" : ""}
              </option>)}
            </select>
          </label>
          <button className="button button-secondary" disabled={busy || !selectedPolicy || value.active?.sha256 === selectedPolicy} onClick={() => void adoptImported()}>Adopt imported policy</button>
        </div>
      </section>
      <section aria-label="Migration proposal">
        <h3>Propose a migration</h3>
        <p className="muted">Select the exact saved source policy and upload a target. The owner validates the migration and retains the target bytes.</p>
        <div className="control-grid">
          <label className="field-label">Source policy
            <select value={sourcePolicy} onChange={(event) => setSourcePolicy(event.target.value)} disabled={busy}>
              <option value="">Select a source…</option>
              {value.history.map((policy) => <option key={policy.sha256} value={policy.sha256}>{policy.policy_id}@{policy.version} · {policy.sha256.slice(0, 12)}…</option>)}
            </select>
          </label>
          <label className="field-label">Proposal ID
            <input value={proposalId} maxLength={128} autoComplete="off" onChange={(event) => setProposalId(event.target.value)} />
          </label>
          <label className="field-label">Target policy JSON
            <input ref={targetInput} type="file" accept="application/json,.json" aria-label="Target policy JSON" onChange={(event) => setTargetFile(event.target.files?.[0])} />
          </label>
          <button className="button button-secondary" disabled={busy || !sourcePolicy || !targetFile || !IDENTIFIER_PATTERN.test(proposalId)} onClick={() => void proposePolicy()}>Create proposal</button>
        </div>
      </section>
      <section aria-label="Saved policy history">
        <h3>History</h3>
        {value.history.length ? <ul className="plain-list">{value.history.map((policy) =>
          <li key={policy.sha256}><code>{policy.sha256}</code> · {policy.policy_id}@{policy.version} · {policy.mode} · {policy.continuity}{policy.active ? " · active" : ""}</li>)}</ul>
          : <p className="muted">No policies have been imported.</p>}
      </section>
      <section aria-label="Migration approvals and adoption">
        <h3>Migration approvals</h3>
        {value.proposals.length ? <ul className="plain-list">{value.proposals.map((proposal) => {
          const approvalRef = approvalRefs[proposal.proposal_id] ?? "";
          const canUseApproval = IDENTIFIER_PATTERN.test(approvalRef);
          return <li key={proposal.proposal_id}>
            <div><strong>{proposal.proposal_id}</strong> · {proposal.state}</div>
            <div className="muted">Proposal <code>{proposal.proposal_sha256}</code></div>
            <div className="muted">Source <code>{proposal.source_sha256}</code> → target <code>{proposal.target_sha256}</code></div>
            <div className="muted">{proposal.approval_recorded ? "Approval recorded by owner." : "No approval recorded."}{proposal.adopted_policy_sha256 ? ` Adopted ${proposal.adopted_policy_sha256}.` : ""}</div>
            {proposal.state !== "adopted" ? <label className="field-label">Approval reference
              <input type="password" autoComplete="off" value={approvalRef} onChange={(event) => setApprovalRef(proposal.proposal_id, event.target.value)} aria-label={`Approval reference for ${proposal.proposal_id}`} />
              <span className="field-help">Re-enter the same reference after a refresh. The owner never returns it in history.</span>
            </label> : null}
            {proposal.state === "proposed" ? <button className="button button-secondary" disabled={busy || !canUseApproval} onClick={() => void perform("Proposal approval", () => client.approveProviderSessionPolicy(runId, proposal.proposal_id, proposal.proposal_sha256, approvalRef, value.revision))}>Record approval</button> : null}
            {proposal.state === "approved" ? <button className="button button-secondary" disabled={busy || !canUseApproval} onClick={() => void perform("Proposal adoption", () => client.adoptProviderSessionPolicyProposal(runId, proposal.proposal_id, proposal.proposal_sha256, approvalRef, value.revision))}>Adopt approved proposal</button> : null}
          </li>;
        })}</ul> : <p className="muted">No migration proposals have been recorded.</p>}
      </section>
    </> : null}
  </section>;
}

function PolicyDetails({ policy }: { policy: NonNullable<ProviderSessionPolicyViewValue["active"]> }): JSX.Element {
  return <dl className="detail-list">
    <div><dt>Identity</dt><dd>{policy.policy_id}@{policy.version}</dd></div>
    <div><dt>Digest</dt><dd><code>{policy.sha256}</code></dd></div>
    <div><dt>Mode</dt><dd>{policy.mode} · {policy.continuity}</dd></div>
    <div><dt>Limits</dt><dd>{policy.max_completed_turns} turns · {policy.history_ttl_seconds} seconds · epoch {policy.epoch}</dd></div>
  </dl>;
}

function isBoundedJsonFile(file: File): boolean {
  return file.size > 0 && file.size <= MAX_UPLOAD_BYTES
    && (file.type === "application/json" || file.name.toLowerCase().endsWith(".json"));
}

function errorMessage(error: unknown): string {
  if (error instanceof ClientError && error.status === 403) return "The current owner token lacks a required workflow grant for this action.";
  if (error instanceof ClientError && error.status === 409) return "The saved-policy owner rejected a stale revision or conflicting identity.";
  return error instanceof Error ? error.message : "Provider-session policy owner request failed.";
}
