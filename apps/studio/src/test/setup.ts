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
 * Vitest's jsdom environment DOES set a base URL — `http://localhost:3000/`.
 * So a relative `fetch` does not fail to resolve. What happens instead is
 * that Node's undici takes the resolved absolute URL and attempts a REAL
 * network request to that port, which nothing is listening on, and only then
 * rejects with `TypeError: Failed to fetch`.
 *
 * That real network attempt is the cost. It hits the recordings catalog that
 * `useRecording` requests on mount, once per `<App />` render, and is charged
 * to whichever test renders first. Measured front-loaded and decaying across
 * mounts in a file: `[343.5, 139.0, 85.8, 20.3]`ms. It has pushed that test
 * past the default 5s budget under load (studio#222).
 *
 * Rejecting the request up front with the SAME `TypeError` removes the network
 * attempt without changing what any test observes: both paths are `TypeError`s
 * that reach the same `.catch()`, and no test branches on the message. Each
 * test restores the previous implementation, so a test that needs to observe a
 * real request can still install its own.
 */
const nativeFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (() =>
    Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
});
