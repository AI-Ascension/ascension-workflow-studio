import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SeededRunV2Client } from "@studio/client";
import type { TargetCatalogResponse, TargetDescriptor, TargetSeedSupportCatalogV2 } from "@studio/contracts";
import { SeedSetupDraftPanel, type SeedDraft } from "./SeedSetupDraftPanel";
import { useState } from "react";

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
  const client = { listSeedTargetSupportV2: vi.fn(async () => owner) } as unknown as Pick<SeededRunV2Client, "listSeedTargetSupportV2">;
  return <SeedSetupDraftPanel client={client} catalog={catalog} target={target} draft={draft} onChange={setDraft} />;
}

describe("local-only seed authoring and exact owner support", () => {
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
