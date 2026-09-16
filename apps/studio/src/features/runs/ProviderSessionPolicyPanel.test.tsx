import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  ProviderSessionPolicyCommandResponse,
  ProviderSessionPolicyViewResponse,
  ProviderSessionPolicyViewValue,
} from "@studio/contracts";
import type { ProviderSessionPolicyClient } from "@studio/client";
import { ClientError } from "@studio/client";

import { ProviderSessionPolicyPanel } from "./ProviderSessionPolicyPanel";

const runId = "workflow.run.1";
const sourceSha = "a".repeat(64);
const targetSha = "c".repeat(64);
const proposalSha = "b".repeat(64);

function current(value: ProviderSessionPolicyViewValue): ProviderSessionPolicyViewResponse {
  return {
    schema_version: "ascension.provider-session.policy-owner-view.v1",
    operation: "current",
    value,
    effect_class: "local_metadata_only",
    inference_calls: 0,
    game_effects: 0,
  };
}

function command(operation: ProviderSessionPolicyCommandResponse["operation"], revision: number): ProviderSessionPolicyCommandResponse {
  const common = {
    schema_version: "ascension.provider-session.policy-owner-command.v1" as const,
    revision,
    effect_class: "local_metadata_only" as const,
    inference_calls: 0 as const,
    game_effects: 0 as const,
  };
  switch (operation) {
    case "import": return { ...common, operation, policy_sha256: sourceSha, proposal_sha256: null };
    case "propose": return { ...common, operation, policy_sha256: null, proposal_sha256: proposalSha };
    case "approve": return { ...common, operation, policy_sha256: null, proposal_sha256: null };
    case "adopt": return { ...common, operation, policy_sha256: targetSha, proposal_sha256: null };
  }
}

