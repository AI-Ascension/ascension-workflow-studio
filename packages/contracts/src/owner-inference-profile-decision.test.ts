import { describe, expect, it } from "vitest";

import { ValidateResponseSchema, StudioOwnerPublishResponseSchema } from "./index";
import {
  OwnerInferenceProfileDecisionSchema,
  ResolvedInferenceProfileRefSchema,
  ownerInferenceProfileDecision,
  ownerResolvedPinForNode,
  ownerUnresolvedProfileReferences,
} from "./owner-inference-profile-decision";
import { identifier, parseInferenceProfilePin } from "./inference-profile-catalog";

/** These assertions are CONTRACT ARITHMETIC on shapes the owner's own code
 * produces (`sts2-harness` at `a7b47ac1`,
 * `crates/harness/src/management/contract_inference_profiles.rs:16`). They ran
 * no producer code, contacted no provider, model, native host or game, and
 * prove nothing about provider execution. The identities below are synthetic
 * and are not claimed to be any real profile. */
const DIGEST = "a".repeat(64);

/** One entry exactly as the producer builds it: `exact_pin()` is
 * `format!("{}:{}:{}", profile_id, version, digest)`. */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    graph_id: "campaign",
    node_id: "decide-now",
    node_kind: "decide",
    profile_ref: "sts2.campaign.decision.v1",
    resolved_pin: `sts2.campaign.decision.v1:1.0.0:${DIGEST}`,
    path: "$.graphs[0].nodes[0].config.decision_profile_ref",
    ...overrides,
  };
}

function validateResponse(inferenceProfiles: unknown, present = true) {
  const base: Record<string, unknown> = {
    schema_version: "ascension.management/v1",
    valid: true,
    definition_digest: "b".repeat(64),
    diagnostics: [],
  };
  if (present) base.inference_profiles = inferenceProfiles;
  return base;
}

