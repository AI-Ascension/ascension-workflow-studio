import { describe, expect, it } from "vitest";
import {
  InferenceProfileCatalogSchema,
  InferenceProfileDescriptorSchema,
  findCredentialBearingProfileFields,
  inferenceProfilesForNodeKind,
  resolveInferenceProfile,
  type InferenceProfileCatalog,
  type InferenceProfileDescriptor,
  type InferenceProfileRejection,
} from "./inference-profile-catalog";
import { catalogFixture, reseal } from "./inference-profile-catalog.test-fixtures";

/** Every catalog used here satisfies the producer's `seal()` and `validate()`
 * invariants; see `contracts/accepted/inference-profile/catalog-conformance.json`
 * and `contracts/inference-profile-catalog.lock.json`. No producer code is run on
 * this side: the seal is a replica whose declared field order is pinned as data
 * and cross-checked by `tools/verify-contract-pins.mjs`. Apart from the
 * deliberate tampering described below, nothing in this suite re-derives a
 * digest.
 *
 * NOTHING here contacted a provider, a model, a native host, a game or a save
 * file. The identities are the harness's clearly-labelled synthetic
 * fixtures, and these assertions prove contract arithmetic only. */
function catalogNamed(name: string): InferenceProfileCatalog {
  return InferenceProfileCatalogSchema.parse(catalogFixture(name));
}

function selectionOf(catalog: InferenceProfileCatalog, profileId: string) {
  const descriptor = catalog.descriptors.find((d) => d.profile_id === profileId);
  if (!descriptor) throw new Error(`missing descriptor ${profileId}`);
  return {
    profile_id: descriptor.profile_id,
    version: descriptor.version,
    digest: descriptor.digest,
  };
}

