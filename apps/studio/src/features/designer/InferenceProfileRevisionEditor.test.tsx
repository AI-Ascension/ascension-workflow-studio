import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FixtureClient } from "@studio/client";
import type {
  InferenceProfileCatalog,
  InferenceProfileDescriptor,
  InferenceProfileRevisionAdoption,
  InferenceProfileRevisionRequest,
} from "@studio/contracts";
import { catalogFixture, reseal } from "../../../../../packages/contracts/src/inference-profile-catalog.test-fixtures";
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

/** Outcome state is keyed by profile, so one profile's outcome is never
 * rendered inside another's card.
 *
 * The fixture catalog carries exactly ONE editable profile, which is why this
 * could not be caught before: with a single editor there is no second card to
 * misattribute to. These cases build a two-editable-profile catalog (resealed
 * with the repo's own helper, so it still passes real admission) and assert
 * the banner appears only under the profile that was actually edited. */
describe("outcome state is per profile, not shared across the catalog", () => {
  const twoEditable = (): { catalog: InferenceProfileCatalog; first: InferenceProfileDescriptor; second: InferenceProfileDescriptor } => {
    const two = catalog();
    const first = two.descriptors.find((descriptor) => descriptor.grants.edit)!;
    const second = structuredClone(first) as InferenceProfileDescriptor;
    second.profile_id = "second.profile:beta";
    second.version = "2.0.0";
    two.descriptors = [structuredClone(first), second];
    reseal(two);
    return { catalog: two, first, second };
  };

  const region = (profileId: string): HTMLElement =>
    screen.getByRole("region", { name: `Inference profile ${profileId}` });
  const outcomesIn = (profileId: string, testId: string): number =>
    region(profileId).querySelectorAll(`[data-testid="${testId}"]`).length;
  // Both editors can be open at once, so the submit/cancel controls are
  // scoped to their own editor rather than queried globally.
  // A profile id can have more than one revision card, so callers that mean a
  // specific revision pass its version; without one this falls back to the
  // first card, which is correct only when the id is unique in the catalog.
  // A profile id may have more than one revision card, so callers select a card
  // by index into the catalog's descriptor order (its React key is
  // `${profile_id}:${version}`, so DOM order matches). Index 0 is the only
  // correct default when the id is unique in the catalog.
  const adoptIn = (profileId: string, revisionIndex = 0): HTMLElement =>
    screen.getAllByTestId(`inference-profile-revision-editor-${profileId}`)[revisionIndex]
      .querySelector("button.button-primary") as HTMLElement;
  const cancelIn = (profileId: string, revisionIndex = 0): HTMLElement =>
    screen.getAllByTestId(`inference-profile-revision-editor-${profileId}`)[revisionIndex]
      .querySelector("button.button-quiet") as HTMLElement;

  const adoptionFor = (descriptor: InferenceProfileDescriptor, outcome: "adopted" | "replayed" | "conflict") =>
    ({
      outcome,
      profile_id: descriptor.profile_id,
      reference: `${descriptor.profile_id}:9.9.9:${descriptor.digest}`,
      revision: descriptor,
      adopted: outcome === "adopted",
      conflicted: outcome === "conflict",
    }) as InferenceProfileRevisionAdoption;

  for (const outcome of ["adopted", "replayed", "conflict"] as const) {
    it(`renders an ${outcome} only under the profile that was edited`, async () => {
      const { catalog: two, first, second } = twoEditable();
      const adopt = vi.fn().mockResolvedValue(adoptionFor(first, outcome));
      const override = client();
      override.adoptInferenceProfileRevision = adopt;
      renderPanel({ status: "available", catalog: two }, vi.fn(), override);

      fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${first.profile_id}` }));
      fireEvent.change(screen.getByRole("textbox", { name: `New version for ${first.profile_id}` }),
        { target: { value: "1.1.0" } });
      await act(async () => {
        fireEvent.click(adoptIn(first.profile_id));
      });

      expect(adopt).toHaveBeenCalledTimes(1);
      const testId = outcome === "conflict"
        ? "inference-profile-revision-conflict"
        : outcome === "adopted"
          ? "inference-profile-revision-adopted"
          : "inference-profile-revision-replayed";
      // Exactly one banner in the whole panel, and it is the edited profile's.
      expect(screen.queryAllByTestId(testId)).toHaveLength(1);
      expect(outcomesIn(first.profile_id, testId)).toBe(1);
      // The sibling profile's card asserts nothing about an edit it never made.
      expect(outcomesIn(second.profile_id, testId)).toBe(0);
      // And the wrong reference is nowhere on screen outside the edited card.
      expect(region(second.profile_id).textContent ?? "").not.toContain(adoptionFor(first, outcome).reference);
    });
  }

  it("keeps each profile's outcome independent across two separate edits", async () => {
    const { catalog: two, first, second } = twoEditable();
    const adopt = vi.fn()
      .mockResolvedValueOnce(adoptionFor(first, "adopted"))
      .mockResolvedValueOnce(adoptionFor(second, "conflict"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: two }, vi.fn(), override);

    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${first.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${first.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(adoptIn(first.profile_id));
    });
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${second.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${second.profile_id}` }),
      { target: { value: "2.1.0" } });
    await act(async () => {
      fireEvent.click(adoptIn(second.profile_id));
    });

    expect(adopt).toHaveBeenCalledTimes(2);
    expect(adopt.mock.calls.map(([id]) => id)).toEqual([first.profile_id, second.profile_id]);
    // Each profile keeps its own distinct outcome; neither overwrites the other.
    expect(outcomesIn(first.profile_id, "inference-profile-revision-adopted")).toBe(1);
    expect(outcomesIn(second.profile_id, "inference-profile-revision-adopted")).toBe(0);
    expect(outcomesIn(second.profile_id, "inference-profile-revision-conflict")).toBe(1);
    expect(outcomesIn(first.profile_id, "inference-profile-revision-conflict")).toBe(0);
  });

  it("does not let one profile's cancel clear a sibling's outcome", async () => {
    const { catalog: two, first, second } = twoEditable();
    const adopt = vi.fn().mockResolvedValue(adoptionFor(first, "adopted"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: two }, vi.fn(), override);

    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${first.profile_id}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `New version for ${first.profile_id}` }),
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(adoptIn(first.profile_id));
    });
    expect(outcomesIn(first.profile_id, "inference-profile-revision-adopted")).toBe(1);

    // Opening and cancelling the SIBLING editor must not disturb the outcome
    // recorded against the profile that was actually edited.
    fireEvent.click(screen.getByRole("button", { name: `Adopt a revision of ${second.profile_id}` }));
    fireEvent.click(cancelIn(second.profile_id));
    expect(outcomesIn(first.profile_id, "inference-profile-revision-adopted")).toBe(1);
  });

  it("keeps two VERSIONS of the same profile_id separate", async () => {
    // The catalog's uniqueness rule is on `(profile_id, version)`
    // (`InferenceProfileCatalogSchema` rejects only duplicate PAIRS, and
    // `resolveInferenceProfile` selects on both fields), so a catalog may
    // legally carry two revisions of one profile. Keying outcome state on
    // `profile_id` alone would make those two cards share one banner —
    // reintroducing the same misattribution under a different shape.
    const two = catalog();
    const first = two.descriptors.find((descriptor) => descriptor.grants.edit)!;
    const second = structuredClone(first) as InferenceProfileDescriptor;
    second.version = "9.9.9";
    second.digest = "b".repeat(64);
    two.descriptors = [structuredClone(first), second];
    reseal(two);

    const adopt = vi.fn().mockResolvedValue(adoptionFor(first, "adopted"));
    const override = client();
    override.adoptInferenceProfileRevision = adopt;
    renderPanel({ status: "available", catalog: two }, vi.fn(), override);

    // Both revisions are rendered as distinct cards for the SAME profile id.
    expect(screen.getAllByRole("region", { name: `Inference profile ${first.profile_id}` })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: `Adopt a revision of ${first.profile_id}` })[0]);
    fireEvent.change(screen.getAllByRole("textbox", { name: `New version for ${first.profile_id}` })[0],
      { target: { value: "1.1.0" } });
    await act(async () => {
      fireEvent.click(adoptIn(first.profile_id, 0));
    });

    expect(adopt).toHaveBeenCalledTimes(1);
    // One banner only, and it is the edited revision's — the sibling version of
    // the same profile_id must not inherit it.
    expect(screen.queryAllByTestId("inference-profile-revision-adopted")).toHaveLength(1);
    const cards = screen.getAllByRole("region", { name: `Inference profile ${first.profile_id}` });
    expect(cards[0].querySelectorAll('[data-testid="inference-profile-revision-adopted"]')).toHaveLength(1);
    expect(cards[1].querySelectorAll('[data-testid="inference-profile-revision-adopted"]')).toHaveLength(0);
  });
});

