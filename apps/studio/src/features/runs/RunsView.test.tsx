import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextServiceClient, FixtureClient } from "@studio/client";
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
