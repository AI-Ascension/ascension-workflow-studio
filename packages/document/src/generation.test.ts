import { describe, expect, it } from "vitest";

import { createEditGeneration } from "./generation";

describe("edit generation", () => {
  it("starts at the initial generation and bumps monotonically", () => {
    const generation = createEditGeneration();
    expect(generation.current()).toBe(0);
    expect(generation.bump()).toBe(1);
    expect(generation.bump()).toBe(2);
    expect(generation.current()).toBe(2);
  });

  it("rejects a result produced for an older edit", () => {
    const generation = createEditGeneration();
    const token = generation.current();
    generation.bump();
    expect(generation.isCurrent(token)).toBe(false);
    expect(generation.isCurrent(generation.current())).toBe(true);
  });
});
