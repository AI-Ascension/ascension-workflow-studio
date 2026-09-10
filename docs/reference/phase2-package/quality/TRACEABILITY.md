# Requirements and acceptance traceability

`requirements.json` has 120 mandatory requirements, three per WP. Every requirement
has a named case in `acceptance-cases.json`; each task references its requirement
and case IDs. All seed statuses are not_started/not_run. Package checks validate
IDs/links/dependency order only; they do not execute product acceptance cases.

At execution, add actual test paths, commands, environment/source/artifact pins,
exit codes and evidence references. Preserve original stable IDs and negative
assertions. A requirement is verified only when the corresponding observable
behavior and required evidence tier are independently established. Mock/unit
results cannot satisfy a real Phase-1 process case.

Use `fault-cases.json`, `user-journeys.md`, `benchmarks.json` and the accessibility
checklist to extend negative/end-to-end coverage. Native runtime scope remains
separate from browser/service evidence. Any changed implementation/artifact marks
affected evidence stale. Never delete blocked items to make coverage 100 percent.
