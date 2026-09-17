#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Measure the built Studio bundle against the PERF-08 static core bundle budget
// (docs/reference/phase2-package/quality/benchmarks.json, profile
// `static_core_bundle`: gzip JavaScript bytes of the initial core route,
// excluding lazy panels, target_max 1,500,000).
//
// Usage: node tools/measure-bundle-budget.mjs [--dist <dir>] [--json]
//
// The initial core route is every JavaScript file that dist/index.html loads
// eagerly (`<script src>` and `<link rel="modulepreload">`). Every other emitted
// JavaScript file (lazy chunks, workers) is reported separately and also summed,
// so a reviewer can see both numbers. The threshold is read from the checked-in
// benchmark profile and is never changed here.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const PERF_08_PROFILE_ID = "PERF-08";
export const DEFAULT_GZIP_LEVEL = 6;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readPerf08Threshold(root = repoRoot) {
  const benchmarks = JSON.parse(
    readFileSync(resolve(root, "docs/reference/phase2-package/quality/benchmarks.json"), "utf8"),
  );
  const profile = benchmarks.profiles.find((entry) => entry.id === PERF_08_PROFILE_ID);
  if (!profile || !Number.isSafeInteger(profile.target_max) || profile.target_max <= 0) {
    throw new Error(`benchmarks.json has no usable ${PERF_08_PROFILE_ID} target_max`);
  }
  return { thresholdBytes: profile.target_max, metric: profile.metric, input: profile.input };
}

function listJavaScriptFiles(root, current = root) {
  const files = [];
  for (const name of readdirSync(current).sort()) {
    const path = join(current, name);
    const stats = statSync(path);
    if (stats.isDirectory()) files.push(...listJavaScriptFiles(root, path));
    else if (/\.(m?js)$/.test(name)) files.push(relative(root, path).split(sep).join("/"));
  }
  return files;
}

export function eagerScriptsFromHtml(html) {
  const eager = new Set();
  const scriptPattern = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const preloadPattern = /<link\b[^>]*\brel\s*=\s*["']modulepreload["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const pattern of [scriptPattern, preloadPattern]) {
    for (const match of html.matchAll(pattern)) {
      const url = match[1];
      if (/^[a-z]+:/i.test(url) || url.startsWith("//")) continue;
      eager.add(url.replace(/^\.?\//, "").split("?")[0]);
    }
  }
  return [...eager];
}

export function measureBundleBudget(distDir, options = {}) {
  const dist = resolve(distDir);
  const indexPath = join(dist, "index.html");
  if (!existsSync(indexPath)) throw new Error(`no built bundle at ${indexPath}; run \`npm run build\` first`);
  const gzipLevel = options.gzipLevel ?? DEFAULT_GZIP_LEVEL;
  const threshold = options.thresholdBytes === undefined ? readPerf08Threshold(options.repoRoot) : { thresholdBytes: options.thresholdBytes };
  const eager = new Set(eagerScriptsFromHtml(readFileSync(indexPath, "utf8")));
  const files = listJavaScriptFiles(dist).map((path) => {
    const bytes = readFileSync(join(dist, path));
    return {
      path,
      core: eager.has(path),
      raw_bytes: bytes.length,
      gzip_bytes: gzipSync(bytes, { level: gzipLevel }).length,
    };
  });
  for (const path of eager) {
    if (!files.some((file) => file.path === path)) throw new Error(`index.html references ${path} but dist has no such JavaScript file`);
  }
  const sum = (subset, key) => subset.reduce((total, file) => total + file[key], 0);
  const core = files.filter((file) => file.core);
  if (core.length === 0) throw new Error("index.html loads no JavaScript eagerly; nothing to measure");
  const coreGzip = sum(core, "gzip_bytes");
  return {
    profile: PERF_08_PROFILE_ID,
    metric: "gzip_javascript_bytes",
    gzip_level: gzipLevel,
    threshold_bytes: threshold.thresholdBytes,
    core_route: { files: core.map((file) => file.path), raw_bytes: sum(core, "raw_bytes"), gzip_bytes: coreGzip },
    all_javascript: { files: files.map((file) => file.path), raw_bytes: sum(files, "raw_bytes"), gzip_bytes: sum(files, "gzip_bytes") },
    files,
    within_budget: coreGzip <= threshold.thresholdBytes,
  };
}

function parseArgs(argv) {
  const args = { dist: resolve(repoRoot, "dist"), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--dist") {
      const value = argv[index + 1];
      if (!value) throw new Error("--dist needs a directory");
      args.dist = resolve(value);
      index += 1;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = measureBundleBudget(args.dist);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const file of result.files) {
        console.log(`${file.core ? "core " : "lazy "} ${file.path}: ${file.raw_bytes} raw, ${file.gzip_bytes} gzip`);
      }
      console.log(`core route gzip JavaScript: ${result.core_route.gzip_bytes} bytes (raw ${result.core_route.raw_bytes}) against ${result.threshold_bytes}`);
      console.log(`all JavaScript gzip: ${result.all_javascript.gzip_bytes} bytes (raw ${result.all_javascript.raw_bytes})`);
      console.log(`${PERF_08_PROFILE_ID}: ${result.within_budget ? "within budget" : "OVER BUDGET"}`);
    }
    process.exitCode = result.within_budget ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
