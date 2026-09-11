import { describe, expect, it } from "vitest";

import { evaluateGuard, guardReferencedFields, isRegisteredGuardOperator } from "./guard";

describe("guard evaluation preview", () => {
  it("keeps absent observation fields unknown instead of treating them as safe", () => {
    const expression = { kind: "field", value: "approved.outcome" };
    expect(evaluateGuard(expression, {})).toBe("unknown");
    expect(evaluateGuard(expression, { "approved.outcome": true })).toBe("true");
    expect(evaluateGuard(expression, { "approved.outcome": false })).toBe("false");
  });

  it("reports presence separately from truthiness", () => {
    expect(evaluateGuard({ kind: "exists", value: "state.game_outcome" }, {})).toBe("false");
    expect(evaluateGuard({ kind: "exists", value: "state.game_outcome" }, { "state.game_outcome": null })).toBe("true");
  });

  it("requires matching operand types and otherwise stays unknown", () => {
    const expression = { kind: "greater", value: { left: "score", right: { kind: "integer", value: 2 } } };
    expect(evaluateGuard(expression, {})).toBe("unknown");
    expect(evaluateGuard(expression, { score: "3" })).toBe("unknown");
    expect(evaluateGuard(expression, { score: 3 })).toBe("true");
    expect(evaluateGuard(expression, { score: 1 })).toBe("false");
  });

  it("uses Kleene short-circuiting for conjunctions", () => {
    const expression = { kind: "and", value: [{ kind: "field", value: "ready" }, { kind: "literal", value: { kind: "boolean", value: false } }] };
    expect(evaluateGuard(expression, {})).toBe("false");
    expect(evaluateGuard({ kind: "not", value: { kind: "field", value: "ready" } }, {})).toBe("unknown");
  });

  it("treats overflowing integer addition as unknown", () => {
    const expression = { kind: "add", value: { left: "count", right: 1 } };
    expect(evaluateGuard(expression, { count: Number.MAX_SAFE_INTEGER })).toBe("unknown");
    expect(evaluateGuard(expression, { count: -1 })).toBe("false");
    expect(evaluateGuard(expression, { count: 1 })).toBe("true");
  });

  it("lists referenced fields and registers admitted operators", () => {
    expect(guardReferencedFields({ kind: "and", value: [{ kind: "exists", value: "a" }, { kind: "field", value: "b" }] })).toEqual(["a", "b"]);
    expect(isRegisteredGuardOperator("greater_or_equal")).toBe(true);
    expect(isRegisteredGuardOperator("remote_shell")).toBe(false);
  });
});
