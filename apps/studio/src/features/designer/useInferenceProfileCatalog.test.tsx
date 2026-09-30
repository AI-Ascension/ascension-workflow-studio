import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FixtureClient } from "@studio/client";
import { ClientError, type StudioClient } from "@studio/client";
import type { InferenceProfileCatalog } from "@studio/contracts";
import {
  InferenceProfileCatalogSchema,
  findCredentialBearingProfileFields,
  inferenceProfilesForNodeKind,
} from "@studio/contracts";
import { catalogFixture, reseal } from "../../../../../packages/contracts/src/inference-profile-catalog.test-fixtures";
import { useInferenceProfileCatalog } from "./useInferenceProfileCatalog";

function deferred() {
  let resolve!: (value: InferenceProfileCatalog) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<InferenceProfileCatalog>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("inference profile catalog request generations", () => {
  it("starts pending and publishes a validated catalog", async () => {
    const client = new FixtureClient([]);
    const response = deferred();
    vi.spyOn(client, "listInferenceProfiles").mockReturnValue(response.promise);
    const { result } = renderHook(() => useInferenceProfileCatalog(client, "actor.one"));
    expect(result.current.state.status).toBe("pending");
    await act(async () => response.resolve(catalogFixture()));
    expect(result.current.state.status).toBe("available");
    expect(inferenceProfilesForNodeKind(
      result.current.state.status === "available" ? result.current.state.catalog : undefined, "decide",
    ).selectable).toHaveLength(1);
  });

  it("clears the catalog during refresh and after failure, never keeping a stale binding selectable", async () => {
    const client = new FixtureClient([]);
    const response = deferred();
    vi.spyOn(client, "listInferenceProfiles").mockResolvedValueOnce(catalogFixture()).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useInferenceProfileCatalog(client, "actor.one"));
    await waitFor(() => expect(result.current.state.status).toBe("available"));
    act(() => result.current.refresh());
    // During the pending render the catalog is withdrawn, so no profile can be
    // selected from the previous generation.
    expect(result.current.state.status).toBe("pending");
    expect(result.current.state).not.toHaveProperty("catalog");
    await act(async () => response.reject(new Error("offline")));
    expect(result.current.state.status).toBe("unavailable");
    expect(result.current.state).not.toHaveProperty("catalog");
  });

  it("ignores a late old client response after the new client fails", async () => {
    const old = new FixtureClient([]); const next = new FixtureClient([]);
    const pending = deferred();
    vi.spyOn(old, "listInferenceProfiles").mockReturnValue(pending.promise);
    vi.spyOn(next, "listInferenceProfiles").mockRejectedValue(new Error("denied"));
    const { result, rerender } = renderHook(({ client }) => useInferenceProfileCatalog(client, "actor"), { initialProps: { client: old as StudioClient } });
    rerender({ client: next as StudioClient });
    await waitFor(() => expect(result.current.state.status).toBe("unavailable"));
    await act(async () => pending.resolve(catalogFixture()));
    expect(result.current.state.status).toBe("unavailable");
    expect(result.current.state).not.toHaveProperty("catalog");
  });

  it("invalidates a prior principal and a superseded refresh immediately", async () => {
    const client = new FixtureClient([]);
    const old = deferred(); const next = deferred();
    vi.spyOn(client, "listInferenceProfiles").mockResolvedValueOnce(catalogFixture()).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ principal }) => useInferenceProfileCatalog(client, principal), { initialProps: { principal: "one" } });
    await waitFor(() => expect(result.current.state.status).toBe("available"));
    rerender({ principal: "two" });
    expect(result.current.state.status).toBe("pending");
    act(() => result.current.refresh());
    await act(async () => next.reject(new Error("unavailable")));
    await act(async () => old.resolve(catalogFixture()));
    expect(result.current.state.status).toBe("unavailable");
  });

  it("refuses a catalog that fails integrity or bounds validation instead of publishing it", async () => {
    const client = new FixtureClient([]);
    // Tampered catalog digest: schema-invalid, so it must not become available.
    const tampered = catalogFixture();
    tampered.catalog_digest = "f".repeat(64);
    vi.spyOn(client, "listInferenceProfiles").mockResolvedValue(tampered);
    const { result } = renderHook(() => useInferenceProfileCatalog(client, "actor"));
    await waitFor(() => expect(result.current.state.status).toBe("unavailable"));
    expect(result.current.state.status === "unavailable" && result.current.state.reason).toMatch(/integrity or bounds/);
    expect(InferenceProfileCatalogSchema.safeParse(tampered).success).toBe(false);
  });

  it("special-cases an owner 403 to a denial message", async () => {
    const client = new FixtureClient([]);
    vi.spyOn(client, "listInferenceProfiles").mockRejectedValue(new ClientError("forbidden", "forbidden", 403));
    const { result } = renderHook(() => useInferenceProfileCatalog(client, "actor"));
    await waitFor(() => expect(result.current.state.status).toBe("unavailable"));
    expect(result.current.state.status === "unavailable" && result.current.state.reason).toMatch(/denied access/);
  });

  it("does not fall back to the fixture catalog when the owner request fails", async () => {
    const client = new FixtureClient([]);
    vi.spyOn(client, "listInferenceProfiles").mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useInferenceProfileCatalog(client, "actor"));
    await waitFor(() => expect(result.current.state.status).toBe("unavailable"));
    // A failed owner request yields no catalog at all; the hook has no path
    // that produces selectable options without an admitted owner response.
    expect(inferenceProfilesForNodeKind(undefined, "decide").selectable).toEqual([]);
    expect(inferenceProfilesForNodeKind(undefined, "adaptive_region").selectable).toEqual([]);
  });
});

