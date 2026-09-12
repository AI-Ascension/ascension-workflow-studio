/// <reference types="vite/client" />

import {
  DefinitionRecordSchema,
  WorkflowDefinitionSchema,
  type DefinitionRecord,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from "@studio/contracts";

/**
 * Production benchmark harness for P2-089 / PERF-01 / PERF-02.
 *
 * The harness is inert unless the studio is opened with a `benchmark` query
 * parameter, e.g. `/?benchmark=250x500`. It then exposes a synthetic admitted
 * corpus and a small in-page recorder built on `performance.mark`/`measure`.
 * It never changes authoring authority: it only measures the existing UI path.
 */

export interface BenchmarkWorkload {
  nodes: number;
  edges: number;
}

export interface BenchmarkReport {
  workload: BenchmarkWorkload;
  build: "production" | "development";
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  firstUsefulRenderMs: number | null;
  samples: number[];
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  handlerMs: number[];
  handlerP95Ms: number | null;
}

export interface BenchmarkHarness {
  workload: BenchmarkWorkload;
  report: () => BenchmarkReport;
  reset: () => void;
}

declare global {
  interface Window {
    __studioBenchmark?: BenchmarkHarness;
  }
}

export const DEFAULT_BENCHMARK_WORKLOAD: BenchmarkWorkload = { nodes: 250, edges: 500 };
const MAX_BENCHMARK_NODES = 512;
const MAX_BENCHMARK_EDGES = 2048;
const INPUT_EVENTS = ["pointerdown", "keydown", "input", "change", "click"] as const;
const INPUT_MEMORY_MS = 1_000;

let cachedCatalog: DefinitionRecord[] | undefined;
let cachedWorkload: BenchmarkWorkload | undefined;
let samples: number[] = [];
let handlerSamples: number[] = [];
let firstUsefulRenderMs: number | null = null;
let lastInputAt: number | undefined;
let listenersInstalled = false;

export function parseBenchmarkWorkload(search: string): BenchmarkWorkload | undefined {
  const raw = new URLSearchParams(search).get("benchmark");
  if (raw === null) return undefined;
  if (raw === "" || raw === "1") return DEFAULT_BENCHMARK_WORKLOAD;
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(raw);
  if (!match) return undefined;
  const nodes = Number(match[1]);
  const edges = Number(match[2]);
  if (!Number.isSafeInteger(nodes) || !Number.isSafeInteger(edges)) return undefined;
  if (nodes < 1 || nodes > MAX_BENCHMARK_NODES || edges < 0 || edges > MAX_BENCHMARK_EDGES) return undefined;
  return { nodes, edges };
}

export function isBenchmarkMode(): boolean {
  return typeof window !== "undefined" && parseBenchmarkWorkload(window.location.search) !== undefined;
}

export function generateBenchmarkDefinition({ nodes, edges }: BenchmarkWorkload): WorkflowDefinition {
  const nodeList: WorkflowNode[] = Array.from({ length: nodes }, (_unused, index) => ({
    id: `n${String(index).padStart(4, "0")}`,
    kind: index % 17 === 0 ? "route" : "observe",
    config: { projection_ref: "approved.benchmark.state", index },
  }));
  const edgeList: WorkflowEdge[] = [];
  let offset = 1;
  while (edgeList.length < edges) {
    for (let index = 0; index < nodes && edgeList.length < edges; index += 1) {
      const target = (index + offset) % nodes;
      if (target === index) continue;
      edgeList.push({ from: nodeList[index].id, to: nodeList[target].id, on: "ok", priority: edgeList.length % 4 });
    }
    offset += 1;
    if (offset > nodes + 1) break;
  }
  const workloadId = `benchmark.${nodes}x${edges}`;
  return WorkflowDefinitionSchema.parse({
    schema_version: "ascension.workflow/v1",
    workflow_id: workloadId,
    version: "1.0.0",
    mode: "strict",
    game_profile: "benchmark.synthetic",
    policy_ref: "benchmark.synthetic.policy",
    capabilities: { required: [], optional: [] },
    limits: {
      max_steps: nodes,
      max_subworkflow_depth: 0,
      max_provider_calls: 0,
      max_parallel_analyses: 1,
      max_output_tokens: 0,
    },
    entry_graph: "main",
    graphs: [{ id: "main", entry_node: nodeList[0].id, nodes: nodeList, edges: edgeList }],
    annotations: {
      summary: `Synthetic admitted benchmark corpus: ${nodes} nodes / ${edgeList.length} edges.`,
      synthetic: true,
    },
  });
}

export function benchmarkCatalog(): DefinitionRecord[] | undefined {
  if (typeof window === "undefined") return undefined;
  const workload = parseBenchmarkWorkload(window.location.search);
  if (!workload) return undefined;
  if (cachedCatalog && cachedWorkload && cachedWorkload.nodes === workload.nodes && cachedWorkload.edges === workload.edges) return cachedCatalog;
  const definition = generateBenchmarkDefinition(workload);
  cachedWorkload = workload;
  cachedCatalog = [DefinitionRecordSchema.parse({
    id: definition.workflow_id,
    title: `Benchmark corpus ${workload.nodes}/${workload.edges}`,
    description: "Synthetic admitted corpus generated for production performance measurement. It carries no execution authority.",
    source: "catalog",
    updatedAt: new Date(0).toISOString(),
    definition,
    capabilities: [],
  })];
  installRecorder(workload);
  return cachedCatalog;
}

function installRecorder(workload: BenchmarkWorkload): void {
  if (typeof window === "undefined") return;
  if (!listenersInstalled) {
    listenersInstalled = true;
    for (const type of INPUT_EVENTS) {
      document.addEventListener(type, () => { lastInputAt = performance.now(); }, true);
    }
  }
  window.__studioBenchmark = {
    workload,
    report: () => buildReport(workload),
    reset: () => { samples = []; handlerSamples = []; firstUsefulRenderMs = null; },
  };
}

/**
 * Captures the most recent real user-input timestamp that immediately preceded
 * the edit handler. Falls back to the current time for programmatic edits.
 */
export function beginBenchmarkEdit(): number | undefined {
  if (typeof window === "undefined" || !window.__studioBenchmark) return undefined;
  const now = performance.now();
  const start = lastInputAt !== undefined && now - lastInputAt <= INPUT_MEMORY_MS ? lastInputAt : now;
  lastInputAt = undefined;
  return start;
}

/**
 * Records input-to-visible-feedback latency: the interval from the user input
 * event to the second animation frame after React committed the update, which
 * is the first point the browser can have painted the new DOM.
 */
export function endBenchmarkEdit(start: number | undefined): void {
  if (start === undefined || typeof window === "undefined" || !window.__studioBenchmark) return;
  requestAnimationFrame(() => {
    // The rAF callback runs before the browser paints that frame; the following
    // task observes the frame after paint without waiting a second full frame.
    window.setTimeout(() => {
      const end = performance.now();
      performance.mark("studio.edit.end");
      performance.measure("studio.edit", { start, end });
      samples.push(end - start);
    }, 0);
  });
}

/** Records time from navigation start to the first painted designer graph. */
export function recordFirstUsefulRender(): void {
  if (typeof window === "undefined" || !window.__studioBenchmark || firstUsefulRenderMs !== null) return;
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      if (firstUsefulRenderMs === null) firstUsefulRenderMs = performance.now();
    }, 0);
  });
}

/** Records the synchronous edit-handler cost, separating app work from paint. */
export function recordBenchmarkHandler(start: number | undefined): void {
  if (start === undefined || typeof window === "undefined" || !window.__studioBenchmark) return;
  handlerSamples.push(performance.now() - start);
}

export function percentile(values: readonly number[], percent: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percent / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function buildReport(workload: BenchmarkWorkload): BenchmarkReport {
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  return {
    workload,
    build: import.meta.env.PROD ? "production" : "development",
    userAgent: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    hardwareConcurrency: typeof navigator === "undefined" ? null : (navigator.hardwareConcurrency ?? null),
    deviceMemory: typeof navigator === "undefined" ? null : ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null),
    firstUsefulRenderMs,
    samples: [...samples],
    count: samples.length,
    p50Ms: Number.isNaN(p50) ? null : p50,
    p95Ms: Number.isNaN(p95) ? null : p95,
    maxMs: samples.length === 0 ? null : Math.max(...samples),
    handlerMs: [...handlerSamples],
    handlerP95Ms: Number.isNaN(percentile(handlerSamples, 95)) ? null : percentile(handlerSamples, 95),
  };
}
