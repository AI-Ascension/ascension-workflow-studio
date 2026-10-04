import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

afterEach(() => cleanup());

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    public constructor(_callback: ResizeObserverCallback) {}
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
  } as typeof ResizeObserver;
}

/**
 * jsdom resolves no base URL, so every relative `fetch` — the recordings
 * catalog that `useRecording` requests on mount, once per `<App />` render —
 * rejects only after Node has attempted real URL resolution. Measured at
 * ~500ms on the first mount of a file, which is charged to whichever test
 * happens to render first and has pushed that test past the default 5s budget
 * under load (studio#222).
 *
 * No test asserts on this request, so rejecting it up front removes the cost
 * without changing what any test observes. Each test restores the previous
 * implementation, so a test that needs to observe a real request can still
 * install its own.
 */
const nativeFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (() =>
    Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
});