function messages(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("producer conformance — the mirror matches the owner's bytes", () => {
  // POSITIVE CONTROL. If `orderedDescriptor` had the wrong field order, or the
  // catalog digest were computed over an object instead of the producer's
  // three-element array, every catalog in this fixture would fail admission and
  // this first assertion would fail. It is the anchor the whole file rests on.
  it("admits the pinned conformance catalogs without re-encoding", () => {
    for (const name of ["synthetic", "editable", "negative"]) {
      const catalog = catalogNamed(name);
      expect(catalog.descriptors.length).toBeGreaterThan(0);
      expect(catalog.catalog_digest).toMatch(/^[a-f0-9]{64}$/);
      for (const descriptor of catalog.descriptors) {
        expect(InferenceProfileDescriptorSchema.safeParse(descriptor).success).toBe(true);
      }
    }
  });

  it("pins the exact producer digests rather than recomputing an equivalent", () => {
    // If these literals were ever rewritten to whatever the consumer happens to
    // compute, the mirror would stop being checked against the producer.
    expect(catalogNamed("synthetic").catalog_digest)
      .toBe("f179223c73abacabb6f0d58e1c9e397ff147ec9caea7be26c4fdaf816bd508ca");
    expect(selectionOf(catalogNamed("synthetic"), "decision.synthetic.v1").digest)
      .toBe("373a273fb8999d23443025bbdef3a129f59a22ca3d67d6e64418a94185fb57f5");
    expect(selectionOf(catalogNamed("synthetic"), "planner.synthetic.v1").digest)
      .toBe("4c331b9bd1db35651aed312b0b5e09a52b51f149d081b8c092d1060bb0a221d1");
  });

  it("rejects a catalog whose catalog_digest was tampered with", () => {
    const tampered = { ...catalogNamed("synthetic"), catalog_digest: "0".repeat(64) };
    const result = InferenceProfileCatalogSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("Catalog digest mismatch");
  });

  it("rejects a descriptor whose immutable fields changed under a stale digest", () => {
    const catalog = catalogFixture("synthetic");
    catalog.descriptors[0].adapter = "attacker.adapter.v9";
    const result = InferenceProfileCatalogSchema.safeParse(catalog);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("Descriptor digest mismatch");
  });

  it("rejects a single flipped hex digit in a descriptor digest", () => {
    const catalog = catalogFixture("synthetic");
    const digest = catalog.descriptors[0].digest;
    catalog.descriptors[0].digest = `${digest[0] === "0" ? "1" : "0"}${digest.slice(1)}`;
    const result = InferenceProfileCatalogSchema.safeParse(catalog);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("Descriptor digest mismatch");
    // Only the DESCRIPTOR reason is reported. The producer's `validate()`
    // returns early on the first failing descriptor (`descriptor.validate()?`)
    // and never reaches the catalog-digest comparison, so a consumer that also
    // reported a catalog mismatch here would be claiming a check the owner
    // itself does not perform. Asserting the absence keeps that faithful.
    expect(messages(result)).not.toContain("Catalog digest mismatch");
  });

  it("rejects reordering the descriptor array, because array order is signed", () => {
    const catalog = catalogFixture("synthetic");
    catalog.descriptors.reverse();
    const result = InferenceProfileCatalogSchema.safeParse(catalog);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("Catalog digest mismatch");
  });

  it("rejects a version carrying a leading zero, as SemanticVersion::new does", () => {
    // The catalog is RESEALED after the edit, so it is internally consistent and
    // the ONLY remaining violation is the version shape. Without the reseal this
    // row would be refused by the digest check and would pass even if the
    // semver rule were deleted outright — a vacuous assertion.
    const catalog = catalogFixture("synthetic");
    catalog.descriptors[0].version = "01.0.0";
    const resealed = reseal(catalog);
    // Prove the reseal took effect, so the rejection below cannot be blamed on a
    // stale digest: the descriptor now carries a fresh, self-consistent digest.
    expect(resealed.descriptors[0].digest).not.toBe(catalogNamed("synthetic").descriptors[0].digest);
    const result = InferenceProfileDescriptorSchema.safeParse(resealed.descriptors[0]);
    expect(result.success).toBe(false);
    // A self-consistent digest must NOT be enough to admit it.
    expect(messages(result)).not.toContain("Descriptor digest mismatch");
  });

  it("rejects an identifier longer than the producer's 128-byte bound", () => {
    const catalog = catalogFixture("synthetic");
    catalog.descriptors[0].prompt_revision = `p${"x".repeat(128)}`;
    expect(InferenceProfileDescriptorSchema.safeParse(catalog.descriptors[0]).success).toBe(false);
  });

  it("bounds the identifier by the producer's UTF-8 byte rule, and the rule is ASCII-only", () => {
    // Producer `validate_identifier` (contract_json.rs at the pinned revision)
    // checks `value.len() > MAX_IDENTIFIER_BYTES` — `len()` on a Rust `str` is
    // UTF-8 BYTES — and then requires an ASCII alphanumeric first character
    // with ASCII alphanumeric / `. _ : -` thereafter.
    //
    // Consequence: for any charset-LEGAL identifier, UTF-8 bytes == UTF-16
    // code units, so the byte-aware bound is indistinguishable from a
    // code-unit bound on legal input, so only a charset-ILLEGAL value can
    // separate the two rules — that is the `discriminating` case below. The
    // ASCII cases pin only that the bound is 128 and inclusive; they cannot by
    // themselves show the bound counts bytes.
    const atLimit = catalogFixture("synthetic");
    // 128 ASCII bytes == the producer's inclusive upper bound.
    atLimit.descriptors[0].prompt_revision = "p" + "x".repeat(127);
    expect(new TextEncoder().encode(atLimit.descriptors[0].prompt_revision).length).toBe(128);
    const atLimitSealed = reseal(atLimit);
    const atLimitResult = InferenceProfileDescriptorSchema.safeParse(atLimitSealed.descriptors[0]);
    expect(atLimitResult.success).toBe(true);

    const oneOverLimit = catalogFixture("synthetic");
    oneOverLimit.descriptors[0].prompt_revision = "p" + "x".repeat(128);
    expect(new TextEncoder().encode(oneOverLimit.descriptors[0].prompt_revision).length).toBe(129);
    const overSealed = reseal(oneOverLimit);
    const overResult = InferenceProfileDescriptorSchema.safeParse(overSealed.descriptors[0]);
    expect(overResult.success).toBe(false);
    // Reseal first, so the rejection is attributable to the bound and not to
    // a digest left stale by the edit.
    expect(messages(overResult)).toContain("identifier exceeds the 128-byte producer bound");

    // DISCRIMINATING PROBE: 129 UTF-8 bytes but only 65 UTF-16 code units.
    // Under the correct byte bound this trips the bound refine; under a buggy
    // code-unit bound (`value.length <= 128`) the refine passes and only the
    // charset regex objects, so the bound message is absent.
    const discriminating = catalogFixture("synthetic");
    discriminating.descriptors[0].prompt_revision = "é".repeat(64) + "a";
    const probeBytes = new TextEncoder().encode(discriminating.descriptors[0].prompt_revision).length;
    const probeCodeUnits = discriminating.descriptors[0].prompt_revision.length;
    expect(probeBytes).toBe(129);
    expect(probeCodeUnits).toBe(65);
    // The two counts MUST differ, or this probe stops discriminating anything:
    // a 129-byte value that is also 129 code units is plain ASCII, which a
    // code-unit bound rejects just as readily. Asserting the two numbers
    // separately is not enough, because an edit could set both to 129 and
    // still satisfy every assertion above while silently removing the
    // coverage this probe exists to provide.
    expect(probeBytes).not.toBe(probeCodeUnits);
    const discSealed = reseal(discriminating);
    const discResult = InferenceProfileDescriptorSchema.safeParse(discSealed.descriptors[0]);
    expect(discResult.success).toBe(false);
    expect(messages(discResult)).toContain("identifier exceeds the 128-byte producer bound");

    // A non-ASCII identifier is refused: the producer's charset is ASCII, so a
    // multi-byte character is not an escape hatch past either rule.
    const nonAscii = catalogFixture("synthetic");
    nonAscii.descriptors[0].prompt_revision = "pé";
    const nonAsciiSealed = reseal(nonAscii);
    const nonAsciiResult = InferenceProfileDescriptorSchema.safeParse(nonAsciiSealed.descriptors[0]);
    expect(nonAsciiResult.success).toBe(false);
    // Zod surfaces the charset rule as a pattern failure, not the producer's
    // wording; the point is that the non-ASCII value is refused and NOT by the
    // byte bound (it is well under 128 bytes).
    expect(messages(nonAsciiResult)).not.toContain("identifier exceeds the 128-byte producer bound");
    expect(messages(nonAsciiResult).join(" ")).toMatch(/must match pattern/i);
  });


  it("rejects budgets above the producer's published ceilings", () => {
    // Each ceiling is moved one step past the producer's bound and the catalog is
    // RESEALED, so the edited descriptor is internally consistent and the ceiling
    // is the only thing that can refuse it. Without the reseal this test passes
    // even with every `.max()` deleted, because the stale digest refuses the
    // descriptor first. Zod reports the ceiling as "Too big: expected number to
    // be <=<ceiling>", so the ceiling VALUE is asserted rather than the field name.
    const ceilings: Array<
      [keyof InferenceProfileDescriptor["effective_budgets"], number, number]
    > = [
      ["max_input_bytes", 131_073, 131_072],
      ["max_output_tokens", 2_000_001, 2_000_000],
      ["max_provider_calls", 10_001, 10_000],
    ];
    for (const [field, over, ceiling] of ceilings) {
      const catalog = catalogFixture("synthetic");
      catalog.descriptors[0].effective_budgets[field] = over;
      const resealed = reseal(catalog);
      const parsed = InferenceProfileDescriptorSchema.safeParse(resealed.descriptors[0]);
      expect(parsed.success, `${field} above its ceiling was admitted`).toBe(false);
      expect(messages(parsed).join("|")).toContain(`<=${ceiling}`);
      // A self-consistent digest must NOT be enough to admit it.
      expect(messages(parsed)).not.toContain("Descriptor digest mismatch");
    }
    // Positive control: the shipped fixtures sit UNDER every ceiling, so each
    // bound is load-bearing rather than an inequality nothing could satisfy.
    const admitted = catalogNamed("synthetic").descriptors[0];
    for (const [field, over] of ceilings) {
      expect(admitted.effective_budgets[field]).toBeLessThan(over);
    }
  });

  it("rejects a duplicated list entry the producer would call a duplicate", () => {
    const catalog = catalogFixture("synthetic");
    catalog.descriptors[0].node_kinds = ["decide", "decide"];
    const result = InferenceProfileDescriptorSchema.safeParse(catalog.descriptors[0]);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("Duplicate node kind");
  });

  it("refuses the whole catalog when one descriptor in it fails admission", () => {
    const tampered = catalogFixture("synthetic");
    tampered.descriptors[1].state = "revoked";
    // A single bad descriptor must not be admitted alongside good ones.
    expect(InferenceProfileCatalogSchema.safeParse(tampered).success).toBe(false);
    const pinned = selectionOf(catalogNamed("synthetic"), "decision.synthetic.v1");
    expect(resolveInferenceProfile(tampered, pinned, "decide").rejection).toBe("catalog_untrusted");
  });
});

describe("resolution — exact identities, requested never merged into resolved", () => {
  it("binds two different node kinds to two different exact revisions", () => {
    const catalog = catalogNamed("editable");
    const decide = resolveInferenceProfile(
      catalog, selectionOf(catalog, "decision.synthetic.v1"), "decide", "context.synthetic.v1");
    const plan = resolveInferenceProfile(
      catalog, selectionOf(catalog, "planner.synthetic.v1"), "adaptive_region");

    expect(decide.ok).toBe(true);
    expect(plan.ok).toBe(true);
    expect(decide.selection?.digest).not.toBe(plan.selection?.digest);
  });

  it("reports an observed effective model beside, not instead of, the requested one", () => {
    const catalog = catalogNamed("editable");
    const decide = resolveInferenceProfile(
      catalog, selectionOf(catalog, "decision.synthetic.v1"), "decide", "context.synthetic.v1");
    expect(decide.requested_model).toBe("synthetic.model.v1");
    expect(decide.resolved_model).toBe("synthetic.model.v1.observed");
    expect(decide.adapter).toBe("synthetic.provider.v1");
    expect(decide.prompt_revision).toBe("synthetic.prompt.v1");
    expect(decide.settings_revision).toBe("synthetic.settings.v1");
  });

  it("keeps an unobserved effective model null instead of inferring it", () => {
    const catalog = catalogNamed("editable");
    const plan = resolveInferenceProfile(
      catalog, selectionOf(catalog, "planner.synthetic.v1"), "adaptive_region");
    expect(plan.ok).toBe(true);
    expect(plan.requested_model).toBe("synthetic.model.v1");
    expect(plan.resolved_model).toBeNull();
  });

  it("treats an empty context_compatibility list as unconstrained", () => {
    const catalog = catalogNamed("synthetic");
    const plan = resolveInferenceProfile(
      catalog, selectionOf(catalog, "planner.synthetic.v1"), "adaptive_region", "context.anything.v9");
    expect(plan.ok).toBe(true);
  });
});

describe("refusals — each reason is distinguished and leaks no usable identity", () => {
  // Each row is a re-sealed descriptor whose only difference is the
  // property under test, so a passing row cannot be passing by accident.
  const cases: Array<[string, string, InferenceProfileRejection]> = [
    ["revoked.synthetic.v1", "context.synthetic.v1", "revoked"],
    ["disabled.synthetic.v1", "context.synthetic.v1", "disabled"],
    ["stale.synthetic.v1", "context.synthetic.v1", "stale"],
    ["unsupported.synthetic.v1", "context.synthetic.v1", "unsupported"],
    ["denied.synthetic.v1", "context.synthetic.v1", "selection_not_granted"],
    ["otherctx.synthetic.v1", "context.synthetic.v1", "context_incompatible"],
  ];

  it.each(cases)("refuses %s as %s", (profileId, contextRef, expected) => {
    const catalog = catalogNamed("negative");
    const result = resolveInferenceProfile(
      catalog, selectionOf(catalog, profileId), "decide", contextRef);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe(expected);
    // A refusal must not hand the caller anything it could bind.
    expect(result.selection).toBeUndefined();
    expect(result.adapter).toBeUndefined();
    expect(result.operations).toBeUndefined();
    expect(result.requested_model).toBeUndefined();
  });

  it("refuses a profile id the catalog never advertised", () => {
    const catalog = catalogNamed("synthetic");
    const result = resolveInferenceProfile(
      catalog,
      { profile_id: "absent.synthetic.v1", version: "1.0.0", digest: "a".repeat(64) },
      "decide",
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("unknown_profile");
  });

  it("refuses a pinned digest that does not match the served revision", () => {
    const catalog = catalogNamed("synthetic");
    const pinned = selectionOf(catalog, "decision.synthetic.v1");
    const result = resolveInferenceProfile(
      catalog, { ...pinned, digest: "b".repeat(64) }, "decide", "context.synthetic.v1");
    expect(result.ok).toBe(false);
    // A digest mismatch is its own reason: the caller pinned a revision the
    // owner no longer serves, and must re-pin rather than silently re-resolve.
    expect(result.rejection).toBe("digest_mismatch");
  });

  it("refuses a node kind the profile does not serve", () => {
    const catalog = catalogNamed("synthetic");
    const result = resolveInferenceProfile(
      catalog, selectionOf(catalog, "decision.synthetic.v1"), "adaptive_region");
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("unsupported_node_kind");
  });

  it("reports a rejected catalog as untrusted rather than as an unknown profile", () => {
    const broken = { ...catalogNamed("synthetic"), catalog_digest: "c".repeat(64) };
    const result = resolveInferenceProfile(
      broken as InferenceProfileCatalog,
      selectionOf(catalogNamed("synthetic"), "decision.synthetic.v1"),
      "decide",
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("catalog_untrusted");
  });

  it("orders the state check before the node-kind check, as the owner's resolve does", () => {
    // A revoked profile asked for the WRONG node kind must still be reported as
    // revoked. Were the node-kind check to run first, this row would report
    // unsupported_node_kind and the ordering claim would be false.
    const catalog = catalogNamed("negative");
    const result = resolveInferenceProfile(
      catalog, selectionOf(catalog, "revoked.synthetic.v1"), "adaptive_region");
    expect(result.rejection).toBe("revoked");
  });

  it("checks the select grant before context compatibility, as the owner does", () => {
    // denied.synthetic.v1 is granted no selection AND accepts only
    // context.synthetic.v1. Resolving it against a different context must still
    // report the grant refusal, which is the earlier gate.
    const catalog = catalogNamed("negative");
    const result = resolveInferenceProfile(
      catalog, selectionOf(catalog, "denied.synthetic.v1"), "decide", "context.not.mine.v1");
    expect(result.rejection).toBe("selection_not_granted");
  });
});

describe("pin stability — a new revision cannot silently alter an existing binding", () => {
  it("keeps resolving the pinned digest while the owner serves that descriptor", () => {
    const catalog = catalogNamed("synthetic");
    const pinned = selectionOf(catalog, "decision.synthetic.v1");
    const result = resolveInferenceProfile(catalog, pinned, "decide", "context.synthetic.v1");
    expect(result.ok).toBe(true);
    expect(result.selection?.digest).toBe(pinned.digest);
  });

  it("will not accept a newer version under the older pinned identity", () => {
    const catalog = catalogNamed("synthetic");
    const pinned = selectionOf(catalog, "decision.synthetic.v1");
    const result = resolveInferenceProfile(
      catalog, { ...pinned, version: "2.0.0" }, "decide", "context.synthetic.v1");
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("unknown_profile");
  });

  it("treats a re-sealed catalog under a changed digest as a different identity", () => {
    // Same profile id and version, different digest: the owner moved the
    // revision underneath the caller, so the old pin must stop resolving. The
    // catalog is RESEALED, hence internally consistent and individually
    // admissible; only the pin is stale. Without the reseal this row would be
    // refused for an unrelated malformed-catalog reason.
    const original = catalogNamed("synthetic");
    const moved = catalogFixture("synthetic");
    moved.descriptors[0].resolved_model = "synthetic.model.v1.moved";
    const resealed = reseal(moved);
    expect(InferenceProfileCatalogSchema.safeParse(resealed).success).toBe(true);
    expect(resealed.catalog_digest).not.toBe(original.catalog_digest);
    const pinned = selectionOf(original, "decision.synthetic.v1");
    expect(resolveInferenceProfile(resealed, pinned, "decide", "context.synthetic.v1").rejection)
      .toBe("digest_mismatch");
  });

  it("still admits the re-sealed catalog under its own new pin", () => {
    const moved = catalogFixture("synthetic");
    moved.descriptors[0].resolved_model = "synthetic.model.v1.moved";
    const resealed = reseal(moved);
    const pinned = selectionOf(resealed, "decision.synthetic.v1");
    const result = resolveInferenceProfile(resealed, pinned, "decide", "context.synthetic.v1");
    expect(result.ok).toBe(true);
    expect(result.resolved_model).toBe("synthetic.model.v1.moved");
  });
});

describe("grants and credential hygiene", () => {
  it("separates the select grant from the edit grant", () => {
    const catalog = catalogNamed("editable");
    const decide = catalog.descriptors.find((d) => d.profile_id === "decision.synthetic.v1");
    const planner = catalog.descriptors.find((d) => d.profile_id === "planner.synthetic.v1");
    expect(decide?.grants).toEqual({ select: true, edit: true });
    // Selectable but NOT editable: this browser may bind it, never rewrite it.
    expect(planner?.grants).toEqual({ select: true, edit: false });
    expect(resolveInferenceProfile(
      catalog, selectionOf(catalog, "planner.synthetic.v1"), "adaptive_region").ok).toBe(true);
  });

  it("publishes no credential, endpoint, executable or prompt bytes", () => {
    for (const name of ["synthetic", "editable", "negative"]) {
      expect(findCredentialBearingProfileFields(catalogNamed(name))).toEqual([]);
    }
  });

  it("POSITIVE CONTROL: the credential scanner actually detects a planted field", () => {
    // Without this row the scanner could be broken — for example always
    // returning [] — and every negative assertion above would still pass. This
    // is what makes that absence meaningful.
    const planted = catalogFixture("synthetic");
    (planted.descriptors[0] as unknown as Record<string, unknown>).api_key = "sk-not-a-real-key";
    expect(findCredentialBearingProfileFields(planted)).toEqual(["descriptors[0].api_key"]);
  });

  it("rejects an unknown field outright rather than ignoring it", () => {
    const polluted = {
      ...catalogNamed("synthetic"),
      extra_authority: "sneaky",
    } as unknown as InferenceProfileCatalog;
    expect(InferenceProfileCatalogSchema.safeParse(polluted).success).toBe(false);
  });

  it("splits selectable from non-selectable without hiding refusable rows", () => {
    const catalog = catalogNamed("negative");
    const { selectable, uneditable } = inferenceProfilesForNodeKind(catalog, "decide");
    // otherctx.synthetic.v1 is available AND granted selection: it is bindable
    // in general and is refused only for the WRONG context. The filter is by
    // node kind, not by context, so it correctly stays selectable.
    expect(selectable.map((d) => d.profile_id)).toEqual(["otherctx.synthetic.v1"]);
    // The remaining refusable rows stay visible so a designer can explain a
    // stopped binding instead of watching it vanish from the list.
    expect(uneditable.map((d) => d.profile_id).sort()).toEqual([
      "denied.synthetic.v1",
      "disabled.synthetic.v1",
      "revoked.synthetic.v1",
      "stale.synthetic.v1",
      "unsupported.synthetic.v1",
    ]);
  });

  it("does not offer a context-incompatible profile as bindable for that context", () => {
    // The node-kind filter above cannot know the context, so the context check
    // has to be enforced by the resolver. Assert both halves so neither is
    // assumed: listed as selectable for the node kind, yet refused for a
    // context it does not accept.
    const catalog = catalogNamed("negative");
    const selectable = inferenceProfilesForNodeKind(catalog, "decide").selectable
      .map((d) => d.profile_id);
    expect(selectable).toContain("otherctx.synthetic.v1");
    const result = resolveInferenceProfile(
      catalog, selectionOf(catalog, "otherctx.synthetic.v1"), "decide", "context.synthetic.v1");
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("context_incompatible");
  });

  it("offers only available, selectable rows for a node kind", () => {
    const { selectable } = inferenceProfilesForNodeKind(catalogNamed("synthetic"), "decide");
    expect(selectable.map((d: InferenceProfileDescriptor) => d.profile_id))
      .toEqual(["decision.synthetic.v1"]);
    expect(inferenceProfilesForNodeKind(catalogNamed("synthetic"), "reward").selectable)
      .toHaveLength(0);
  });

  it("returns nothing at all for a catalog that fails admission", () => {
    const broken = { ...catalogNamed("synthetic"), catalog_digest: "d".repeat(64) };
    expect(inferenceProfilesForNodeKind(broken as InferenceProfileCatalog, "decide"))
      .toEqual({ selectable: [], uneditable: [] });
  });
});

describe("synthetic provenance", () => {
  it("uses only synthetic identities, and contacts no provider", () => {
    for (const name of ["synthetic", "editable", "negative"]) {
      const ids = catalogNamed(name).descriptors.flatMap((d) => [d.adapter, d.requested_model]);
      expect(ids.every((id) => id.startsWith("synthetic."))).toBe(true);
    }
  });

  it("carries no tool authority beyond the published operations list", () => {
    const planner = catalogNamed("synthetic").descriptors
      .find((d) => d.profile_id === "planner.synthetic.v1");
    expect(planner?.operations).toEqual(["adaptive_region"]);
    // Authority stays with the owner; a planner cannot widen its own tool set.
    expect(Object.keys(planner ?? {})).not.toContain("allowed_operations");
  });
});
