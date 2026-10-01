import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FixtureClient } from "@studio/client";
import type {
  InferenceProfileCatalog,
  InferenceProfileDescriptor,
  InferenceProfileRevisionAdoption,
  InferenceProfileRevisionRequest,
} from "@studio/contracts";
import { catalogFixture } from "../../../../../packages/contracts/src/inference-profile-catalog.test-fixtures";
import { InferenceProfileCatalogPanel } from "./InferenceProfileCatalogPanel";
import type { InferenceProfileCatalogState } from "./useInferenceProfileCatalog";

const catalog = (): InferenceProfileCatalog => catalogFixture("editable");
const editable = (): InferenceProfileDescriptor =>
  catalog().descriptors.find((descriptor) => descriptor.grants.edit)!;
const readOnly = (): InferenceProfileDescriptor =>
  catalog().descriptors.find((descriptor) => !descriptor.grants.edit)!;

function client(): FixtureClient {
  return new FixtureClient([]);
}

function renderPanel(
  state: InferenceProfileCatalogState,
  refresh = vi.fn(),
  override: FixtureClient = client(),
): { refresh: ReturnType<typeof vi.fn>; override: FixtureClient } {
  render(<InferenceProfileCatalogPanel state={state} refresh={refresh} client={override} />);
  return { refresh, override };
}

