import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SeededRunV2Client } from "@studio/client";
import { WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION, type TargetCatalogResponse, type TargetDescriptor, type TargetSeedSupportCatalogV2 } from "@studio/contracts";
import { restoreLocalSeedDraft, SeedSetupDraftPanel, type SeedDraft } from "./SeedSetupDraftPanel";
import { useMemo, useState } from "react";

const target = {
  instance_id: "owner-a", execution_profiles: ["live.workflow.v1"],
  execution_mode: "live", compatibility_revision: "compat.v1",
  capability_revision: "caps.v1", availability: "available",
  supported_operations: ["workflow:live"], capabilities: ["workflow:context:read"],
  game_profiles: ["sts2-live-v1"], save_profiles: [], inference_profiles: ["exo.runtime-v3"],
} as TargetDescriptor;
const catalog = { schema_version: "ascension.workflow-targets/v1", catalog_revision: "runtime-v3:profile-a", targets: [target] } as TargetCatalogResponse;
const current = {
  schema_version: "ascension.workflow-targets/v2",
  catalog_revision: catalog.catalog_revision, support_revision: "seed-support.v1",
  targets: [{
    target, descriptor_digest: "93283a6890aae5b87aa656e5df60ca7ca090114300caca6fb667d309275acfe3",
    durable_candidate_binding_modes: ["explicit", "derive_once"],
    ready_candidate_modes: ["explicit"], supported_launch_setups: [],
  }],
} as TargetSeedSupportCatalogV2;

function Harness({ owner = current }: { owner?: TargetSeedSupportCatalogV2 }) {
  const [draft, setDraft] = useState<SeedDraft>();
  // Keep the authenticated client identity stable across controlled form edits.
  // A new object on each render would force a legitimate new owner discovery.
  const client = useMemo<Pick<SeededRunV2Client, "listSeedTargetSupportV2">>(
    () => ({ listSeedTargetSupportV2: vi.fn(async () => owner) }), [owner],
  );
  return <SeedSetupDraftPanel client={client} catalog={catalog} target={target} draft={draft} onChange={setDraft} />;
}

describe("local-only seed authoring and exact owner support", () => {

  it("restores only a closed, current-target local copy, never a foreign or malformed request", () => {
    const copy = {
      schema_version: "studio.seed-setup-draft/v1",
      catalog_revision: catalog.catalog_revision,
      instance_id: target.instance_id,
      seed_request: { schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION, mode: "explicit", seed: "repro.seed" },
      status: "local_draft_only_not_admitted_or_launched",
    };
    const text = JSON.stringify(copy);
    expect(restoreLocalSeedDraft(text, catalog.catalog_revision, target.instance_id, ["explicit"])).toEqual(
      { mode: "explicit", requestedSeed: "repro.seed" },
    );
    expect(() => restoreLocalSeedDraft(text, catalog.catalog_revision, "foreign-owner", ["explicit"])).toThrow();
    expect(() => restoreLocalSeedDraft(text, "changed", target.instance_id, ["explicit"])).toThrow();
    expect(() => restoreLocalSeedDraft(text, catalog.catalog_revision, target.instance_id, ["derive_once"])).toThrow();
    expect(() => restoreLocalSeedDraft(JSON.stringify({ ...copy, admitted: true }), catalog.catalog_revision, target.instance_id, ["explicit"])).toThrow();
    expect(() => restoreLocalSeedDraft(JSON.stringify({ ...copy, seed_request: { ...copy.seed_request, extra: 1 } }), catalog.catalog_revision, target.instance_id, ["explicit"])).toThrow();
    expect(() => restoreLocalSeedDraft(JSON.stringify({ ...copy, seed_request: { ...copy.seed_request, seed: "é".repeat(33) } }), catalog.catalog_revision, target.instance_id, ["explicit"])).toThrow();
    expect(() => restoreLocalSeedDraft("x".repeat(4097), catalog.catalog_revision, target.instance_id, ["explicit"])).toThrow();
  });
  it("restores an owner-matched pasted draft into the local form only", async () => {
    render(<Harness />);
    await screen.findByRole("combobox", { name: "Seed draft mode" });
    const copy = JSON.stringify({
      schema_version: "studio.seed-setup-draft/v1",
      catalog_revision: catalog.catalog_revision, instance_id: target.instance_id,
      seed_request: { schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION, mode: "explicit", seed: "repro.seed" },
      status: "local_draft_only_not_admitted_or_launched",
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Paste local seed draft configuration" }), { target: { value: copy } });
    fireEvent.click(screen.getByRole("button", { name: "Restore local seed draft" }));
    expect(screen.getByRole("textbox", { name: "Requested seed draft" })).toHaveValue("repro.seed");
    expect(screen.getByText(/No run was submitted/)).toBeInTheDocument();
  });

  it("never advertises a native launch and validates explicit UTF-8 byte bounds", async () => {
    render(<Harness />);
    const select = await screen.findByRole("combobox", { name: "Seed draft mode" });
    expect(screen.getByText(/Native launch setups: 0/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "explicit" } });
    const seed = screen.getByRole("textbox", { name: "Requested seed draft" });
    fireEvent.change(seed, { target: { value: "é".repeat(32) } });
    expect(screen.getByText(/Draft passes canonical seed validation/)).toBeInTheDocument();
    fireEvent.change(seed, { target: { value: "é".repeat(33) } });
    expect(screen.getByText(/Draft is invalid or no longer supported/)).toBeInTheDocument();
    fireEvent.change(seed, { target: { value: " seed" } });
    expect(screen.getByText(/Draft is invalid or no longer supported/)).toBeInTheDocument();
    fireEvent.change(seed, { target: { value: "repro.seed" } });
    expect(screen.getByText(/Draft passes canonical seed validation/)).toBeInTheDocument();
    expect(screen.getByText(/Effective seed: unavailable/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "derive_once" } });
    expect(screen.queryByRole("textbox", { name: "Requested seed draft" })).not.toBeInTheDocument();
    expect(screen.getByText(/owner derive-once request/)).toBeInTheDocument();
  });
  it("fails closed on stale V1 and does not expose a draft control for fixture owners", async () => {
    const stale = { ...current, catalog_revision: "stale-revision" } as TargetSeedSupportCatalogV2;
    render(<Harness owner={stale} />);
    await waitFor(() => expect(screen.getByText(/no longer matches the visible target catalog/)).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "Seed draft mode" })).not.toBeInTheDocument();
  });
  it("keeps absent owner support read-only", () => {
    render(<SeedSetupDraftPanel catalog={catalog} target={target} onChange={vi.fn()} />);
    expect(screen.getByText(/does not expose owner-authenticated seed support/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Seed draft mode" })).not.toBeInTheDocument();
  });
});
