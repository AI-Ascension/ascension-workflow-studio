import { describe, expect, it } from "vitest";
import { canonicalJsonComplete, sha256Hex } from "@studio/document";
import { OwnerApiClient } from "./index";
const target = {
  instance_id: "owner-a", execution_profiles: ["live.workflow.v1"],
  execution_mode: "live", compatibility_revision: "compat.v1",
  capability_revision: "caps.v1", availability: "available",
  supported_operations: ["workflow:live"], capabilities: ["workflow:context:read"],
  game_profiles: ["sts2-live-v1"], save_profiles: [], inference_profiles: ["exo.runtime-v3"],
};
const digest = "93283a6890aae5b87aa656e5df60ca7ca090114300caca6fb667d309275acfe3";
const v1 = { schema_version: "ascension.workflow-targets/v1", catalog_revision: "runtime-v3:profile-a", targets: [target] };
const v2 = {
  schema_version: "ascension.workflow-targets/v2", catalog_revision: v1.catalog_revision,
  support_revision: "seed-support.v1",
  targets: [{ target, descriptor_digest: digest, durable_candidate_binding_modes: ["explicit", "derive_once"],
    ready_candidate_modes: ["explicit"], supported_launch_setups: [] }],
};
function owner(next: unknown, calls: string[]) {
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)} ${new Headers(init?.headers).get("authorization")}`);
    return new Response(JSON.stringify(String(input).startsWith("/v1/") ? v1 : next));
  };
  return new OwnerApiClient({ baseUrl: "/v1", token: "fixture", actorScope: "owner-a", fetcher });
}
describe("owner-authenticated seed-support v2 discovery", () => {
  it("reconciles the exact Rust fixture digest with read-only authenticated V1 and V2", async () => {
    expect(await sha256Hex(canonicalJsonComplete(target))).toBe(digest);
    const calls: string[] = [];
    const result = await owner(v2, calls).listSeedTargetSupportV2();
    expect(result.targets[0].supported_launch_setups).toEqual([]);
    expect(calls).toEqual(["GET /v1/workflow-targets Bearer fixture", "GET /v2/workflow-targets Bearer fixture"]);
  });
  it("rejects mismatched revisions, descriptors and invalid launch advertisement", async () => {
    await expect(owner({ ...v2, catalog_revision: "changed" }, []).listSeedTargetSupportV2()).rejects.toThrow();
    await expect(owner({ ...v2, targets: [{ ...v2.targets[0], descriptor_digest: "a".repeat(64) }] }, []).listSeedTargetSupportV2()).rejects.toThrow();
    await expect(owner({ ...v2, targets: [{ ...v2.targets[0], target: { ...target, availability: "unavailable" } }] }, []).listSeedTargetSupportV2()).rejects.toThrow();
    await expect(owner({ ...v2, targets: [{ ...v2.targets[0], supported_launch_setups: ["standard"] }] }, []).listSeedTargetSupportV2()).rejects.toThrow();
  });
  it("rejects concurrent authentication changes during V2 discovery", async () => {
    let client: OwnerApiClient;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).startsWith("/v2/")) client.setToken("rotated");
      return new Response(JSON.stringify(String(input).startsWith("/v1/") ? v1 : v2));
    };
    client = new OwnerApiClient({ baseUrl: "/v1", token: "original", actorScope: "owner-a", fetcher });
    await expect(client.listSeedTargetSupportV2()).rejects.toThrow("session changed");
  });
});