describe("owner published inference-profile decision (harness #799)", () => {
  it("decodes a response with the decision populated", () => {
    const decoded = ValidateResponseSchema.parse(validateResponse([entry()]));
    expect(decoded.inference_profiles).toHaveLength(1);
    expect(decoded.inference_profiles?.[0]?.profile_ref).toBe("sts2.campaign.decision.v1");
    expect(decoded.inference_profiles?.[0]?.resolved_pin).toBe(
      `sts2.campaign.decision.v1:1.0.0:${DIGEST}`,
    );
    expect(decoded.inference_profiles?.[0]?.path).toBe(
      "$.graphs[0].nodes[0].config.decision_profile_ref",
    );
  });

  it("decodes the same field on the publication surface", () => {
    const decoded = StudioOwnerPublishResponseSchema.parse({
      schema_version: "ascension.studio-authoring/v1",
      outcome: "published",
      definition: null,
      draft: null,
      inference_profiles: [entry()],
    });
    expect(decoded.inference_profiles?.[0]?.resolved_pin).toContain(`:${DIGEST}`);
  });

  it("decodes a response from an owner that PREDATES the field", () => {
    const decoded = ValidateResponseSchema.parse(validateResponse(undefined, false));
    expect(decoded.inference_profiles).toBeUndefined();
    expect(decoded.valid).toBe(true);
  });

  it("decodes null as 'owner serves no catalog'", () => {
    const decoded = ValidateResponseSchema.parse(validateResponse(null));
    expect(decoded.inference_profiles).toBeNull();
  });

  it("decodes [] as 'catalog served, nothing referenced'", () => {
    const decoded = ValidateResponseSchema.parse(validateResponse([]));
    expect(decoded.inference_profiles).toEqual([]);
  });

  it("keeps null, absent and [] as THREE distinct facts", () => {
    expect(ownerInferenceProfileDecision(undefined).kind).toBe("not_published");
    expect(ownerInferenceProfileDecision(null).kind).toBe("profile_catalog_unavailable");
    expect(ownerInferenceProfileDecision([]).kind).toBe("no_references");
    expect(ownerInferenceProfileDecision([entry()]).kind).toBe("resolved");
  });

  it("REFUSES a resolved_pin missing its digest", () => {
    expect(
      OwnerInferenceProfileDecisionSchema.safeParse([
        entry({ resolved_pin: "sts2.campaign.decision.v1:1.0.0" }),
      ]).success,
    ).toBe(false);
  });

  it("REFUSES a non-hex digest", () => {
    expect(
      OwnerInferenceProfileDecisionSchema.safeParse([
        entry({ resolved_pin: `sts2.campaign.decision.v1:1.0.0:${"z".repeat(64)}` }),
      ]).success,
    ).toBe(false);
    expect(
      OwnerInferenceProfileDecisionSchema.safeParse([
        entry({ resolved_pin: `sts2.campaign.decision.v1:1.0.0:${"A".repeat(64)}` }),
      ]).success,
    ).toBe(false);
  });

  it("REFUSES a non-semver version", () => {
    expect(
      OwnerInferenceProfileDecisionSchema.safeParse([
        entry({ resolved_pin: `sts2.campaign.decision.v1:1.0:${DIGEST}` }),
      ]).success,
    ).toBe(false);
    expect(
      OwnerInferenceProfileDecisionSchema.safeParse([
        entry({ resolved_pin: `sts2.campaign.decision.v1:v1.0.0:${DIGEST}` }),
      ]).success,
    ).toBe(false);
  });

  it("ACCEPTS a profile_id containing a colon, as rsplitn(3, ':') keeps it", () => {
    const parsed = OwnerInferenceProfileDecisionSchema.safeParse([
      entry({
        profile_ref: "sts2:campaign:decision.v1",
        resolved_pin: `sts2:campaign:decision.v1:1.0.0:${DIGEST}`,
      }),
    ]);
    expect(parsed.success).toBe(true);
  });

  it("REFUSES unknown extra keys inside an entry", () => {
    expect(
      ResolvedInferenceProfileRefSchema.safeParse({ ...entry(), admission: "granted" }).success,
    ).toBe(false);
  });

  it("REFUSES an over-long array", () => {
    const oversized = Array.from({ length: 4097 }, () => entry());
    expect(OwnerInferenceProfileDecisionSchema.safeParse(oversized).success).toBe(false);
  });

  it("presents the owner's pin WITHOUT upgrading the authored floating ref", () => {
    const decision = [entry()];
    const found = ownerResolvedPinForNode(decision, "campaign", "decide-now");
    expect(found?.resolved_pin).toBe(`sts2.campaign.decision.v1:1.0.0:${DIGEST}`);
    // The authored reference is reported EXACTLY as the owner published it; a
    // floating id stays floating in the document and is never rewritten.
    expect(found?.profile_ref).toBe("sts2.campaign.decision.v1");
    expect(found?.profile_ref).not.toBe(found?.resolved_pin);
  });

  it("returns undefined for a node the owner published nothing for", () => {
    expect(ownerResolvedPinForNode([entry()], "campaign", "some-other-node")).toBeUndefined();
    expect(ownerResolvedPinForNode(null, "campaign", "decide-now")).toBeUndefined();
  });

  it("reports a referenced node the owner published nothing for", () => {
    const gap = ownerUnresolvedProfileReferences(
      [entry()],
      [
        { graphId: "campaign", nodeId: "decide-now" },
        { graphId: "campaign", nodeId: "unadmitted" },
      ],
    );
    expect(gap).toEqual([{ graphId: "campaign", nodeId: "unadmitted" }]);
  });

  it("invents no gap only when the owner published no decision at all", () => {
    const referenced = [{ graphId: "campaign", nodeId: "decide-now" }];
    // ABSENT and NULL are "the owner published nothing", which is not a
    // per-node omission. These are the ONLY two cases with no gap.
    expect(ownerUnresolvedProfileReferences(undefined, referenced)).toBeUndefined();
    expect(ownerUnresolvedProfileReferences(null, referenced)).toBeUndefined();
    // An EMPTY LIST is a different fact: the owner served a catalog and
    // published zero resolutions, so a referenced node it said nothing about
    // IS a real owner/document disagreement and is reported as one.
    expect(ownerUnresolvedProfileReferences([], referenced))
      .toEqual([{ graphId: "campaign", nodeId: "decide-now" }]);
    expect(ownerUnresolvedProfileReferences([], [])).toBeUndefined();
  });

  it("bounds resolved_pin the way it bounds every sibling field", () => {
    // `semver` in the shared pin codec has NO length bound, so without a byte
    // ceiling on the whole pin a single entry could carry a multi-megabyte
    // version run into the browser. A conforming owner's worst case is a
    // 128-byte id, two colons, a 64-byte digest and a short version.
    expect(ResolvedInferenceProfileRefSchema.safeParse(entry({
      resolved_pin: `sts2.campaign.decision.v1:1.0.0:${DIGEST}`,
    })).success).toBe(true);
    expect(ResolvedInferenceProfileRefSchema.safeParse(entry({
      resolved_pin: `sts2.campaign.decision.v1:${"9".repeat(400)}.0.0:${DIGEST}`,
    })).success).toBe(false);
    // The head alone is still held to the producer's own 128-byte gate.
    expect(ResolvedInferenceProfileRefSchema.safeParse(entry({
      resolved_pin: `${"a".repeat(129)}:1.0.0:${DIGEST}`,
    })).success).toBe(false);
  });

  it("decodes identifier fields through the catalog's shared producer gate", () => {
    // `graph_id`, `node_id`, `node_kind` and `profile_ref` reuse the SAME
    // schema instance the inference-profile catalog uses, so the two copies of
    // the producer gate cannot drift apart on any value.
    expect(identifier.safeParse("campaign.iteration").success).toBe(true);
    expect(identifier.safeParse("campaign.iteration:sub").success).toBe(true);
    expect(ResolvedInferenceProfileRefSchema.safeParse(entry({ graph_id: "campaign.iteration" })).success).toBe(true);
    expect(ResolvedInferenceProfileRefSchema.safeParse(entry({ graph_id: "$bad" })).success).toBe(false);
    expect(ResolvedInferenceProfileRefSchema.safeParse(entry({ graph_id: "a".repeat(129) })).success).toBe(false);
  });

  it("keeps a profile_id that itself contains a colon", () => {
    // The producer splits from the RIGHT with `rsplitn(3, ':')`, so every colon
    // in the head belongs to `profile_id`. A left-to-right split would read a
    // different identity here, which is exactly the drift the shared
    // `parseInferenceProfilePin` codec exists to prevent.
    const pin = `studio:campaign.decision.v1:2.1.3:${DIGEST}`;
    const parsed = ResolvedInferenceProfileRefSchema.safeParse(entry({
      profile_ref: pin,
      resolved_pin: pin,
    }));
    expect(parsed.success).toBe(true);
    expect(parseInferenceProfilePin(pin)).toEqual({
      profile_id: "studio:campaign.decision.v1",
      version: "2.1.3",
      digest: DIGEST,
    });
  });

  /** `path` is a JSON path, not an owner identifier: it carries `$`, `[` and
   * `]`, none of which `validate_identifier` permits. Holding it to the
   * identifier gate would reject every well-formed owner response, which is
   * the precise failure this lane exists to repair. */
  it("accepts the producer's bracketed JSON path and bounds its length", () => {
    expect(ResolvedInferenceProfileRefSchema.safeParse(
      entry({ path: "$.graphs[12].nodes[1023].config.planner_profile_ref" }),
    ).success).toBe(true);
    expect(ResolvedInferenceProfileRefSchema.safeParse(entry({ path: "" })).success).toBe(false);
    expect(ResolvedInferenceProfileRefSchema.safeParse(
      entry({ path: `$."${"p".repeat(300)}"` }),
    ).success).toBe(false);
  });

  it("REFUSES identifiers the owner's own gate would refuse", () => {
    for (const bad of ["", "-leading-dash", "has space", "x".repeat(129)]) {
      expect(ResolvedInferenceProfileRefSchema.safeParse(entry({ graph_id: bad })).success).toBe(false);
    }
  });

  /** 1024 is the producer's own `MAX_TOTAL_NODES`, and both owner surfaces
   * hard-fail a definition that exceeds it before any list is built, so a
   * conforming owner cannot publish a longer list than this. The bound is
   * therefore exactly at the producer's ceiling, not an arbitrary round number. */
  it("admits a list exactly at the producer's node ceiling and refuses one above", () => {
    const atCeiling = Array.from({ length: 1024 }, () => entry());
    const aboveCeiling = Array.from({ length: 1025 }, () => entry());
    expect(OwnerInferenceProfileDecisionSchema.safeParse(atCeiling).success).toBe(true);
    expect(OwnerInferenceProfileDecisionSchema.safeParse(aboveCeiling).success).toBe(false);
  });

  it("REFUSES a malformed entry inside an otherwise well-formed list", () => {
    expect(OwnerInferenceProfileDecisionSchema.safeParse([
      entry(),
      entry({ resolved_pin: "sts2.campaign.decision.v1" }),
    ]).success).toBe(false);
  });

  it("REFUSES a wrong-typed field rather than ignoring it", () => {
    for (const wrong of [{}, "resolved", 3, [entry(), "nope"]]) {
      expect(OwnerInferenceProfileDecisionSchema.safeParse(wrong).success).toBe(false);
    }
  });
});