describe("grants.edit gates the edit control", () => {
  it("offers no edit control at all for a profile the owner publishes as not editable", () => {
    const descriptor = readOnly();
    renderPanel({ status: "available", catalog: catalog() });
    // The profile still RENDERS — the owner publishes `edit` precisely so a
    // consumer can show a capability-driven unavailable state rather than
    // hiding the profile.
    expect(screen.getByRole("region", { name: `Inference profile ${descriptor.profile_id}` })).toBeInTheDocument();
    expect(screen.getByTestId(`inference-profile-edit-unavailable-${descriptor.profile_id}`))
      .toHaveTextContent(/Revision editing is unavailable/);
    expect(screen.getByTestId(`inference-profile-edit-unavailable-${descriptor.profile_id}`))
      .toHaveTextContent("edit no");
    // No affordance of any kind: no button that could only fail, and no
    // disabled look-alike that implies a lost permission.
    expect(screen.queryByTestId(`inference-profile-revision-editor-${descriptor.profile_id}`)).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(`Adopt a revision of ${descriptor.profile_id}`) })).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(`Adopt a revision of ${editable().profile_id}`) })).toBeInTheDocument();
  });

  it("offers the editor for the profile the owner publishes as editable", () => {
    const descriptor = editable();
    renderPanel({ status: "available", catalog: catalog() });
    expect(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` })).toBeInTheDocument();
    expect(screen.queryByTestId(`inference-profile-edit-unavailable-${descriptor.profile_id}`)).toBeNull();
  });

  it("offers no editor while the catalog is pending or unavailable", () => {
    const { unmount } = render(<InferenceProfileCatalogPanel
      state={{ status: "pending" }} refresh={vi.fn()} client={client()} />);
    expect(screen.queryByRole("button", { name: /Adopt a revision of/ })).toBeNull();
    unmount();
    renderPanel({ status: "unavailable", reason: "The owner denied access to the profile catalog." });
    expect(screen.queryByRole("button", { name: /Adopt a revision of/ })).toBeNull();
  });

  /** The form must carry exactly the editable allow-list. A control for an
   * adapter, a model, a grant or a credential would either be ignored by the
   * owner or — worse — teach an operator that an edit can widen authority. */
  it("carries only the owner's editable fields", async () => {
    const descriptor = editable();
    const adopt = vi.fn().mockResolvedValue(adoption("adopted"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: catalog() }, vi.fn(), override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    for (const label of ["New version", "Prompt revision", "Settings revision",
      "Supported settings", "Max input bytes", "Max output tokens", "Max provider calls"]) {
      expect(screen.getByRole("textbox", { name: `${label} for ${descriptor.profile_id}` })).toBeInTheDocument();
    }
    for (const forbidden of ["Adapter", "Requested model", "Resolved model", "Node kinds",
      "Operations", "Grants", "State", "Endpoint", "API key", "Allowed operations"]) {
      expect(screen.queryByRole("textbox", { name: `${forbidden} for ${descriptor.profile_id}` })).toBeNull();
    }
  });
});

function adoption(outcome: "adopted" | "replayed" | "conflict",
  revision: InferenceProfileDescriptor = editable()): InferenceProfileRevisionAdoption {
  return {
    outcome,
    profile_id: editable().profile_id,
    reference: `${editable().profile_id}:${revision.version}:${revision.digest}`,
    revision,
    adopted: outcome === "adopted",
    conflicted: outcome === "conflict",
  };
}

describe("compare-and-swap expectation and outcomes", () => {
  it("sends the digest of the revision it was authored against, not a typed one", async () => {
    const descriptor = editable();
    const adopt = vi.fn().mockResolvedValue(adoption("adopted"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: catalog() }, vi.fn(), override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    fireEvent.change(screen.getByRole("textbox", { name: `Max output tokens for ${descriptor.profile_id}` }),
      { target: { value: "8192" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    expect(adopt).toHaveBeenCalledTimes(1);
    const [profileId, request] = adopt.mock.calls[0];
    expect(profileId).toBe(descriptor.profile_id);
    expect((request as InferenceProfileRevisionRequest).expected_revision_digest).toBe(descriptor.digest);
    expect((request as InferenceProfileRevisionRequest).version).toBe("1.1.0");
    expect((request as InferenceProfileRevisionRequest).effective_budgets.max_output_tokens).toBe(8192);
    // The inherited members are restated, not widened: the form has no way to
    // restate an adapter, a grant, node kinds or operations at all.
    const body = request as unknown as Record<string, unknown>;
    for (const forbidden of ["adapter", "requested_model", "grants", "node_kinds", "operations", "api_key", "endpoint"]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("shows the exact reference a definition may now pin after an adoption", async () => {
    const descriptor = editable();
    const adopt = vi.fn().mockResolvedValue(adoption("adopted"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: catalog() }, vi.fn(), override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    const shown = await screen.findByTestId("inference-profile-revision-adopted");
    expect(shown).toHaveTextContent(`${descriptor.profile_id}:${descriptor.version}:${descriptor.digest}`);
  });

  /** A replay is not a fresh adoption. Presenting it as one would double-count
   * a single edit, which is exactly what the producer's mutation record
   * exists to prevent. */
  it("says a replayed mutation was already applied rather than duplicating it", async () => {
    const descriptor = editable();
    const adopt = vi.fn().mockResolvedValue(adoption("replayed"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: catalog() }, vi.fn(), override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    const shown = await screen.findByTestId("inference-profile-revision-replayed");
    expect(shown).toHaveTextContent(/Already applied under this mutation id/);
    expect(shown).toHaveTextContent(/nothing was duplicated/);
    expect(screen.queryByTestId("inference-profile-revision-adopted")).toBeNull();
  });

  it("names the winning revision on a conflict, does not overwrite it, and does not retry", async () => {
    const descriptor = editable();
    const winner: InferenceProfileDescriptor = { ...descriptor, version: "9.9.9" };
    const adopt = vi.fn().mockResolvedValue(adoption("conflict", winner));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: catalog() }, vi.fn(), override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    const shown = await screen.findByTestId("inference-profile-revision-conflict");
    expect(shown).toHaveTextContent(`${descriptor.profile_id}:9.9.9:${winner.digest}`);
    expect(shown).toHaveTextContent(/was not applied and was not retried/);
    expect(shown).toHaveTextContent(/Re-author the edit against that revision/);
    // Exactly one attempt. Auto-retrying a lost swap is how a concurrent edit
    // gets silently overwritten by whichever caller retries last.
    expect(adopt).toHaveBeenCalledTimes(1);
    // And it is never presented as an adoption.
    expect(screen.queryByTestId("inference-profile-revision-adopted")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  it("re-reads the catalog from the owner after an adoption rather than patching local state", async () => {
    const descriptor = editable();
    const adopt = vi.fn().mockResolvedValue(adoption("adopted"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    const refresh = vi.fn();
    renderPanel({ status: "available", catalog: catalog() }, refresh, override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    await screen.findByTestId("inference-profile-revision-adopted");
    // The owner records an accepted revision in an append-only journal and
    // does NOT splice it into the catalog it serves. Only a re-read tells us
    // what it publishes now.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("re-reads after a replay too, since a replay also names an accepted revision", async () => {
    const descriptor = editable();
    const adopt = vi.fn().mockResolvedValue(adoption("replayed"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    const refresh = vi.fn();
    renderPanel({ status: "available", catalog: catalog() }, refresh, override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    await screen.findByTestId("inference-profile-revision-replayed");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not re-read after a conflict, because nothing was accepted", async () => {
    const descriptor = editable();
    const adopt = vi.fn().mockResolvedValue(adoption("conflict"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    const refresh = vi.fn();
    renderPanel({ status: "available", catalog: catalog() }, refresh, override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    await screen.findByTestId("inference-profile-revision-conflict");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("refusals are reported honestly", () => {
  it("reports the owner's refusal without claiming an adoption", async () => {
    const descriptor = editable();
    const adopt = vi.fn().mockRejectedValue(
      Object.assign(new Error("the owner does not publish this inference profile as editable"),
        { code: "inference_profile_edit_denied", status: 403, name: "ClientError" }),
    );
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: catalog() }, vi.fn(), override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    const shown = await screen.findByTestId("inference-profile-revision-refused");
    expect(shown).toHaveTextContent(/does not publish this inference profile as editable/);
    expect(screen.queryByTestId("inference-profile-revision-adopted")).toBeNull();
    expect(screen.queryByTestId("inference-profile-revision-replayed")).toBeNull();
    expect(screen.queryByTestId("inference-profile-revision-conflict")).toBeNull();
  });

  it("refuses an edit that does not satisfy the closed request without sending it", async () => {
    const descriptor = editable();
    const adopt = vi.fn();
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: catalog() }, vi.fn(), override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    // Empty version: an accepted edit must publish a NEW version, and the
    // closed request refuses this before the network.
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    const shown = await screen.findByTestId("inference-profile-revision-refused");
    expect(shown).toHaveTextContent(/request_invalid/);
    expect(adopt).not.toHaveBeenCalled();
  });

  it("refuses a budget beyond the producer's own ceiling without sending it", async () => {
    const descriptor = editable();
    const adopt = vi.fn();
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: catalog() }, vi.fn(), override);
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${descriptor.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${descriptor.profile_id}` }),
      { target: { value: "1.1.0" } });
    fireEvent.change(screen.getByRole("textbox", { name: `Max output tokens for ${descriptor.profile_id}` }),
      { target: { value: "2000001" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adopt revision" }));
    });
    expect(await screen.findByTestId("inference-profile-revision-refused")).toHaveTextContent(/request_invalid/);
    expect(adopt).not.toHaveBeenCalled();
  });
});

