import { describe, expect, it, vi } from "vitest";
import { OwnerApiClient } from "./index";
import { CATALOG_RESPONSE_MAX_BYTES, readContextCatalogBody } from "./context-owner-catalog";
import { catalogFixture } from "../../contracts/src/context-owner-catalog.test-fixtures";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
describe("bounded management catalog response", () => {
  it("cancels overflow even with a misleading content length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(CATALOG_RESPONSE_MAX_BYTES + 1)); },
      cancel,
    });
    await expect(readContextCatalogBody(new Response(stream, { headers: { "content-length": "1" } }))).rejects.toThrow("byte guard");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels invalid UTF-8 and rejects truncated UTF-8 without replacement characters", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(0xff)); }, cancel,
    });
    await expect(readContextCatalogBody(new Response(stream))).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    await expect(readContextCatalogBody(new Response(Uint8Array.of(0xc3)))).rejects.toThrow();
  });
  it("ignores empty chunks and decodes valid split UTF-8", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 1000; i += 1) controller.enqueue(new Uint8Array());
        controller.enqueue(bytes('{"text":"'));
        controller.enqueue(Uint8Array.of(0xc3));
        controller.enqueue(Uint8Array.of(0xa9));
        controller.enqueue(bytes('"}')); controller.close();
      },
    });
    expect(await readContextCatalogBody(new Response(stream))).toEqual({ text: "é" });
  });
  it("rejects absent bodies, duplicate escaped keys, unsafe integers and trailing data", async () => {
    await expect(readContextCatalogBody(new Response(null))).rejects.toThrow("unavailable");
    for (const raw of ['{"x":1,"\\u0078":2}', '{"version":9007199254740993}', '{} {}']) {
      await expect(readContextCatalogBody(new Response(raw))).rejects.toThrow();
    }
  });
  it("admits the actual authenticated route through the bounded reader and strict decoder", async () => {
    const catalog = catalogFixture("restricted");
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      expect(input).toBe("/v1/context-bindings");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-owner-token");
      expect(init?.credentials).toBe("same-origin");
      return new Response(JSON.stringify(catalog));
    });
    const client = new OwnerApiClient({ baseUrl: "/v1", token: "test-owner-token", fetcher });
    expect(await client.listContextBindings()).toEqual(catalog);
  });
  it("rejects non-u64 wire spellings before rounding can hide them behind unchanged digests", async () => {
    const original = JSON.stringify(catalogFixture());
    expect(original).toContain('"version":1');
    for (const token of [
      "1.0000000000000001", "0.99999999999999999", "1.0", "1e0", "-0", "-1",
      "1e999999999999999999999", "9007199254740993", "18446744073709551615",
      "01", "1.", "1e", "+1",
    ]) {
      const raw = original.replace('"version":1', `"version":${token}`);
      await expect(readContextCatalogBody(new Response(raw)), token).rejects.toThrow();
      const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () => new Response(raw) });
      await expect(client.listContextBindings(), token).rejects.toMatchObject({ code: "context_catalog_invalid" });
    }
    // The producer's zero-note descriptor retains its original descriptor and catalog digests.
    const zeroNotes = JSON.stringify(catalogFixture("zero_notes"));
    expect(zeroNotes).toContain('"max_notes":0');
    for (const token of ["1e-9999", "-1e-9999", "0.0000000000000000001"]) {
      const raw = zeroNotes.replace('"max_notes":0', `"max_notes":${token}`);
      await expect(readContextCatalogBody(new Response(raw)), token).rejects.toThrow();
      const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () => new Response(raw) });
      await expect(client.listContextBindings(), token).rejects.toMatchObject({ code: "context_catalog_invalid" });
    }
  });
  it("checks numeric tokens across chunks without changing escaped strings or split UTF-8", async () => {
    const original = JSON.stringify(catalogFixture());
    const raw = original.replace('"version":1', '"version":1.0000000000000001');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes(raw)) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () => new Response(stream) });
    await expect(client.listContextBindings()).rejects.toMatchObject({ code: "context_catalog_invalid" });
    const value = { text: 'é \\"version":1.0000000000000001 1e99999 -0', zero: 0, maximum: Number.MAX_SAFE_INTEGER };
    const stringStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes(JSON.stringify(value))) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    expect(await readContextCatalogBody(new Response(stringStream))).toEqual(value);
  });
  it("rejects tampered and duplicate-key catalogs before exposing binding options", async () => {
    const c = catalogFixture(); c.descriptors[0].effective_limits.max_items = 65;
    for (const raw of [JSON.stringify(c), '{"descriptors":[],"descriptors":[]}']) {
      const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () => new Response(raw) });
      await expect(client.listContextBindings()).rejects.toThrow();
    }
    const denied = new OwnerApiClient({ baseUrl: "/v1", fetcher: async () => new Response(
      JSON.stringify({ error: { code: "permission_denied", message: "Catalog access denied" } }), { status: 403 }) });
    await expect(denied.listContextBindings()).rejects.toMatchObject({ status: 403 });
  });
});

