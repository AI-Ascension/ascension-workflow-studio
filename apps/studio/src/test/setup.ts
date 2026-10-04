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
 * Pay the accessibility-name machinery's one-time initialisation here, in
 * setup, instead of inside whichever test happens to query a role first.
 *
 * Every `getByRole`/`getAllByRole` call reaches
 * `dom-accessibility-api`'s `computeAccessibleName`, which calls
 * `getComputedStyle`. jsdom answers that by walking the element through
 * `css-tree`, and `css-tree`'s first parse pulls in its lazy data module
 * (`patchDictionary` / `preprocessAtrules`, several hundred kB of selectors and
 * at-rule definitions). That first call costs ~880ms; every later call costs
 * ~1ms.
 *
 * Because Vitest gives each test file a fresh environment, the cost is charged
 * to the first role query of whichever file runs first — re-paid on every
 * worker. That test is not a slow test, it is just first, so on a loaded CI
 * runner it crossed the default 5s budget and failed with `Test timed out in
 * 5000ms`, while the same assertions passed in the run after (studio#222).
 *
 * Measured in this repo, first `getByRole` on a two-element tree:
 *   without this block  895ms
 *   with this block      56ms
 *
 * The warm-up touches a detached-then-removed element and reads one computed
 * property. It asserts nothing and changes no test's view of the DOM; it only
 * moves a fixed setup cost off the first test's budget and onto the file's.
 *
 * Guarded on `document` because this setup file is also loaded for the
 * `packages` suite, which runs in the node environment where there is no DOM
 * to warm.
 */
if (typeof document !== "undefined") {
  const accessibilityWarmup = document.createElement("div");
  accessibilityWarmup.textContent = "studio accessibility warmup";
  document.body.appendChild(accessibilityWarmup);
  void getComputedStyle(accessibilityWarmup).display;
  accessibilityWarmup.remove();
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