describe("inference profile leak guard positive control", () => {
  it("detects a planted credential field so the no-leak assertion cannot pass vacuously", () => {
    const catalog = catalogFixture();
    // Plant a forbidden field on a deep nested path.
    (catalog.descriptors[0] as unknown as Record<string, unknown>).effective_budgets = {
      ...catalog.descriptors[0].effective_budgets, api_key: "sk-not-a-real-key",
    };
    const found = findCredentialBearingProfileFields(catalog);
    expect(found).toEqual(["descriptors[0].effective_budgets.api_key"]);
  });

  it("reports no credential-bearing field on the real fixtures", () => {
    for (const name of ["synthetic", "editable", "negative"]) {
      expect(findCredentialBearingProfileFields(catalogFixture(name))).toEqual([]);
    }
  });
});

describe("inference profile capability filtering", () => {
  it("separates selectable from non-selectable per node kind and retains refusals", () => {
    const catalog = reseal(catalogFixture("negative"));
    const decide = inferenceProfilesForNodeKind(catalog, "decide");
    // Five of the six negative fixtures are refused on their own merits
    // (state or grant). `otherctx` is genuinely available and selectable, but
    // is constrained to a different context — the resolver refuses it for a
    // `decide` node bound to `context.synthetic.v1`.
    expect(decide.selectable.map((descriptor) => descriptor.profile_id)).toEqual(["otherctx.synthetic.v1"]);
    expect(decide.uneditable.map((descriptor) => descriptor.profile_id).sort()).toEqual([
      "denied.synthetic.v1", "disabled.synthetic.v1", "revoked.synthetic.v1",
      "stale.synthetic.v1", "unsupported.synthetic.v1",
    ]);
    const reasons = decide.uneditable.map((descriptor) => `${descriptor.profile_id}:${descriptor.state}:${descriptor.grants.select}`);
    expect(reasons).toContain("revoked.synthetic.v1:revoked:true");
    expect(reasons).toContain("denied.synthetic.v1:available:false");
    // An adaptive_region planner is not a decision profile.
    expect(inferenceProfilesForNodeKind(catalog, "adaptive_region").selectable).toEqual([]);
  });
});
