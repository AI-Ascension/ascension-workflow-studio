#!/usr/bin/env node
// Stub `studio-provider-policy-production-fixture`. The stack seeds the policy
// store through this helper and reads one JSON metadata line from stdout.
const mode = process.argv[2];
const runId = "run-live-owner-stub";
const requestId = "request-live-owner-stub";

if (mode === "bootstrap") {
  process.stdout.write(
    `${JSON.stringify({
      run_id: runId,
      request_id: requestId,
      instance_id: `instance-${runId}`,
      definition_digest: "d".repeat(64),
      provider_policy_config: { schema: "live-owner-stub.v1" },
    })}\n`,
  );
  process.exit(0);
}

if (mode === "verify") {
  process.stdout.write(`${JSON.stringify({ verified: true, run_id: runId })}\n`);
  process.exit(0);
}

process.stderr.write(`live-owner policy fixture stub: unknown mode ${mode}\n`);
process.exit(2);
