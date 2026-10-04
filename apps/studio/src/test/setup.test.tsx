import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

/**
 * The flake this guards is #222: the *first* accessible query in the *first*
 * test of the *first* file that makes one absorbed `dom-accessibility-api`'s
 * ~880ms one-time `css-tree` initialisation, and on a loaded runner crossed the
 * default 5s budget for a test that was not actually slow.
 *
 * A timing assertion alone would be the flake itself, so this pins the
 * mechanism instead: after `setup.ts` has run, the accessibility-name machinery
 * must already be warm. If the warm-up block is deleted, the call below pays
 * the full initialisation and this file's own budget is blown — which is
 * precisely the failure mode being prevented, reproduced as a guard.
 */
describe("test setup warm-up", () => {
  it("leaves the accessible-name machinery initialised", async () => {
    // Resolved from `require` rather than a bare specifier:
    // `dom-accessibility-api@0.5.16` ships types that its own `exports` map
    // does not expose, so importing it by package name is `any` under `tsc`
    // and reaching past `node_modules` is unresolvable from this directory.
    const { computeAccessibleName } = createRequire(import.meta.url)(
      "dom-accessibility-api",
    ) as { computeAccessibleName: (element: Element) => string };
    const started = Date.now();
    const name = computeAccessibleName(document.createElement("h1"));
    const elapsed = Date.now() - started;
    expect(name).toBe("");
    // The initialisation is ~880ms; a warm call is ~1ms. The ceiling sits well
    // above the warm cost and far below the initialisation, so ordinary runner
    // jitter cannot flip this assertion while a restored regression cannot pass
    // it.
    expect(elapsed).toBeLessThan(400);
  });

  it("does not leave the warm-up element in the document", () => {
    expect(document.body.textContent).not.toContain("studio accessibility warmup");
  });
});
