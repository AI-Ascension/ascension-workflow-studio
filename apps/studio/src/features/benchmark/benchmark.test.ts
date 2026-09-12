import { describe, expect, it } from "vitest";

import { WorkflowDefinitionSchema } from "@studio/contracts";

import {
  DEFAULT_BENCHMARK_WORKLOAD,
  generateBenchmarkDefinition,
  parseBenchmarkWorkload,
  percentile,
} from "./benchmark";

describe("benchmark workload parsing", () => {
  it("is inert without the benchmark parameter", () => {
    expect(parseBenchmarkWorkload("")).toBeUndefined();
    expect(parseBenchmarkWorkload("?view=library")).toBeUndefined();
  });

  it("accepts the shorthand and an explicit size", () => {
    expect(parseBenchmarkWorkload("?benchmark=1")).toEqual(DEFAULT_BENCHMARK_WORKLOAD);
    expect(parseBenchmarkWorkload("?benchmark=250x500")).toEqual({ nodes: 250, edges: 500 });
  });

  it("rejects malformed or out-of-bounds requests", () => {
    expect(parseBenchmarkWorkload("?benchmark=large")).toBeUndefined();
    expect(parseBenchmarkWorkload("?benchmark=0x10")).toBeUndefined();
    expect(parseBenchmarkWorkload("?benchmark=513x10")).toBeUndefined();
    expect(parseBenchmarkWorkload("?benchmark=250x2049")).toBeUndefined();
  });
});

describe("benchmark corpus generation", () => {
  it("produces an admitted definition at the requested bounds", () => {
    const definition = generateBenchmarkDefinition({ nodes: 250, edges: 500 });
    expect(WorkflowDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(definition.graphs[0].nodes).toHaveLength(250);
    expect(definition.graphs[0].edges).toHaveLength(500);
    expect(definition.graphs[0].nodes[0].id).toBe("n0000");
  });

  it("is deterministic for the same bounds", () => {
    const first = generateBenchmarkDefinition({ nodes: 32, edges: 64 });
    const second = generateBenchmarkDefinition({ nodes: 32, edges: 64 });
    expect(second).toEqual(first);
  });

  it("never emits a self-edge", () => {
    const definition = generateBenchmarkDefinition({ nodes: 60, edges: 300 });
    expect(definition.graphs[0].edges.every((edge) => edge.from !== edge.to)).toBe(true);
  });
});

describe("percentile", () => {
  it("uses nearest-rank", () => {
    expect(percentile([], 95)).toBeNaN();
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});