describe("the credential-leak guard and the catalog render agree", () => {
  it("renders the catalog when the owner discloses nothing credential-bearing", () => {
    renderPanel({ status: "available", catalog: catalog() });
    // Positive control for the guard itself: a clean catalog is shown and no
    // breach alert is raised, so the assertions below are not passing merely
    // because the alert and the render are both absent for unrelated reasons.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("owner-inference-profile-catalog")).toBeInTheDocument();
  });

  it("actually withholds the catalog when the owner discloses a credential-bearing field", () => {
    // The alert has always claimed the catalog "is withheld from this view".
    // It did not: the catalog rendered unconditionally on the next line, so an
    // operator reading the warning was told the opposite of what the component
    // did. This test pins the render guard to the claim, not the other way
    // round, because "withheld" is the honest reading of a leak.
    const leaked = catalog();
    (leaked.descriptors[0] as unknown as Record<string, unknown>).api_key = "sk-not-real";
    renderPanel({ status: "available", catalog: leaked });
    expect(screen.getByRole("alert")).toHaveTextContent(/credential-bearing fields/);
    expect(screen.getByRole("alert")).toHaveTextContent(/withheld from this view/);
    // The claim above must be true of the DOM: no descriptor may reach the
    // screen, and in particular not the planted secret itself.
    expect(screen.queryByTestId("owner-inference-profile-catalog")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("sk-not-real");
  });
});
