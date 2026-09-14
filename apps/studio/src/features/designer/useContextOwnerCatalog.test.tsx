import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FixtureClient } from "@studio/client";
import type { ContextOwnerCatalog } from "@studio/contracts";
import { catalogFixture, reseal } from "../../../../../packages/contracts/src/context-owner-catalog.test-fixtures";
import { useContextOwnerCatalog } from "./useContextOwnerCatalog";

function deferred() {
  let resolve!: (value: ContextOwnerCatalog) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ContextOwnerCatalog>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("context owner request generations", () => {
  it("clears current bindings during refresh and after failure", async () => {
    const client = new FixtureClient([]);
    const response = deferred();
    vi.spyOn(client, "listContextBindings").mockResolvedValueOnce(catalogFixture()).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useContextOwnerCatalog(client, "actor.one"));
    await waitFor(() => expect(result.current.bindings).toHaveLength(1));
    act(() => result.current.refresh());
    expect(result.current.state.status).toBe("pending");
    expect(result.current.bindings).toBeUndefined();
    await act(async () => response.reject(new Error("offline")));
    expect(result.current.state.status).toBe("unavailable");
    expect(result.current.bindings).toBeUndefined();
  });
  it("ignores a late old client response after the new client fails", async () => {
    const old = new FixtureClient([]); const next = new FixtureClient([]);
    const pending = deferred();
    vi.spyOn(old, "listContextBindings").mockReturnValue(pending.promise);
    vi.spyOn(next, "listContextBindings").mockRejectedValue(new Error("denied"));
    const { result, rerender } = renderHook(({ client }) => useContextOwnerCatalog(client, "actor"), { initialProps: { client: old } });
    rerender({ client: next });
    await waitFor(() => expect(result.current.state.status).toBe("unavailable"));
    await act(async () => pending.resolve(catalogFixture()));
    expect(result.current.state.status).toBe("unavailable");
    expect(result.current.bindings).toBeUndefined();
  });
  it("invalidates a prior principal and a superseded refresh immediately", async () => {
    const client = new FixtureClient([]);
    const old = deferred(); const next = deferred();
    vi.spyOn(client, "listContextBindings").mockResolvedValueOnce(catalogFixture()).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ principal }) => useContextOwnerCatalog(client, principal), { initialProps: { principal: "one" } });
    await waitFor(() => expect(result.current.bindings).toHaveLength(1));
    rerender({ principal: "two" });
    expect(result.current.bindings).toBeUndefined();
    act(() => result.current.refresh());
    await act(async () => next.reject(new Error("unavailable")));
    await act(async () => old.resolve(catalogFixture()));
    expect(result.current.state.status).toBe("unavailable");
  });
  it("keeps empty and all declared unavailable states distinct from a failed request", async () => {
    const states = ["disabled", "unattached", "denied", "stale", "unsupported"] as const;
    for (const state of states) {
      const client = new FixtureClient([]); const c = catalogFixture(); c.descriptors[0].state = state;
      vi.spyOn(client, "listContextBindings").mockResolvedValue(reseal(c));
      const hook = renderHook(() => useContextOwnerCatalog(client, "actor"));
      await waitFor(() => expect(hook.result.current.state.status).toBe("available"));
      expect(hook.result.current.bindings).toEqual([]);
      hook.unmount();
    }
    const empty = catalogFixture(); empty.descriptors = [];
    const client = new FixtureClient([]);
    vi.spyOn(client, "listContextBindings").mockResolvedValue(reseal(empty));
    const hook = renderHook(() => useContextOwnerCatalog(client, "actor"));
    await waitFor(() => expect(hook.result.current.state.status).toBe("available"));
    expect(hook.result.current.bindings).toEqual([]);
  });
});
