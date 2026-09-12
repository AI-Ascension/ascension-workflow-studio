import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { mapProjectionSupport, pinnedMapIdentity, VisibleMapProjectionSchema } from "./mapProjection";

const goldenPath = resolve(process.cwd(), "contracts/accepted/phase1/map/visible-map.golden.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as unknown;
const projection = VisibleMapProjectionSchema.parse(golden);

describe("visible map projection", () => {
  it("matches the pinned source artifact digest", () => {
    expect(createHash("sha256").update(readFileSync(goldenPath)).digest("hex")).toBe("bbb959f20a5293032072ee9ab30c9489807ad185cec7d740f15dd929a9bfa622");
  });

  it("parses the admitted projection and pins its identity", () => {
    expect(pinnedMapIdentity(projection)).toEqual({
      schemaVersion: "visible-map-v1", projectionVersion: "runtime-map-v1", generation: 42,
      mapInstanceId: "map-instance-1", actId: 1, scopeId: "campaign-1", stateId: "map-state-42",
    });
    expect(projection.nodes).toHaveLength(4);
    expect(projection.edges).toHaveLength(4);
  });

  it("reports current projections as available", () => {
    expect(mapProjectionSupport(projection).state).toBe("available");
  });

  it("reports historical projections as stale with the reason", () => {
    const stale = VisibleMapProjectionSchema.parse({ ...projection, freshness: "historical", reason: "captured earlier" });
    const support = mapProjectionSupport(stale);
    expect(support.state).toBe("stale");
    expect(support.message).toBe("captured earlier");
  });

  it("reports unavailable projections explicitly", () => {
    const unavailable = VisibleMapProjectionSchema.parse({ ...projection, availability: "not_observable", reason: "map not visible" });
    const support = mapProjectionSupport(unavailable);
    expect(support.state).toBe("unavailable");
    expect(support.availability).toBe("not_observable");
  });

  it("rejects unbounded or malformed projections", () => {
    expect(VisibleMapProjectionSchema.safeParse({ ...projection, nodes: Array.from({ length: 257 }, (_, index) => ({ id: `n${index}`, row: 0, column: 0, category: "unknown", visited: false })) }).success).toBe(false);
    expect(VisibleMapProjectionSchema.safeParse({ ...projection, unexpected: true }).success).toBe(false);
  });
});