describe("saved provider-session policy lifecycle", () => {
  it("imports exact file bytes, shows redacted history, and resumes approval from proposal history", async () => {
    let value: ProviderSessionPolicyViewValue = {
      run_id: runId,
      revision: 1,
      active: null,
      history: [],
      proposals: [],
    };
    const client: ProviderSessionPolicyClient = {
      providerSessionPolicy: vi.fn(async () => current(value)),
      importProviderSessionPolicy: vi.fn(async (_runId, revision, bytes) => {
        expect(revision).toBe(value.revision);
        expect(new TextDecoder().decode(bytes)).toBe(' { "policy_id" : "saved.policy" }\n');
        value = {
          ...value,
          revision: revision + 1,
          history: [{
            sha256: sourceSha, policy_id: "saved.policy", version: 1,
            mode: "enabled", continuity: "strict_reviewed", active: false,
          }],
        };
        return command("import", value.revision);
      }),
      proposeProviderSessionPolicy: vi.fn(async (_runId, id, source, revision, bytes) => {
        expect(id).toBe("migration.1");
        expect(source).toBe(sourceSha);
        expect(new TextDecoder().decode(bytes)).toBe(' { "policy_id" : "saved.policy", "version" : 2 }\n');
        value = {
          ...value,
          revision: revision + 1,
          history: [...value.history, {
            sha256: targetSha, policy_id: "saved.policy", version: 2,
            mode: "enabled", continuity: "strict_reviewed", active: false,
          }],
          proposals: [{
            proposal_id: id, proposal_sha256: proposalSha,
            source_sha256: source, target_sha256: targetSha,
            state: "proposed", approval_recorded: false, adopted_policy_sha256: null,
          }],
        };
        return command("propose", value.revision);
      }),
      approveProviderSessionPolicy: vi.fn(async (_runId, id, digest, approvalRef, revision) => {
        expect(id).toBe("migration.1");
        expect(digest).toBe(proposalSha);
        expect(approvalRef).toBe("approval.1");
        value = {
          ...value,
          revision: revision + 1,
          proposals: value.proposals.map((proposal) => ({ ...proposal, state: "approved", approval_recorded: true })),
        };
        return command("approve", value.revision);
      }),
      adoptProviderSessionPolicyProposal: vi.fn(async (_runId, id, digest, approvalRef, revision) => {
        expect(id).toBe("migration.1");
        expect(digest).toBe(proposalSha);
        expect(approvalRef).toBe("approval.1");
        value = {
          ...value,
          revision: revision + 1,
          active: {
            sha256: targetSha, policy_id: "saved.policy", version: 2,
            mode: "enabled", continuity: "strict_reviewed",
            max_completed_turns: 32, history_ttl_seconds: 3600, epoch: 2,
          },
          history: value.history.map((policy) => ({ ...policy, active: policy.sha256 === targetSha })),
          proposals: value.proposals.map((proposal) => ({
            ...proposal, state: "adopted", approval_recorded: true, adopted_policy_sha256: targetSha,
          })),
        };
        return command("adopt", value.revision);
      }),
      adoptImportedProviderSessionPolicy: vi.fn(),
    };

    const first = render(<ProviderSessionPolicyPanel client={client} runId={runId} />);
    await screen.findByText("No policies have been imported.");
    const sourceFile = new File([' { "policy_id" : "saved.policy" }\n'], "source.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Policy JSON file"), { target: { files: [sourceFile] } });
    fireEvent.click(screen.getByRole("button", { name: "Import policy" }));
    await screen.findByText(/Policy import recorded at owner revision 2/);
    expect(await screen.findAllByRole("option", { name: /saved\.policy@1/ })).toHaveLength(2);
    expect(client.importProviderSessionPolicy).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByRole("combobox", { name: "Source policy" }), { target: { value: sourceSha } });
    fireEvent.change(screen.getByRole("textbox", { name: "Proposal ID" }), { target: { value: "migration.1" } });
    const targetFile = new File([' { "policy_id" : "saved.policy", "version" : 2 }\n'], "target.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Target policy JSON"), { target: { files: [targetFile] } });
    fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));
    await screen.findByText(/Migration proposal recorded at owner revision 3/);
    expect(screen.getByText(proposalSha)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Approval reference for migration.1"), { target: { value: "approval.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Record approval" }));
    await screen.findByText(/Proposal approval recorded at owner revision 4/);
    expect(screen.getByLabelText("Approval reference for migration.1")).toHaveValue("");

    first.unmount();
    render(<ProviderSessionPolicyPanel client={client} runId={runId} />);
    await screen.findByText("Approval recorded by owner.");
    const proposal = within(screen.getByRole("region", { name: "Migration approvals and adoption" })).getByRole("list").querySelector("li");
    expect(proposal).toHaveTextContent(proposalSha);
    fireEvent.change(screen.getByLabelText("Approval reference for migration.1"), { target: { value: "approval.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Adopt approved proposal" }));
    await screen.findByText(/Proposal adoption recorded at owner revision 5/);
    await waitFor(() => expect(screen.getByRole("region", { name: "Current adopted policy" })).toHaveTextContent(targetSha));
    expect(within(screen.getByRole("region", { name: "Migration approvals and adoption" })).getByText("migration.1")).toBeInTheDocument();
  });

  it("requires an explicit command to adopt an imported initial policy", async () => {
    const imported = {
      sha256: sourceSha, policy_id: "saved.policy", version: 1,
      mode: "enabled" as const, continuity: "strict_reviewed" as const, active: false,
    };
    const value: ProviderSessionPolicyViewValue = {
      run_id: runId,
      revision: 4,
      active: null,
      history: [imported],
      proposals: [],
    };
    let adopted = false;
    const client: ProviderSessionPolicyClient = {
      providerSessionPolicy: vi.fn(async () => current({
        ...value,
        revision: adopted ? 5 : value.revision,
        active: adopted ? {
          sha256: sourceSha, policy_id: "saved.policy", version: 1,
          mode: "enabled", continuity: "strict_reviewed",
          max_completed_turns: 32, history_ttl_seconds: 3600, epoch: 1,
        } : null,
        history: [{ ...imported, active: adopted }],
      })),
      importProviderSessionPolicy: vi.fn(),
      proposeProviderSessionPolicy: vi.fn(),
      approveProviderSessionPolicy: vi.fn(),
      adoptProviderSessionPolicyProposal: vi.fn(),
      adoptImportedProviderSessionPolicy: vi.fn(async (_run, _sha, revision) => {
        adopted = true;
        return command("adopt", revision + 1);
      }),
    };

    render(<ProviderSessionPolicyPanel client={client} runId={runId} />);
    expect(await screen.findAllByRole("option", { name: /saved\.policy@1/ })).toHaveLength(2);
    fireEvent.change(screen.getByRole("combobox", { name: "Imported policy to adopt" }), { target: { value: sourceSha } });
    const adoptButton = screen.getByRole("button", { name: "Adopt imported policy" });
    expect(screen.getByRole("region", { name: "Current adopted policy" })).toHaveTextContent("No policy is adopted");
    fireEvent.click(adoptButton);
    await screen.findByText(/Initial policy adoption recorded at owner revision 5/);
    expect(client.adoptImportedProviderSessionPolicy).toHaveBeenCalledWith(runId, sourceSha, 4);
    await waitFor(() => expect(screen.getByRole("region", { name: "Current adopted policy" })).toHaveTextContent(sourceSha));
  });

  it("clears selected files and policy identities when the active run changes", async () => {
    const value: ProviderSessionPolicyViewValue = {
      run_id: runId,
      revision: 1,
      active: null,
      history: [{
        sha256: sourceSha, policy_id: "saved.policy", version: 1,
        mode: "enabled", continuity: "strict_reviewed", active: false,
      }],
      proposals: [],
    };
    const client: ProviderSessionPolicyClient = {
      providerSessionPolicy: vi.fn(async (requestedRunId) => current({ ...value, run_id: requestedRunId })),
      importProviderSessionPolicy: vi.fn(),
      proposeProviderSessionPolicy: vi.fn(),
      approveProviderSessionPolicy: vi.fn(),
      adoptProviderSessionPolicyProposal: vi.fn(),
      adoptImportedProviderSessionPolicy: vi.fn(),
    };

    const view = render(<ProviderSessionPolicyPanel client={client} runId={runId} />);
    await screen.findByRole("combobox", { name: "Source policy" });
    fireEvent.change(screen.getByLabelText("Policy JSON file"), {
      target: { files: [new File(["{}"], "policy.json", { type: "application/json" })] },
    });
    fireEvent.change(screen.getByLabelText("Target policy JSON"), {
      target: { files: [new File(["{}"], "target.json", { type: "application/json" })] },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Source policy" }), { target: { value: sourceSha } });
    fireEvent.change(screen.getByRole("textbox", { name: "Proposal ID" }), { target: { value: "migration.1" } });

    view.rerender(<ProviderSessionPolicyPanel client={client} runId="workflow.run.2" />);
    await screen.findByText((_content, element) => element?.textContent === "Run workflow.run.2 · owner revision 1");
    expect(screen.getByLabelText("Policy JSON file")).toHaveValue("");
    expect(screen.getByLabelText("Target policy JSON")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Source policy" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Proposal ID" })).toHaveValue("");
  });

  it("ignores a late import completion after switching workflow runs", async () => {
    let resolveImport!: (response: ProviderSessionPolicyCommandResponse) => void;
    const pendingImport = new Promise<ProviderSessionPolicyCommandResponse>((resolve) => {
      resolveImport = resolve;
    });
    const source = {
      sha256: sourceSha, policy_id: "saved.policy", version: 1,
      mode: "enabled" as const, continuity: "strict_reviewed" as const, active: false,
    };
    const otherSha = "d".repeat(64);
    const other = {
      sha256: otherSha, policy_id: "other.policy", version: 4,
      mode: "inspect_only" as const, continuity: "strict_reviewed" as const, active: false,
    };
    const client: ProviderSessionPolicyClient = {
      providerSessionPolicy: vi.fn(async (requestedRunId) => current({
        run_id: requestedRunId,
        revision: 1,
        active: null,
        history: requestedRunId === runId ? [source] : [other],
        proposals: [],
      })),
      importProviderSessionPolicy: vi.fn(() => pendingImport),
      proposeProviderSessionPolicy: vi.fn(),
      approveProviderSessionPolicy: vi.fn(),
      adoptProviderSessionPolicyProposal: vi.fn(),
      adoptImportedProviderSessionPolicy: vi.fn(),
    };

    const view = render(<ProviderSessionPolicyPanel client={client} runId={runId} />);
    await screen.findByText((_content, element) => element?.textContent === `Run ${runId} · owner revision 1`);
    fireEvent.change(screen.getByLabelText("Policy JSON file"), {
      target: { files: [new File(['{"policy_id":"saved.policy"}'], "policy.json", { type: "application/json" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import policy" }));
    await waitFor(() => expect(client.importProviderSessionPolicy).toHaveBeenCalledOnce());

    view.rerender(<ProviderSessionPolicyPanel client={client} runId="workflow.run.2" />);
    await screen.findByText((_content, element) => element?.textContent === "Run workflow.run.2 · owner revision 1");
    fireEvent.change(screen.getByRole("combobox", { name: "Imported policy to adopt" }), { target: { value: otherSha } });
    fireEvent.change(screen.getByLabelText("Policy JSON file"), {
      target: { files: [new File(['{"policy_id":"next.policy"}'], "next.json", { type: "application/json" })] },
    });
    expect(screen.getByRole("button", { name: "Import policy" })).toBeEnabled();
    await act(async () => {
      resolveImport(command("import", 2));
      await pendingImport;
    });

    expect(screen.getByText((_content, element) => element?.textContent === "Run workflow.run.2 · owner revision 1")).toBeInTheDocument();
    expect(client.providerSessionPolicy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("combobox", { name: "Imported policy to adopt" })).toHaveValue(otherSha);
    expect(screen.queryByText(/Policy import recorded at owner revision/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import policy" })).toBeEnabled();
  });

  it("ignores a late proposal completion after switching workflow runs", async () => {
    let resolveProposal!: (response: ProviderSessionPolicyCommandResponse) => void;
    const pendingProposal = new Promise<ProviderSessionPolicyCommandResponse>((resolve) => {
      resolveProposal = resolve;
    });
    const source = {
      sha256: sourceSha, policy_id: "saved.policy", version: 1,
      mode: "enabled" as const, continuity: "strict_reviewed" as const, active: false,
    };
    const otherSha = "d".repeat(64);
    const other = {
      sha256: otherSha, policy_id: "other.policy", version: 4,
      mode: "inspect_only" as const, continuity: "strict_reviewed" as const, active: false,
    };
    const client: ProviderSessionPolicyClient = {
      providerSessionPolicy: vi.fn(async (requestedRunId) => current({
        run_id: requestedRunId,
        revision: 1,
        active: null,
        history: requestedRunId === runId ? [source] : [other],
        proposals: [],
      })),
      importProviderSessionPolicy: vi.fn(),
      proposeProviderSessionPolicy: vi.fn(() => pendingProposal),
      approveProviderSessionPolicy: vi.fn(),
      adoptProviderSessionPolicyProposal: vi.fn(),
      adoptImportedProviderSessionPolicy: vi.fn(),
    };

    const view = render(<ProviderSessionPolicyPanel client={client} runId={runId} />);
    await screen.findByText((_content, element) => element?.textContent === `Run ${runId} · owner revision 1`);
    fireEvent.change(screen.getByRole("combobox", { name: "Source policy" }), { target: { value: sourceSha } });
    fireEvent.change(screen.getByRole("textbox", { name: "Proposal ID" }), { target: { value: "migration.1" } });
    fireEvent.change(screen.getByLabelText("Target policy JSON"), {
      target: { files: [new File(['{"policy_id":"saved.policy","version":2}'], "target.json", { type: "application/json" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));
    await waitFor(() => expect(client.proposeProviderSessionPolicy).toHaveBeenCalledOnce());

    view.rerender(<ProviderSessionPolicyPanel client={client} runId="workflow.run.2" />);
    await screen.findByText((_content, element) => element?.textContent === "Run workflow.run.2 · owner revision 1");
    fireEvent.change(screen.getByRole("combobox", { name: "Source policy" }), { target: { value: otherSha } });
    fireEvent.change(screen.getByRole("textbox", { name: "Proposal ID" }), { target: { value: "migration.next" } });
    fireEvent.change(screen.getByLabelText("Target policy JSON"), {
      target: { files: [new File(['{"policy_id":"other.policy","version":5}'], "next-target.json", { type: "application/json" })] },
    });
    expect(screen.getByRole("button", { name: "Create proposal" })).toBeEnabled();
    await act(async () => {
      resolveProposal(command("propose", 2));
      await pendingProposal;
    });

    expect(screen.getByText((_content, element) => element?.textContent === "Run workflow.run.2 · owner revision 1")).toBeInTheDocument();
    expect(client.providerSessionPolicy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox", { name: "Proposal ID" })).toHaveValue("migration.next");
    expect(screen.getByRole("combobox", { name: "Source policy" })).toHaveValue(otherSha);
    expect(screen.queryByText(/Migration proposal recorded at owner revision/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create proposal" })).toBeEnabled();
  });

  it("surfaces a denied owner read without substituting local policy state", async () => {
    const client: ProviderSessionPolicyClient = {
      providerSessionPolicy: vi.fn(async () => { throw new ClientError("missing scope", "missing_scope", 403); }),
      importProviderSessionPolicy: vi.fn(),
      proposeProviderSessionPolicy: vi.fn(),
      approveProviderSessionPolicy: vi.fn(),
      adoptProviderSessionPolicyProposal: vi.fn(),
      adoptImportedProviderSessionPolicy: vi.fn(),
    };

    render(<ProviderSessionPolicyPanel client={client} runId={runId} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("current owner token lacks a required workflow grant");
    expect(screen.getByText(/No local policy state is substituted/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import policy" })).not.toBeInTheDocument();
  });
});
