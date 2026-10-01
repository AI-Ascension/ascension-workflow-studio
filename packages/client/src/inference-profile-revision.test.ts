import { describe, expect, it, vi } from "vitest";
import {
  InferenceProfileRevisionRequestSchema,
  type InferenceProfileDescriptor,
  type InferenceProfileRevisionRequest,
  type InferenceProfileRevisionResponse,
} from "@studio/contracts";
import { catalogFixture } from "../../contracts/src/inference-profile-catalog.test-fixtures";
import { ClientError, FixtureClient, OwnerApiClient, encodeProfileIdSegment } from "./index";

const SERVED = catalogFixture("editable");
const DESCRIPTOR = SERVED.descriptors[0];

const request: InferenceProfileRevisionRequest = {
  schema_version: "ascension.inference-profile-revision/v1" as const,
  expected_revision_digest: DESCRIPTOR.digest,
  client_mutation_id: "studio.revision.abc123",
  version: "1.1.0",
  prompt_revision: "synthetic.prompt.v2",
  settings_revision: "synthetic.settings.v2",
  supported_settings: ["max_output_tokens"],
  effective_budgets: {
    max_input_bytes: 131_072,
    max_output_tokens: 8192,
    max_provider_calls: 64,
  },
};

function responseBody(
  outcome: string,
  revision: InferenceProfileDescriptor = DESCRIPTOR,
  profileId = DESCRIPTOR.profile_id,
): unknown {
  return {
    schema_version: "ascension.inference-profile-revision-response/v1",
    outcome,
    profile_id: profileId,
    reference: `${profileId}:${revision.version}:${revision.digest}`,
    revision,
  };
}

describe("inference profile revision route and path segment", () => {
  /** The owner's `parse_target` refuses ANY request target containing `%`, and
   * never percent-decodes the path. `encodeURIComponent` would therefore turn a
   * legal colon into `%3A` and the owner would answer `invalid_path` — the edit
   * would be impossible for exactly the ids whose reference form makes them
   * meaningful. */
  it("sends a colon-bearing profile_id as literal characters, not percent-encoded", async () => {
    const paths: string[] = [];
    // A colon is legal in a `profile_id` under the producer's
    // `validate_identifier`, and it is load-bearing: the adopted reference is
    // `profile_id:version:digest`. This id is deliberately colon-bearing.
    const colonId = "decision.live:variant-a";
    const body = responseBody("adopted", DESCRIPTOR, colonId);
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input) => {
      paths.push(String(input));
      return new Response(JSON.stringify(body), {
        status: 200, headers: { "content-type": "application/json" },
      });
    } });
    // The response names the same profile the request targeted, so the
    // adoption succeeds and the assertion is about the PATH alone.
    const adoption = await client.adoptInferenceProfileRevision(colonId, {
      ...request,
      expected_revision_digest: "b".repeat(64),
    });
    expect(paths).toEqual([`/v1/inference-profiles/${colonId}/revisions`]);
    expect(paths[0]).toContain(":");
    expect(paths[0]).not.toContain("%");
    expect(adoption.adopted).toBe(true);
    expect(adoption.profile_id).toBe(colonId);
    expect(adoption.reference).toBe(`${colonId}:${DESCRIPTOR.version}:${DESCRIPTOR.digest}`);
  });

  it("round-trips every character the producer's identifier admits through one segment", () => {
    for (const id of [
      "a", "decision.synthetic.v1", "decision.live.v1", "a_b", "a-b",
      "profile:variant:1", "0leading-digit", "A.B_C-D:E",
    ]) {
      expect(encodeProfileIdSegment(id)).toBe(id);
      expect(encodeProfileIdSegment(id)).not.toContain("/");
      expect(encodeProfileIdSegment(id)).not.toContain("%");
    }
  });

  /** A `/` would escape the segment into a different route; `?` would open a
   * query the producer refuses (`request.query.is_empty()` is part of the
   * match arm); `#`, `\`, `..` and `%` are refused by `parse_target` itself. All
   * of them must be refused here so no request is ever sent. */
  it.each([
    "../etc", "a/b", "a?b", "a#b", "a\\b", "a%2Fb", ".leading", "-leading",
    "sp ace", "sp%20ace", "", "a\nb",
  ])("refuses %j before any request is sent", (id) => {
    expect(() => encodeProfileIdSegment(id)).toThrow(ClientError);
    expect(() => encodeProfileIdSegment(id)).toThrow(/path segment/);
  });

  it("never reaches the network for a rejected profile id", async () => {
    const fetcher = vi.fn();
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: fetcher as unknown as typeof fetch });
    await expect(client.adoptInferenceProfileRevision("a/b", request))
      .rejects.toThrow(/single admitted path segment/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts the exact closed body the producer deserializes", async () => {
    let sent: { path: string; body: unknown; method?: string } | undefined;
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      sent = { path: String(input), method: init?.method, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify(responseBody("adopted")), {
        status: 200, headers: { "content-type": "application/json" },
      });
    } });
    await client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, request);
    expect(sent?.method).toBe("POST");
    expect(sent?.path).toBe(`/v1/inference-profiles/${DESCRIPTOR.profile_id}/revisions`);
    expect(sent?.body).toEqual(request);
  });
});

