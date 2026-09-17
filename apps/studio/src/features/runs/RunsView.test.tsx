import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextServiceClient, FixtureClient } from "@studio/client";
import type { ContextOwnerAssociation, ContextOwnerEffectiveLimits } from "@studio/contracts";
import vectors from "../../../../../contracts/accepted/effective-limits/producer.json";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { RunsView } from "./RunsView";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

for (const delayedSurface of ["memory", "session"] as const) {
  it(`does not republish an older pending ${delayedSurface} descriptor after the current association fails`, async () => {
    let poll!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation((handler) => {
      if (typeof handler !== "function") throw new Error("Expected refresh callback");
      poll = () => handler();
      return {} as ReturnType<typeof window.setInterval>;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});
    const client = new FixtureClient(fixtureDefinitions);
    const association = client.contextAssociation.bind(client);
    let associationReads = 0;
    const newerRejected = deferred<void>();
    vi.spyOn(client, "contextAssociation").mockImplementation(async (runId) => {
      if (++associationReads > 1) {
        newerRejected.resolve();
        throw new Error("Current owner association unavailable");
      }
      const original = await association(runId);
      return {
        ...original,
        context: {
          availability: "available", context_ref: "fixture-context", run_id: "fixture-run",
          episode_id: "fixture-episode", agent_id: "fixture-agent", snapshot_id: "fixture-snapshot",
          approved_revision_id: "fixture-revision", plan_epoch: 1,
        },
        capabilities: { ...original.capabilities, memory_search: true, provider_session_inspect: true },
      };
    });
    const pending = deferred<Response>();
    const started = deferred<void>();
    const sessionCompleted = deferred<void>();
    const memory = vectors.memory[1].descriptor;
    const session = {
      schema: "ascension.provider-session.api-result.v1", operation: "capabilities",
      value: vectors.session[1].descriptor, effect_class: "local_metadata_only", inference_calls: 0, game_effects: 0,
    };
    const contextClient = new ContextServiceClient({ fetcher: async (input) => {
      const path = String(input);
      const surface = path.endsWith("/memory/capabilities") ? "memory"
        : path.endsWith("/provider-sessions/capabilities") ? "session" : undefined;
      if (surface === delayedSurface) {
        started.resolve();
        return pending.promise;
      }
      return surface ? new Response(JSON.stringify(surface === "memory" ? memory : session))
        : new Response("unavailable", { status: 503 });
    } });
    const readSession = contextClient.providerSessionCapabilities.bind(contextClient);
    vi.spyOn(contextClient, "providerSessionCapabilities").mockImplementation(async (runId) => {
      try { return await readSession(runId); }
      finally { sessionCompleted.resolve(); }
    });
    render(<RunsView client={client} contextClient={contextClient} mode="fixture"
      initialRunId="workflow-fixture" onRunIdChange={() => {}} linkMappings={[]} />);
    await act(async () => { await started.promise; });
    const memoryPanel = screen.getByRole("region", { name: "Memory evidence" });
    const sessionPanel = screen.getByRole("region", { name: "Provider session evidence" });
    if (delayedSurface === "session") expect(memoryPanel).toHaveTextContent("1024 bytes");
    await act(async () => { poll(); await newerRejected.promise; });
    expect(memoryPanel).toHaveTextContent("current owner association is unavailable");
    expect(sessionPanel).toHaveTextContent("current owner association is unavailable");
    await act(async () => {
      pending.resolve(new Response(JSON.stringify(delayedSurface === "memory" ? memory : session)));
      await sessionCompleted.promise;
    });
    expect(memoryPanel).not.toHaveTextContent(/Owner effective|memory search is available/);
    expect(sessionPanel).not.toHaveTextContent("Owner effective");
    expect(memoryPanel).toHaveTextContent("current owner association is unavailable");
    expect(sessionPanel).toHaveTextContent("current owner association is unavailable");
  });
}

