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
