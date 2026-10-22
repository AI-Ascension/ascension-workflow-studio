# Isolated browser benchmark scheduling

The normal browser suite includes the production 250-node/500-edge editor
benchmark. Each run dispatches 100 changes through the real node-kind control
and measures input-to-visible-feedback latency. Its Chromium p95 requirement
remains 100 ms, and the first useful render requirement remains 2,000 ms.

The browser suite now uses one Playwright worker. This prevents unrelated
import, JSON parsing and layout tests in the same suite from running
concurrently with the measured editor. All 29 cases, all 100 edit samples,
the production build, the browser matrix, every assertion, and `retries: 0`
remain unchanged. The resulting measurement is one editor on the runner;
it is not a concurrent multi-editor performance claim.

## Observed failure

The post-merge run for Studio commit
`878fc28574ca79b3dedd6cda3c825cacb116e200` failed its Chromium PERF-02 assertion:

| Observation | Value |
| --- | --- |
| Workflow run | [39756094392](https://github.com/AI-Ascension/ascension-workflow-studio/actions/runs/39756094392) |
| Chromium job | [119748353279](https://github.com/AI-Ascension/ascension-workflow-studio/actions/runs/39756094392/job/119748353279) |
| Concurrent Playwright workers | 2 |
| Completed cases | 28 passed, 1 failed |
| Edit samples | 100 |
| Edit p95 | 128.1 ms, **failed** the 100 ms requirement |
| Synchronous handler p95 | 0.2 ms |
| First useful render | 999 ms |
| Idle frame median | 16.6 ms |
| Failure artifact | [12415683083](https://github.com/AI-Ascension/ascension-workflow-studio/actions/runs/39756094392/artifacts/12415683083) |
| Artifact SHA-256 | `94a47684c6099f88d28b8f2f5c905b32c7edafd6d1c6c476282ec91833d11ea3` |

The retained log and trace show the complete benchmark edit loop while another
worker completed import and malformed-JSON journeys. The preceding dependency
update changed jsdom and its test dependencies; the local production JavaScript
asset names and measured sizes were identical before and after that update
(`index-CzkIKihQ.js`, 981,674 raw bytes and 250,851 gzip bytes).

Those observations establish an uncontrolled concurrent workload, not proof
that contention explains every millisecond of the miss. The scheduling change
removes that variable. An exact-head hosted run must still pass the unchanged
performance assertion and complete suite; the failed measurement above is not
reclassified as a pass.