function ownerAssociation(runId: string, definitionDigest: string, ownerId: string): ContextOwnerAssociation {
  const digest = "a".repeat(64);
  return {
    schema_version: "ascension.harness.context-owner-association-view.v1",
    binding: {
      schema_version: "ascension.context-control.owner-binding.v1",
      owner_id: ownerId,
      owner_version: "v1",
      invocation_id: `${runId}.invocation`,
      binding_id: "binding.fixture",
      binding_version: 1,
      binding_digest: digest,
      context_ref: "context.fixture.v1",
      instance_id: "instance-fixture",
      node_kind: "decide",
      state: "available",
      workflow_run_id: runId,
      definition_digest: definitionDigest,
      graph_id: "graph",
      node_id: "decide",
      node_execution_id: `${runId}.node`,
      boundary: {
        run_id: runId,
        episode_id: "episode",
        agent_id: "agent",
        state_id: "state",
        generation: 1,
        observation_sha256: digest,
        catalog_sha256: digest,
        adapter_revision: "adapter.v1",
        model_revision: "model.v1",
        configuration_sha256: digest,
        output_schema_sha256: digest,
        controller_epoch: 1,
        gate_epoch: 1,
        control_version: 1,
      },
      lease_epoch: 1,
      snapshot_id: "snapshot",
      approved_revision_id: "revision",
      plan_epoch: 1,
      grants: { metadata_read: true, content_read: true, edit: false, control: true },
      continuity: { survives_controller_restart: true, receipt_recovery: true, provider_session_continuity: false },
    },
  };
}

function ownerLimits(association: ContextOwnerAssociation): ContextOwnerEffectiveLimits {
  const binding = association.binding;
  return {
    schema_version: "ascension.harness.context-owner-effective-limits-view.v1",
    owner_id: binding.owner_id,
    owner_version: binding.owner_version,
    catalog_digest: "b".repeat(64),
    binding_id: binding.binding_id,
    binding_version: binding.binding_version,
    binding_digest: binding.binding_digest,
    context_ref: binding.context_ref,
    node_kind: binding.node_kind,
    adapter_revision: binding.boundary.adapter_revision,
    model_revision: binding.boundary.model_revision,
    effective_limits: { max_items: 64, max_notes: 16, max_context_bytes: 131072, max_objective_bytes: 512, max_control_events: 64 },
  };
}

it("does not let a delayed owner response from the previous run replace the selected run", async () => {
  vi.spyOn(window, "setInterval").mockImplementation(() => ({}) as ReturnType<typeof window.setInterval>);
  vi.spyOn(window, "clearInterval").mockImplementation(() => {});
  const client = new FixtureClient(fixtureDefinitions);
  const status = client.status.bind(client);
  const ownerPending = deferred<ContextOwnerAssociation>();
  const runB = await status("run-b");
  const ownerB = ownerAssociation("run-b", runB.run.definition_digest, "owner-run-b");
  vi.spyOn(client, "contextOwnerAssociation").mockImplementation(async (runId) =>
    runId === "run-a" ? ownerPending.promise : ownerB);
  vi.spyOn(client, "contextOwnerEffectiveLimits").mockImplementation(async (runId) => {
    if (runId !== "run-b") return ownerLimits(ownerB);
    return ownerLimits(ownerB);
  });
  const contextClient = new ContextServiceClient({ fetcher: async () => new Response("unavailable", { status: 503 }) });
  render(<RunsView client={client} contextClient={contextClient} mode="fixture"
    initialRunId="run-a" onRunIdChange={() => {}} linkMappings={[]} />);
  const input = screen.getByRole("textbox", { name: "Run ID" });
  fireEvent.change(input, { target: { value: "run-b" } });
  fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
  const ownerPanel = await vi.waitFor(() => screen.getByRole("region", { name: "Current context owner association" }));
  await vi.waitFor(() => expect(ownerPanel).toHaveTextContent("owner-run-b"));
  ownerPending.resolve(ownerAssociation("run-a", (await status("run-a")).run.definition_digest, "owner-run-a"));
  await act(async () => {});
  expect(screen.getByRole("region", { name: "Current context owner association" })).toHaveTextContent("owner-run-b");
  expect(screen.getByRole("region", { name: "Current context owner association" })).not.toHaveTextContent("owner-run-a");
});