describe("closed request is refused client-side, not merely ignored", () => {
  it.each([
    ["adapter", "some.adapter"],
    ["grants", { select: false, edit: true }],
    ["node_kinds", ["decide"]],
    ["operations", ["do.thing"]],
    ["api_key", "sk-not-a-real-key"],
    ["endpoint", "https://provider.invalid"],
  ])("refuses an unadvertised %s field without sending it", async (field, value) => {
    const fetcher = vi.fn();
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: fetcher as unknown as typeof fetch });
    await expect(client.adoptInferenceProfileRevision(
      DESCRIPTOR.profile_id,
      { ...request, [field]: value } as never,
    )).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses an out-of-bound budget locally", async () => {
    const fetcher = vi.fn();
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: fetcher as unknown as typeof fetch });
    await expect(client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, {
      ...request,
      effective_budgets: { ...request.effective_budgets, max_output_tokens: 2_000_001 },
    })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("outcomes are returned, not thrown", () => {
  it("returns a lost swap as conflicted without retrying it", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(responseBody("conflict")), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: fetcher as unknown as typeof fetch });
    const adoption = await client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, request);
    expect(adoption.outcome).toBe("conflict");
    expect(adoption.conflicted).toBe(true);
    expect(adoption.adopted).toBe(false);
    // Exactly one request: a lost swap is never retried automatically.
    expect(fetcher).toHaveBeenCalledTimes(1);
    // The winner is named, so an explicit re-author has something to aim at.
    expect(adoption.reference).toBe(`${DESCRIPTOR.profile_id}:${DESCRIPTOR.version}:${DESCRIPTOR.digest}`);
  });

  it("returns a replay of an already-applied mutation id as replayed, not adopted", async () => {
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () =>
      new Response(JSON.stringify(responseBody("replayed")), {
        status: 200, headers: { "content-type": "application/json" },
      }) });
    const first = await client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, request);
    // The producer keys the mutation record on (profile_id, client_mutation_id),
    // so a retried edit with the same identity replays rather than applying.
    const retried = await client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, request);
    expect(first.outcome).toBe("replayed");
    expect(retried.outcome).toBe("replayed");
    expect(retried.adopted).toBe(false);
    expect(retried.reference).toBe(first.reference);
  });

  it("reports the owner's refusal as a typed error rather than a silent success", async () => {
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () =>
      new Response(JSON.stringify({
        schema_version: "ascension.management/v1",
        error: {
          class: "forbidden",
          code: "inference_profile_edit_denied",
          message: "the owner does not publish this inference profile as editable",
        },
      }), { status: 403, headers: { "content-type": "application/json" } }) });
    await expect(client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, request))
      .rejects.toMatchObject({ code: "inference_profile_edit_denied", status: 403 });
  });

  it("refuses a response for a different profile than the one requested", async () => {
    // Internally CONSISTENT, but for the wrong profile: the reference agrees
    // with its own revision, so the schema admits it and the client's
    // profile check is what refuses it.
    const other = responseBody("adopted", DESCRIPTOR, "someone.else") as InferenceProfileRevisionResponse;
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () =>
      new Response(JSON.stringify(other), {
        status: 200, headers: { "content-type": "application/json" },
      }) });
    await expect(client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, request))
      .rejects.toThrow(/different inference profile/);
  });

  it("refuses a response whose embedded revision fails its own digest check", async () => {
    const tampered = { ...DESCRIPTOR, digest: "f".repeat(64) };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () =>
      new Response(JSON.stringify(responseBody("adopted", tampered)), {
        status: 200, headers: { "content-type": "application/json" },
      }) });
    await expect(client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, request))
      .rejects.toThrow(/failed runtime decoding/);
  });
});

describe("fixture client cannot fabricate an adoption", () => {
  it("refuses rather than inventing an adopted outcome", async () => {
    const client = new FixtureClient([]);
    await expect(client.adoptInferenceProfileRevision(DESCRIPTOR.profile_id, request))
      .rejects.toMatchObject({ code: "inference_profile_revision_unavailable" });
  });

  it("implements the same closed request contract as the live client", () => {
    expect(InferenceProfileRevisionRequestSchema.safeParse(request).success).toBe(true);
  });
});
