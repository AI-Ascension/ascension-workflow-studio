import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { eagerScriptsFromHtml, measureBundleBudget, readPerf08Threshold } from './measure-bundle-budget.mjs';

const html = (body) => `<!doctype html><html><head>${body}</head><body><div id="root"></div></body></html>`;

function writeDist(t, { core = 'a'.repeat(4096), lazy = 'b'.repeat(2048), head } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'studio-bundle-budget-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const dist = join(temp, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'assets', 'index-abc.js'), core);
  writeFileSync(join(dist, 'assets', 'panel-lazy.js'), lazy);
  writeFileSync(join(dist, 'assets', 'index.css'), 'body{}');
  writeFileSync(join(dist, 'index.html'), html(head ?? '<script type="module" crossorigin src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index.css">'));
  return { dist, core, lazy };
}

test('the PERF-08 threshold is read from the checked-in benchmark profile and is 1,500,000 gzip bytes', () => {
  const threshold = readPerf08Threshold();
  assert.equal(threshold.thresholdBytes, 1_500_000);
  assert.equal(threshold.metric, 'gzip_javascript_bytes');
});

test('eager scripts are the index.html script tags and modulepreload links only', () => {
  const eager = eagerScriptsFromHtml(html(
    '<script type="module" src="/assets/index-a.js"></script>' +
    '<link rel="modulepreload" href="./assets/vendor-b.js">' +
    '<link rel="stylesheet" href="/assets/index.css">' +
    '<script src="https://example.invalid/remote.js"></script>',
  ));
  assert.deepEqual(eager.sort(), ['assets/index-a.js', 'assets/vendor-b.js']);
});

test('measures gzip bytes of the core route JavaScript separately from lazy chunks', (t) => {
  const { dist, core, lazy } = writeDist(t);
  const result = measureBundleBudget(dist);
  assert.equal(result.profile, 'PERF-08');
  assert.equal(result.threshold_bytes, 1_500_000);
  assert.deepEqual(result.core_route.files, ['assets/index-abc.js']);
  assert.equal(result.core_route.raw_bytes, core.length);
  assert.equal(result.core_route.gzip_bytes, gzipSync(Buffer.from(core), { level: 6 }).length);
  assert.deepEqual(result.all_javascript.files, ['assets/index-abc.js', 'assets/panel-lazy.js']);
  assert.equal(result.all_javascript.raw_bytes, core.length + lazy.length);
  assert.equal(
    result.all_javascript.gzip_bytes,
    gzipSync(Buffer.from(core), { level: 6 }).length + gzipSync(Buffer.from(lazy), { level: 6 }).length,
  );
  assert.equal(result.files.find((file) => file.path === 'assets/panel-lazy.js').core, false);
  assert.equal(result.within_budget, true);
});

test('reports an over-budget core route without changing the threshold', (t) => {
  const { dist } = writeDist(t);
  const tight = measureBundleBudget(dist, { thresholdBytes: 10 });
  assert.equal(tight.threshold_bytes, 10);
  assert.equal(tight.within_budget, false);
  assert.equal(measureBundleBudget(dist).threshold_bytes, 1_500_000);
});

test('refuses a missing build, a dangling script reference and a route with no JavaScript', (t) => {
  assert.throws(() => measureBundleBudget(join(tmpdir(), 'studio-no-such-dist')), /run `npm run build`/);
  const dangling = writeDist(t, { head: '<script type="module" src="/assets/missing.js"></script>' });
  assert.throws(() => measureBundleBudget(dangling.dist), /no such JavaScript file/);
  const empty = writeDist(t, { head: '<link rel="stylesheet" href="/assets/index.css">' });
  assert.throws(() => measureBundleBudget(empty.dist), /loads no JavaScript eagerly/);
});
