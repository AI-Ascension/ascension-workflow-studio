import { describe, expect, it } from "vitest";

import { ApprovedLinkMappingSchema, resolveApprovedLink } from "./links";

const mapping = ApprovedLinkMappingSchema.parse({ id: "obs", label: "Observability", kind: "trace", origin: "https://obs.example", template: "https://obs.example/traces/{trace_id}" });

describe("approved trace/artifact links", () => {
  it("resolves an identifier through an approved mapping", () => {
    const result = resolveApprovedLink([mapping], "trace", "trace-123");
    expect(result.status).toBe("approved");
    if (result.status === "approved") expect(result.url).toBe("https://obs.example/traces/trace-123");
  });

  it("rejects a raw URL instead of proxying it", () => {
    const result = resolveApprovedLink([mapping], "trace", "https://evil.example/redirect");
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toContain("Raw URLs are not resolved");
  });

  it("rejects a protocol-relative redirect", () => {
    expect(resolveApprovedLink([mapping], "trace", "//evil.example/x").status).toBe("rejected");
  });

  it("reports unavailable when no approved mapping exists", () => {
    const result = resolveApprovedLink([], "artifact", "artifact-1");
    expect(result.status).toBe("unavailable");
  });

  it("rejects a template escaping the approved origin", () => {
    const escaping = ApprovedLinkMappingSchema.parse({ id: "bad", label: "Bad", kind: "run", origin: "https://obs.example", template: "https://evil.example/{run_id}" });
    expect(resolveApprovedLink([escaping], "run", "run-1").status).toBe("rejected");
  });

  it("does not accept an insecure origin", () => {
    expect(ApprovedLinkMappingSchema.safeParse({ id: "x", label: "x", kind: "run", origin: "http://obs.example", template: "http://obs.example/{run_id}" }).success).toBe(false);
  });
});
