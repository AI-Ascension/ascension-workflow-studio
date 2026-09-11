import { describe, expect, it } from "vitest";

import type { DefinitionRecord, JsonObject } from "@studio/contracts";

import { resolveSubworkflowReference } from "./reference";

function record(workflowId: string, version: string, digest?: string): DefinitionRecord {
  return {
    id: workflowId,
    title: workflowId,
    description: "test",
    source: "catalog",
    updatedAt: "now",
    definition: { workflow_id: workflowId, version } as unknown as DefinitionRecord["definition"],
    capabilities: [],
    definitionDigest: digest,
  };
}

function config(id: string, version: string, digest = ""): JsonObject {
  return { artifact_ref: { id, version, digest } };
}

describe("pinned subworkflow reference resolution", () => {
  it("resolves an exact id, version and digest match", () => {
    const catalog = [record("sts2.reward", "2.1.0", "abc")];
    const result = resolveSubworkflowReference(catalog, config("sts2.reward", "2.1.0", "abc"));
    expect(result.status).toBe("resolved");
    expect(result.digestVerified).toBe(true);
    expect(result.record?.id).toBe("sts2.reward");
  });

  it("surfaces a missing reference explicitly instead of substituting", () => {
    const result = resolveSubworkflowReference([], config("sts2.missing", "1.0.0"));
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("not present");
  });

  it("refuses a floating latest instead of choosing a different version", () => {
    const catalog = [record("sts2.reward", "2.1.0", "abc")];
    const result = resolveSubworkflowReference(catalog, config("sts2.reward", "9.9.9"));
    expect(result.status).toBe("version-mismatch");
    expect(result.message).toContain("No floating latest is used");
    expect(result.record?.definition.version).toBe("2.1.0");
  });

  it("fails closed on a digest mismatch", () => {
    const catalog = [record("sts2.reward", "2.1.0", "abc")];
    const result = resolveSubworkflowReference(catalog, config("sts2.reward", "2.1.0", "different"));
    expect(result.status).toBe("digest-mismatch");
    expect(result.digestVerified).toBe(false);
  });

  it("resolves by id and version when the catalog publishes no digest", () => {
    const catalog = [record("sts2.reward", "2.1.0")];
    const result = resolveSubworkflowReference(catalog, config("sts2.reward", "2.1.0", "abc"));
    expect(result.status).toBe("resolved");
    expect(result.digestVerified).toBe(false);
    expect(result.message).toContain("does not publish a digest");
  });
});
