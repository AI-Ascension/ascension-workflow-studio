import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@studio/contracts";

import {
  History,
  alignLayout,
  autoLayout,
  canonicalJson,
  copyNodes,
  createLayout,
  diffDocuments,
  layoutOnlyChange,
  layoutIsValid,
  mergeDocuments,
  parseBoundedJson,
  parseDefinitionImport,
  parseStudioBundle,
  pasteNodes,
  reconnectEdge,
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

  it("refuses secret-like fields in portable bundles", async () => {
    const document = definition();
    document.graphs[0].nodes[0].config = { apiKey: "never-export" };
    const digest = await semanticDigest(document);
    await expect(serializeStudioBundle({ semantic: document, layout: createLayout(document, digest) })).rejects.toThrow("secret-like");
  });

  it("rejects duplicate keys, unsafe numbers, and future schemas before editing", () => {
    expect(() => parseBoundedJson('{"x":1,"x":2}')).toThrow("duplicate key");
    expect(() => parseBoundedJson("9007199254740993")).toThrow("safe range");
    parseBoundedJson('{"__proto__":{"polluted":true}}');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    const original = '{\n  "graphs": [],\n  "schema_version": "ascension.workflow/v2"\n}';
    const archival = parseDefinitionImport(original);
    expect(archival.kind).toBe("archival");
    if (archival.kind === "archival") {
      expect(archival.schemaVersion).toBe("ascension.workflow/v2");
      expect(archival.rawText).toBe(original);
    }
  });

  it("remaps copied node IDs and retains only internal edges", () => {
    const document = definition();
    document.graphs[0].nodes[0].config = { target: "done", external_ref: "owner.registry" };
    const clipboard = copyNodes(document, ["main:start", "main:done"]);
    const pasted = pasteNodes(document, "main", clipboard);
    expect(pasted.selectedIds).toEqual(["main:start_copy", "main:done_copy"]);
    expect(pasted.document.graphs[0].edges.at(-1)).toMatchObject({ from: "start_copy", to: "done_copy" });
    expect(pasted.document.graphs[0].nodes.find((node) => node.id === "start_copy")?.config).toEqual({ target: "done_copy", external_ref: "owner.registry" });
  });

  it("bounds clipboard snapshots and history entries", () => {
    const largeSelection = definition();
    largeSelection.graphs[0].entry_node = "node_0";
    largeSelection.graphs[0].nodes = Array.from({ length: 129 }, (_, index) => ({ id: `node_${index}`, kind: "observe" as const, config: { projection_ref: "test" } }));
    largeSelection.graphs[0].edges = [];
    expect(() => copyNodes(largeSelection, largeSelection.graphs[0].nodes.map((node) => `main:${node.id}`))).toThrow("128-node clipboard bound");

    const oversized = definition();
    oversized.graphs[0].nodes[0].config = { projection_ref: "x".repeat(256 * 1024) };
    expect(() => copyNodes(oversized, ["main:start"])).toThrow("256 KiB");

    const history = new History(0, (value) => value, 2);
    history.commit(1);
    history.commit(2);
    history.commit(3);
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(1);
    expect(() => new History(0, (value) => value, 0)).toThrow("positive safe integer");
  });

  it("supports guarded reconnection, alignment, and non-overlapping three-way merge", async () => {
    const original = definition();
    const reconnected = reconnectEdge(original, "main", 0, "done", "start");
    expect(reconnected.graphs[0].edges[0]).toMatchObject({ from: "done", to: "start" });
    const digest = await semanticDigest(original);
    const aligned = alignLayout(createLayout(original, digest), ["main:start", "main:done"], "x");
    expect(aligned.positions["main:start"].x).toBe(aligned.positions["main:done"].x);
    const arranged = autoLayout(createLayout(original, digest), original);
    expect(arranged.positions["main:done"].x).toBeGreaterThan(arranged.positions["main:start"].x);
    expect(layoutIsValid(original, arranged)).toBe(true);
    const local = { ...original, version: "1.1.0" };
    const remote = { ...original, game_profile: "remote-profile" };
    const merged = mergeDocuments(original, local, remote);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.document?.version).toBe("1.1.0");
    expect(merged.document?.game_profile).toBe("remote-profile");
    const conflict = mergeDocuments(original, { ...original, version: "1.1.0" }, { ...original, version: "1.2.0" });
    expect(conflict.conflicts.map((item) => item.path)).toContain("$.version");
  });
});