/** The staleness guard must be PER PROFILE REVISION.
 *
 * Every test above drives `adopt` to settle synchronously, so none of them can
 * observe what happens while a response is still genuinely in flight. That is
 * exactly how the shared-counter defect survived them: a submit for profile A
 * whose response was still pending was discarded when profile B's `reset()`
 * bumped the one global counter, the early return fired, A's real adoption
 * outcome was thrown away, and A's button was left stuck on "Adopting…" and
 * `disabled` with no self-recovery — because the button state is derived from
 * the very outcome that got dropped.
 *
 * These cases hold the promise open with a deferred the test controls, so the
 * interleaving is real rather than simulated. The last one uses a SIBLING
 * VERSION of the same `profile_id`, because a catalog may legally carry two
 * revisions of one profile: a guard keyed on `profile_id` alone would pass
 * every distinct-id case and still lose that one. */
describe("the in-flight guard is per profile revision, not one shared counter", () => {
  /** Two editable descriptors to drive. `sameProfileId` makes the second a
   * different VERSION of the first, which the catalog's own uniqueness rule
   * permits; otherwise it is a distinct profile. */
  const twoEditable = (sameProfileId = false): {
    catalog: InferenceProfileCatalog;
    first: InferenceProfileDescriptor;
    second: InferenceProfileDescriptor;
  } => {
    const two = catalog();
    const first = two.descriptors.find((descriptor) => descriptor.grants.edit)!;
    const second = structuredClone(first) as InferenceProfileDescriptor;
    second.version = "9.9.9";
    second.digest = "b".repeat(64);
    if (!sameProfileId) second.profile_id = "second.profile:beta";
    two.descriptors = [structuredClone(first), second];
    reseal(two);
    return { catalog: two, first, second };
  };

  // Two revisions of one profile_id render identical accessible names, so
  // every lookup is by CARD INDEX rather than by profile id. The editor's own
  // testid is the anchor: it sits inside exactly one profile card, and its
  // name is unique only when the ids differ, so the index disambiguates both
  // shapes. Nothing here matches by region name, which would also match the
  // enclosing "Inference profile catalog" panel and shift every index.
  const editorIn = (index: number): HTMLElement =>
    screen.getAllByTestId(/^inference-profile-revision-editor-./)[index];
  const card = (index: number): HTMLElement =>
    editorIn(index).closest("section[aria-label]") as HTMLElement;
  const adoptIn = (index: number): HTMLElement =>
    editorIn(index).querySelector("button.button-primary") as HTMLElement;
  const cancelIn = (index: number): HTMLElement =>
    editorIn(index).querySelector("button.button-quiet") as HTMLElement;
  const openIn = (index: number): void => {
    fireEvent.click(editorIn(index).querySelector("button.button-secondary") as HTMLElement);
  };
  const setVersion = (index: number, value: string): void => {
    fireEvent.change(
      editorIn(index).querySelector('input[aria-label^="New version"]') as HTMLElement,
      { target: { value } });
  };
  const outcomesIn = (index: number, testId: string): number =>
    card(index).querySelectorAll(`[data-testid="${testId}"]`).length;
  const stuckOn = (index: number): boolean =>
    adoptIn(index).hasAttribute("disabled") || adoptIn(index).textContent === "Adopting…";

  type Deferred = { resolve: () => void };
  /** A client whose `adopt` stays pending until the test resolves it.
   *
   * The answer is built from the ACTUAL submitted request — the profile id the
   * call was made for, the new version, and the editable members — so the
   * accepted revision carries true provenance. Reusing the single fixture
   * descriptor wholesale would leave a stale digest behind a new profile id,
   * which is a lie about what the owner accepted, and dropping `adopted` would
   * store the outcome as a replay rather than an adoption. */
  const deferredClient = (): { client: FixtureClient; settled: Deferred[] } => {
    const settled: Deferred[] = [];
    const instance = new FixtureClient([]);
    instance.adoptInferenceProfileRevision = (
      profileId: string,
      request: InferenceProfileRevisionRequest,
    ) => new Promise<InferenceProfileRevisionAdoption>((resolve) => {
      settled.push({
        resolve: () => {
          const accepted = structuredClone(editable()) as InferenceProfileDescriptor;
          accepted.profile_id = profileId;
          accepted.version = request.version;
          accepted.prompt_revision = request.prompt_revision;
          accepted.settings_revision = request.settings_revision;
          accepted.supported_settings = [...request.supported_settings];
          accepted.effective_budgets = { ...request.effective_budgets };
          resolve({
            outcome: "adopted",
            // The reference is the acceptance identity: the accepted
            // revision's own id, version and digest.
            reference: `${accepted.profile_id}:${accepted.version}:${accepted.digest}`,
            profile_id: accepted.profile_id,
            revision: accepted,
            adopted: true,
            conflicted: false,
          });
        },
      });
    });
    return { client: instance, settled };
  };

  it("records A's real outcome even though a SIBLING's reset ran while A was in flight", async () => {
    const { catalog: two, first } = twoEditable();
    const { client: owner, settled } = deferredClient();
    renderPanel({ status: "available", catalog: two }, vi.fn(), owner);

    openIn(0);
    setVersion(0, "1.1.0");
    fireEvent.click(adoptIn(0));
    expect(stuckOn(0)).toBe(true);

    // The sibling's cancel bumps the guard. Under one shared counter this
    // silently discarded A's pending response.
    openIn(1);
    fireEvent.click(cancelIn(1));

    await act(async () => { settled[0].resolve(); });
    await waitFor(() => expect(outcomesIn(0, "inference-profile-revision-adopted")).toBe(1));
    expect(outcomesIn(1, "inference-profile-revision-adopted")).toBe(0);
    expect(stuckOn(0)).toBe(false);
  });

  it("still discards A's own in-flight response when A itself resets", async () => {
    const { catalog: two, first } = twoEditable();
    const { client: owner, settled } = deferredClient();
    renderPanel({ status: "available", catalog: two }, vi.fn(), owner);

    openIn(0);
    setVersion(0, "1.1.0");
    fireEvent.click(adoptIn(0));
    expect(stuckOn(0)).toBe(true);

    // Same revision: the guard must still do its job.
    fireEvent.click(cancelIn(0));

    await act(async () => { settled[0].resolve(); });
    expect(outcomesIn(0, "inference-profile-revision-adopted")).toBe(0);
  });

  it("still lets a SECOND submit for the same profile supersede the first", async () => {
    const { catalog: two, first } = twoEditable();
    const { client: owner, settled } = deferredClient();
    renderPanel({ status: "available", catalog: two }, vi.fn(), owner);

    openIn(0);
    setVersion(0, "1.1.0");
    fireEvent.click(adoptIn(0));
    fireEvent.click(cancelIn(0));
    openIn(0);
    setVersion(0, "1.2.0");
    fireEvent.click(adoptIn(0));
    expect(settled.length).toBe(2);

    // Settle the SECOND first, then the superseded first: the stale one must
    // not overwrite it.
    await act(async () => { settled[1].resolve(); });
    await act(async () => { settled[0].resolve(); });
    await waitFor(() => expect(outcomesIn(0, "inference-profile-revision-adopted")).toBe(1));
    expect(stuckOn(0)).toBe(false);
  });

  /** The sharpest form of the defect: a sibling that shares the `profile_id`
   * but differs only by VERSION — legal in one catalog, because the
   * uniqueness rule is on `(profile_id, version)`. A guard keyed on
   * `profile_id` alone passes every distinct-id case above and still discards
   * A's pending response here. */
  it("records A's real outcome even though a SIBLING VERSION of the same profile_id reset", async () => {
    const { catalog: two, first } = twoEditable(true);
    const { client: owner, settled } = deferredClient();
    renderPanel({ status: "available", catalog: two }, vi.fn(), owner);
    expect(screen.getAllByRole("region", { name: `Inference profile ${first.profile_id}` })).toHaveLength(2);

    openIn(0);
    setVersion(0, "1.1.0");
    fireEvent.click(adoptIn(0));
    expect(stuckOn(0)).toBe(true);

    openIn(1);
    fireEvent.click(cancelIn(1));

    await act(async () => { settled[0].resolve(); });
    await waitFor(() => expect(outcomesIn(0, "inference-profile-revision-adopted")).toBe(1));
    expect(outcomesIn(1, "inference-profile-revision-adopted")).toBe(0);
    expect(stuckOn(0)).toBe(false);
  });
});
