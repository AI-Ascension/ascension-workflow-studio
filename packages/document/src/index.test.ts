import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@studio/contracts";

import {
  History,
  canonicalJson,
  createLayout,
  diffDocuments,
  layoutOnlyChange,
  layoutIsValid,
  parseStudioBundle,
  serializeStudioBundle,
  semanticDigest,
} from "./index";

function definition(): WorkflowDefinition {
  return {
    schema_version: "ascension.workflow/v1",
    workflow_id: "test.workflow",
    version: "1.0.0",
    mode: "strict",
    game_profile: "test",
    policy_ref: "test.policy",
    capabilities: { required: [], optional: [] },
    limits: { max_steps: 4, max_subworkflow_depth: 1, max_provider_calls: 2, max_parallel_analyses: 1, max_output_tokens: 128 },
    entry_graph: "main",
    graphs: [{
      id: "main",
      entry_node: "start",
      nodes: [
        { id: "start", kind: "observe", config: { projection_ref: "test" } },
        { id: "done", kind: "terminal", config: { outcome: "completed" } },
      ],
      edges: [{ from: "start", to: "done", on: "ok", priority: 0 }],
    }],
    annotations: { editorOnly: "ignored by semantic identity" },
  };
}

describe("workflow document identity", () => {
  it("sorts object keys and excludes annotations from semantic JSON", () => {
    const document = definition();
    const reordered = { ...document, annotations: { another: true } };
    expect(canonicalJson(document)).toBe(canonicalJson(reordered));
    expect(layoutOnlyChange(document, reordered)).toBe(true);
  });

  it("produces a stable SHA-256 semantic digest", async () => {
    const first = await semanticDigest(definition());
    const second = await semanticDigest(definition());
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });

  it("binds a layout sidecar to the semantic node set", async () => {
    const document = definition();
    const layout = createLayout(document, await semanticDigest(document));
    expect(layoutIsValid(document, layout)).toBe(true);
    expect(Object.keys(layout.positions)).toEqual(["main:start", "main:done"]);
  });

  it("reports changed paths and preserves undo/redo history", () => {
    const original = definition();
    const changed = { ...original, version: "1.1.0" };
    expect(diffDocuments(original, changed).map((change) => change.path)).toContain("$.version");
    const history = new History(original, (value) => JSON.parse(JSON.stringify(value)) as WorkflowDefinition);
    history.commit(changed);
    expect(history.present().version).toBe("1.1.0");
    expect(history.undo().version).toBe("1.0.0");
    expect(history.redo().version).toBe("1.1.0");
  });

  it("round-trips a digest-bound Studio bundle and rejects tampering", async () => {
    const document = definition();
    const digest = await semanticDigest(document);
    const bundle = { semantic: document, layout: createLayout(document, digest) };
    const raw = await serializeStudioBundle(bundle);
    const parsed = await parseStudioBundle(raw);
    expect(parsed.semantic.workflow_id).toBe(document.workflow_id);
    await expect(parseStudioBundle(raw.replace('"test.workflow"', '"tampered.workflow"'))).rejects.toThrow("digest");
  });
});
