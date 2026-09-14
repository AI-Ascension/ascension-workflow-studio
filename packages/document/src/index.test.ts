import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition } from "@studio/contracts";

import {
  History,
  OWNER_EDGE_OUTCOMES,
  OWNER_NODE_KINDS,
  addEdge,
  alignLayout,
  autoLayout,
  canonicalJson,
  canonicalJsonComplete,
  copyNodes,
  compatibleNodeOutputs,
  convertNodeKind,
  defaultNodeConfig,
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
  definitionIdentityDigest,
  semanticDigest,
  sha256Hex,
  validateNodeBindings,
  updateEdge,
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
  it("covers every owner node kind with a shape-correct default and preserves compatible proposal ports", () => {
    const document = definition();
    document.graphs[0].nodes.splice(1, 0,
      { id: "decide", kind: "decide", config: { decision_profile_ref: "profile", context_ref: "context" } },
      { id: "emit", kind: "emit_artifact", config: { artifact_kind_ref: "artifact", input_from: { node_id: "start", output: "observation" } } },
    );
    expect(OWNER_NODE_KINDS).toHaveLength(13);
    expect(OWNER_EDGE_OUTCOMES).toEqual(["ok", "error", "timeout", "unavailable", "true", "false", "unknown"]);
    for (const kind of OWNER_NODE_KINDS) {
      const node = { id: `new_${kind}`, kind, config: defaultNodeConfig(kind, document.graphs[0]) };
      expect(node.config).toBeTypeOf("object");
      if (kind === "execute_action") expect(node.config.proposal_from).toEqual({ node_id: "decide", output: "proposal" });
      if (kind === "emit_artifact") expect(node.config.input_from).toMatchObject({ node_id: "start", output: "observation" });
    }
    expect(compatibleNodeOutputs(document, "main", "DecisionProposal")).toEqual([{ nodeId: "decide", output: "proposal", type: "DecisionProposal" }]);
  });

  it("resets incompatible fields only through explicit kind conversion and keeps it undoable by callers", () => {
    const original = { id: "node", kind: "observe", config: { projection_ref: "approved.state" } };
    const converted = convertNodeKind(original, "await_stability", definition().graphs[0]);
    expect(converted).toEqual({ id: "node", kind: "await_stability", config: { deadline_ms: 1000 } });
    expect(converted.config).not.toHaveProperty("projection_ref");
  });

  it("rejects stale and incompatible owner bindings while exposing all compatible ports", () => {
    const document = definition();
    document.graphs[0].nodes.splice(1, 0,
      { id: "execute", kind: "execute_action", config: { proposal_from: { node_id: "start", output: "observation" } } },
      { id: "emit", kind: "emit_artifact", config: { artifact_kind_ref: "artifact", input_from: { node_id: "missing", output: "analysis" } } },
    );
    expect(validateNodeBindings(document)).toEqual([
      expect.objectContaining({ nodeId: "execute", code: "type_mismatch" }),
      expect.objectContaining({ nodeId: "emit", code: "missing_source" }),
    ]);
    expect(compatibleNodeOutputs(document, "main", "DecisionProposal", "execute")).toEqual([]);
  });

  it("preserves owner route idempotency but rejects a priority tie", () => {
    const document = definition();
    const withFallback = addEdge(document, "main", { from: "start", to: "done", on: "ok", priority: 1 });
    expect(withFallback.graphs[0].edges).toHaveLength(2);
    expect(addEdge(withFallback, "main", { from: "start", to: "done", on: "ok", priority: 1 }).graphs[0].edges).toHaveLength(2);
    expect(() => addEdge(withFallback, "main", { from: "start", to: "start", on: "ok", priority: 1 })).toThrow("priority tie");
  });

  it("round-trips the golden owner corpus covering all 13 kinds and guarded edges", async () => {
    const raw = readFileSync("contracts/accepted/phase1/conformance/valid-all-node-kinds.json", "utf8");
    const imported = parseDefinitionImport(raw);
    expect(imported.kind).toBe("supported");
    if (imported.kind !== "supported") return;
    const document = imported.document;
    const kinds = new Set(document.graphs.flatMap((graph) => graph.nodes.map((node) => node.kind)));
    expect(kinds).toEqual(new Set(OWNER_NODE_KINDS));
    expect(validateNodeBindings(document)).toEqual([]);
    expect(document.graphs.flatMap((graph) => graph.edges).some((edge) => edge.guard_ref)).toBe(true);

    const digest = await semanticDigest(document);
    const bundleRaw = await serializeStudioBundle({ semantic: document, layout: createLayout(document, digest) });
    const roundTrip = await parseStudioBundle(bundleRaw);
    expect(await semanticDigest(roundTrip.semantic)).toBe(digest);
    expect(roundTrip.semantic).toEqual(document);
  });

  it("round-trips guarded edge fields without dropping the owner guard reference", () => {
    const document = definition();
    document.graphs[0].guards = [{ id: "ready", expression: { kind: "exists", value: "state.ready" } }];
    const updated = updateEdge(document, "main", 0, (edge) => ({ ...edge, on: "true", priority: 2, guard_ref: "ready" }));
    expect(updated.graphs[0].edges[0]).toMatchObject({ on: "true", priority: 2, guard_ref: "ready" });
    expect(updated.graphs[0].edges[0]).not.toBe(document.graphs[0].edges[0]);
    const cleared = updateEdge(updated, "main", 0, (edge) => {
      const next = { ...edge };
      delete next.guard_ref;
      return next;
    });
    expect(cleared.graphs[0].edges[0]).not.toHaveProperty("guard_ref");
  });

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

  it("keeps an unknown v1 node kind byte-exact and read-only", () => {
    const original = JSON.stringify({
      schema_version: "ascension.workflow/v1",
      workflow_id: "future.node",
      version: "1.0.0",
      mode: "strict",
      game_profile: "test",
      policy_ref: "test.policy",
      capabilities: { required: [], optional: [] },
      limits: { max_steps: 4, max_subworkflow_depth: 1, max_provider_calls: 0, max_parallel_analyses: 1, max_output_tokens: 128 },
      entry_graph: "main",
      graphs: [{ id: "main", entry_node: "future", nodes: [{ id: "future", kind: "owner_future", config: {} }], edges: [] }],
    });
    const archival = parseDefinitionImport(original);
    expect(archival.kind).toBe("archival");
    if (archival.kind === "archival") expect(archival.rawText).toBe(original);
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

describe("sha256 fallback", () => {
  it("computes SHA-256 without Web Crypto for insecure LAN origins", async () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", {});
    try {
      expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    } finally {
      vi.stubGlobal("crypto", original);
    }
  });
});

describe("canonical order and null semantics", () => {
  it("preserves array order and explicit nulls exactly", () => {
    const value = { edges: [{ from: "b" }, { from: "a" }], note: null, values: [3, 1, 2, null] };
    expect(canonicalJson(value)).toBe('{"edges":[{"from":"b"},{"from":"a"}],"note":null,"values":[3,1,2,null]}');
    expect(parseBoundedJson(JSON.stringify(value))).toEqual(value);
  });

  it("changes the semantic digest when owner-ordered arrays are reordered", async () => {
    const base = {
      schema_version: "ascension.workflow/v1", workflow_id: "order.test", version: "1.0.0", mode: "strict", game_profile: "t", policy_ref: "p",
      capabilities: { required: [], optional: [] }, limits: { max_steps: 4, max_subworkflow_depth: 1, max_provider_calls: 0, max_parallel_analyses: 1, max_output_tokens: 0 }, entry_graph: "main",
      graphs: [{ id: "main", entry_node: "b", nodes: [{ id: "a", kind: "terminal", config: { outcome: "completed" } }, { id: "b", kind: "terminal", config: { outcome: "completed" } }], edges: [] }],
    };
    const reordered = { ...base, graphs: [{ ...base.graphs[0], nodes: [...base.graphs[0].nodes].reverse() }] };
    expect(await semanticDigest(base as never)).not.toBe(await semanticDigest(reordered as never));
  });

  it("distinguishes an explicit null from a missing field", () => {
    expect(canonicalJson({ value: null })).not.toBe(canonicalJson({}));
  });
});

describe("owner definition identity digest", () => {
  it("retains annotations so the digest matches the owner's exact definition identity", async () => {
    const document = { ...definition(), annotations: { summary: "cloned draft", synthetic: true } } as WorkflowDefinition;
    const identity = await definitionIdentityDigest(document);
    const semantic = await semanticDigest(document);
    expect(identity).not.toBe(semantic);
    expect(identity).toBe(await sha256Hex(canonicalJsonComplete(document)));
    expect(canonicalJsonComplete(document)).toContain("annotations");
    expect(canonicalJson(document)).not.toContain("annotations");
  });
});
