// Synthetic browser harness: real RunsView and ContextServiceClient, in-memory
// workflow projection and routed capability responses. No native/provider calls.
import React from "react";
import { createRoot } from "react-dom/client";
import { ContextServiceClient, FixtureClient } from "../../packages/client/src";
import { fixtureDefinitions } from "../../apps/studio/src/fixtures/catalog";
import { RunsView } from "../../apps/studio/src/features/runs/RunsView";

const client = new FixtureClient(fixtureDefinitions);
const association = client.contextAssociation.bind(client);
client.contextAssociation = async (runId) => {
  const response = await fetch("/synthetic/context-association");
  if (!response.ok) throw new Error("Synthetic current owner association is unavailable.");
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
};
const contextClient = new ContextServiceClient({ token: "synthetic-capability-token" });
createRoot(document.getElementById("root")!).render(
  <RunsView client={client} contextClient={contextClient} mode="fixture"
    initialRunId="workflow-fixture" onRunIdChange={() => {}} linkMappings={[]} />,
);
