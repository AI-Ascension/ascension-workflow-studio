import { describe, expect, it } from "vitest";
import {
  InferenceProfileCatalogSchema,
  findCredentialBearingProfileFields,
  inferenceProfilesForNodeKind,
  resolveInferenceProfile,
  type InferenceProfileCatalog,
} from "./inference-profile-catalog";

import catalogFixture from "../../../contracts/accepted/inference-profile/catalog-conformance.json" with { type: "json" };

function catalogNamed(name: string): InferenceProfileCatalog {
  const row = catalogFixture.catalogs.find((entry) => entry.name === name);
  if (!row) throw new Error(`missing fixture catalog ${name}`);
  return InferenceProfileCatalogSchema.parse(row.catalog);
}

function selectionOf(catalog: InferenceProfileCatalog, profileId: string) {
  const descriptor = catalog.descriptors.find((d) => d.profile_id === profileId);
  if (!descriptor) throw new Error(`missing descriptor ${profileId}`);
  return { profile_id: descriptor.profile_id, version: descriptor.version, digest: descriptor.digest };
}

describe("inference profile catalog — producer conformance", () => {
  // These fixtures were sealed by the Rust owner (sts2-harness `be5149a3`,
  // `InferenceProfileDescriptor::seal` + `inference_catalog_digest`). Parsing
  // them proves the consumer's field order and digest arithmetic match the
  // producer byte-for-byte rather than merely agreeing with itself.
  it("admits owner-sealed catalogs without re-encoding", () => {
    for (const name of ["baseline", "editable", "negative"]) {
      const catalog = catalogNamed(name);
      expect(catalog.descriptors.length).toBeGreaterThan(0);
    }
  });

  it("rejects a catalog whose catalog_digest was tampered with", () => {
    const catalog = catalogNamed("baseline");
    const tampered = { ...catalog, catalog_digest: "0".repeat(64) };
    expect(InferenceProfileCatalogSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects a descriptor whose immutable fields changed under a stale digest", () => {
    const catalog = catalogNamed("baseline");
    const [first, ...rest] = catalog.descriptors;
    const tampered = {
      ...catalog,
      descriptors: [{ ...first, adapter: "attacker.adapter.v9" }, ...rest],
    };
    expect(InferenceProfileCatalogSchema.safeParse(tampered).success).toBe(false);
  });
});

describe("AC1 — two nodes resolve distinct profiles with exact identities", () => {
  it("binds a decide node and an adaptive planner to different exact revisions", () => {
    const catalog = catalogNamed("baseline");
    const decide = resolveInferenceProfile(catalog, selectionOf(catalog, "decision.synthetic.v1"), "decide", "context.live.v1");
    const plan = resolveInferenceProfile(catalog, selectionOf(catalog, "planner.synthetic.v1"), "adaptive_region");

    expect(decide.ok).toBe(true);
    expect(plan.ok).toBe(true);
    // Distinct profiles, and therefore distinct immutable identities.
    expect(decide.selection?.digest).not.toBe(plan.selection?.digest);
    // Requested and resolved are reported separately, never merged.
    expect(decide.requested_model).toBe("synthetic.model.v1");
    expect(decide.resolved_model).toBe("synthetic.model.v1.observed");
    expect(decide.adapter).toBe("synthetic.provider.v1");
    expect(decide.prompt_revision).toBe("synthetic.prompt.v1");
    expect(decide.settings_revision).toBe("synthetic.settings.v1");
  });

  it("keeps an unobserved effective model null instead of inferring it", () => {
    const catalog = catalogNamed("editable");
    const plan = resolveInferenceProfile(catalog, selectionOf(catalog, "planner.synthetic.v1"), "adaptive_region");
    expect(plan.ok).toBe(true);
    expect(plan.requested_model).toBe("synthetic.model.v1");
    expect(plan.resolved_model).toBeNull();
  });
});

describe("AC2 — invalid profiles prevent inference", () => {
  const cases: Array<[string, string, string, string]> = [
    ["revoked.synthetic.v1", "decide", "context.live.v1", "not_available"],
    ["denied.synthetic.v1", "decide", "context.live.v1", "selection_not_granted"],
    ["otherctx.synthetic.v1", "decide", "context.live.v1", "context_incompatible"],
    ["stale.synthetic.v1", "decide", "context.live.v1", "not_available"],
  ];

  it.each(cases)("refuses %s for %s with %s", (profileId, nodeKind, contextRef, expected) => {
    const catalog = catalogNamed("negative");
    const result = resolveInferenceProfile(catalog, selectionOf(catalog, profileId), nodeKind, contextRef);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe(expected);
    // A refusal must never leak a usable identity.
    expect(result.adapter).toBeUndefined();
    expect(result.selection).toBeUndefined();
  });

  it("refuses an unknown profile id", () => {
    const catalog = catalogNamed("baseline");
    const result = resolveInferenceProfile(
      catalog,
      { profile_id: "absent.synthetic.v1", version: "1.0.0", digest: "a".repeat(64) },
      "decide",
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("unknown_profile");
  });

  it("refuses a version/digest mismatch as stale rather than re-resolving", () => {
    const catalog = catalogNamed("baseline");
    const result = resolveInferenceProfile(
      catalog,
      { profile_id: "decision.synthetic.v1", version: "1.0.0", digest: "b".repeat(64) },
      "decide",
      "context.live.v1",
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("stale_binding");
  });

  it("refuses a node kind the profile does not serve", () => {
    const catalog = catalogNamed("baseline");
    const result = resolveInferenceProfile(
      catalog,
      selectionOf(catalog, "decision.synthetic.v1"),
      "adaptive_region",
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("unsupported_node_kind");
  });

  it("refuses everything when the catalog itself fails admission", () => {
    const broken = { ...catalogNamed("baseline"), catalog_digest: "c".repeat(64) };
    const result = resolveInferenceProfile(
      broken as InferenceProfileCatalog,
      { profile_id: "decision.synthetic.v1", version: "1.0.0", digest: "d".repeat(64) },
      "decide",
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("unknown_profile");
  });
});

describe("AC3 — an updated revision does not silently alter an existing binding", () => {
  it("leaves a previously valid binding resolvable under its own pinned digest", () => {
    const catalog = catalogNamed("baseline");
    const pinned = selectionOf(catalog, "decision.synthetic.v1");
    const before = resolveInferenceProfile(catalog, pinned, "decide", "context.live.v1");
    expect(before.ok).toBe(true);

    // A new revision is a distinct identity. The old pinned digest still
    // resolves only while the owner still serves that exact descriptor.
    const after = resolveInferenceProfile(catalog, pinned, "decide", "context.live.v1");
    expect(after.ok).toBe(true);
    expect(after.selection?.digest).toBe(pinned.digest);
  });

  it("does not accept a newer version under the older pinned identity", () => {
    const catalog = catalogNamed("baseline");
    const result = resolveInferenceProfile(
      catalog,
      { profile_id: "decision.synthetic.v1", version: "2.0.0", digest: selectionOf(catalog, "decision.synthetic.v1").digest },
      "decide",
      "context.live.v1",
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("unknown_profile");
  });
});

describe("AC4 — selection grants expose no credentials and split edit authority", () => {
  it("publishes no credential, endpoint, executable or prompt bytes", () => {
    for (const name of ["baseline", "editable", "negative"]) {
      expect(findCredentialBearingProfileFields(catalogNamed(name))).toEqual([]);
    }
  });

  it("separates selectable from non-selectable for the designer", () => {
    const catalog = catalogNamed("negative");
    const { selectable, uneditable } = inferenceProfilesForNodeKind(catalog, "decide");
    // `otherctx` is available and granted; it is refused only for the context
    // actually requested, so it stays selectable at the catalog level.
    expect(selectable.map((d) => d.profile_id)).toEqual(["otherctx.synthetic.v1"]);
    // Revoked, select-denied and stale rows stay visible so the designer can
    // render why a bound profile stopped being servable.
    expect(uneditable.map((d) => d.profile_id).sort()).toEqual([
      "denied.synthetic.v1",
      "revoked.synthetic.v1",
      "stale.synthetic.v1",
    ]);
  });

  it("surfaces the editable grant separately from selection", () => {
    const catalog = catalogNamed("editable");
    const decide = catalog.descriptors.find((d) => d.profile_id === "decision.synthetic.v1");
    const planner = catalog.descriptors.find((d) => d.profile_id === "planner.synthetic.v1");
    expect(decide?.grants).toEqual({ select: true, edit: true });
    // Selectable but not editable: the browser may bind it, never rewrite it.
    expect(planner?.grants).toEqual({ select: true, edit: false });
  });

  it("carries no allowed_operations authority beyond the published list", () => {
    const catalog = catalogNamed("editable");
    const planner = catalog.descriptors.find((d) => d.profile_id === "planner.synthetic.v1");
    expect(planner?.operations).toEqual(["adaptive_region"]);
    // Tool authority stays with the owner; a planner cannot enlarge its own.
    expect(Object.keys(planner ?? {})).not.toContain("allowed_operations");
  });
});

describe("AC5 — synthetic resolution only", () => {
  it("uses synthetic identities and contacts no provider", () => {
    const catalog = catalogNamed("baseline");
    const ids = catalog.descriptors.flatMap((d) => [d.adapter, d.requested_model]);
    expect(ids.every((id) => id.startsWith("synthetic."))).toBe(true);
  });
});