describe("typed current owner routes", () => {
  const boundary = {
    run_id: "run.owner.1",
    episode_id: "episode.1",
    agent_id: "agent.1",
    state_id: "state.1",
    generation: 1,
    observation_sha256: "a".repeat(64),
    catalog_sha256: "b".repeat(64),
    adapter_revision: "adapter.1",
    model_revision: "model.1",
    configuration_sha256: "c".repeat(64),
    output_schema_sha256: "d".repeat(64),
    controller_epoch: 1,
    gate_epoch: 1,
    control_version: 1,
  };
  const binding = {
    schema_version: "ascension.context-control.owner-binding.v1",
    owner_id: "owner.1",
    owner_version: "v1",
    invocation_id: "run.owner.1.node.1",
    binding_id: "owner.1.decide.v1",
    binding_version: 1,
    binding_digest: "e".repeat(64),
    context_ref: "context.owner.v1",
    instance_id: "instance.1",
    node_kind: "decide",
    state: "available",
    workflow_run_id: "run.owner.1",
    definition_digest: "f".repeat(64),
    graph_id: "main",
    node_id: "decide",
    node_execution_id: "run.owner.1.node.1",
    boundary,
    lease_epoch: 1,
    snapshot_id: "snapshot.1",
    approved_revision_id: "revision.1",
    plan_epoch: 1,
    grants: { metadata_read: true, content_read: true, edit: false, control: true },
    continuity: { survives_controller_restart: true, receipt_recovery: true, provider_session_continuity: false },
  };
  it("decodes owner association, effective limits, and exact receipt lookup", async () => {
    const command = { pause: { idempotency_key: "owner.pause.1", expected_control_version: 1 } };
    const receipt = {
      schema_version: "ascension.context-control.owner-receipt.v2",
      owner_id: binding.owner_id,
      invocation_id: binding.invocation_id,
      binding_id: binding.binding_id,
      binding_digest: binding.binding_digest,
      command: "pause",
      command_id: "owner.command.1",
      idempotency_key: command.pause.idempotency_key,
      effect: "pause_requested",
      control_version: 2,
      plan_epoch: 1,
      controller_epoch: 1,
      gate_epoch: 1,
      boundary: { ...boundary, control_version: 2 },
      revision_id: null,
      preview_manifest_digest: null,
      approved_manifest_digest: null,
    };
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const path = String(input);
      if (path.endsWith("/context-owner-association")) return new Response(JSON.stringify({
        schema_version: "ascension.harness.context-owner-association-view.v1", binding,
      }));
      if (path.endsWith("/context-owner-effective-limits")) return new Response(JSON.stringify({
        schema_version: "ascension.harness.context-owner-effective-limits-view.v1",
        owner_id: binding.owner_id,
        owner_version: binding.owner_version,
        catalog_digest: "1".repeat(64),
        binding_id: binding.binding_id,
        binding_version: 1,
        binding_digest: binding.binding_digest,
        context_ref: binding.context_ref,
        node_kind: binding.node_kind,
        adapter_revision: "adapter.1",
        model_revision: "model.1",
        effective_limits: {
          max_items: 2, max_notes: 1, max_context_bytes: 64,
          max_objective_bytes: 32, max_control_events: 8,
        },
      }));
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(command);
      return new Response(JSON.stringify(receipt));
    });
    const client = new OwnerApiClient({ baseUrl: "/v1", token: "owner-token", fetcher });
    await expect(client.contextOwnerAssociation(binding.workflow_run_id)).resolves.toMatchObject({ binding });
    await expect(client.contextOwnerEffectiveLimits(binding.workflow_run_id)).resolves.toMatchObject({
      binding_id: binding.binding_id,
      effective_limits: { max_control_events: 8 },
    });
    await expect(client.lookupContextControlReceipt(binding.workflow_run_id, command)).resolves.toEqual(receipt);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
