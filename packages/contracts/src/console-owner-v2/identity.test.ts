import { describe, expect, it } from "vitest";
import {
  decodeOwnerIdentityCorrelationV2Candidate,
  isOwnerIdentityCandidateRefusal,
} from "./identity";
import { OwnerIdentityCandidateError, type CandidateRefusal } from "./wire-scalars";

type RawFields = Record<string, string>;
type PartName = "console" | "scope" | "harness";
type Parts = {
  console?: RawFields;
  scope?: RawFields;
  harness?: RawFields;
  root?: RawFields;
  omit?: Partial<Record<PartName, string[]>>;
};
const quote = (value: string) => JSON.stringify(value);

function overridePart(part: PartName, fields: RawFields): Parts {
  if (part === "console") return { console: fields };
  if (part === "scope") return { scope: fields };
  return { harness: fields };
}

function omitPart(part: PartName, field: string): Parts {
  return { omit: { [part]: [field] } };
}

function object(fields: RawFields): string {
  return `{${Object.entries(fields).map(([key, value]) => `${quote(key)}:${value}`).join(",")}}`;
}

function merged(base: RawFields, override?: RawFields, omitted?: string[]): RawFields {
  const fields = { ...base, ...override };
  for (const key of omitted ?? []) delete fields[key];
  return fields;
}

function defaults(): Required<Pick<Parts, "console" | "scope" | "harness">> {
  return {
    console: {
      issuer: quote("https://identity.example/tenant/one"), subject: quote("user-1"),
      audience: quote("https://console.example/api"), credential_id: quote("credential/provider/one"),
      grant_id: quote("grant-1"), grant_generation: "3", grant_expires_at: "2000000000",
    },
    scope: { project_id: quote("project-test"), run_id: quote("run-test"), episode_id: quote("episode-test"), agent_id: quote("agent-test") },
    harness: {
      actor_subject: quote("user-1"), owner_id: quote("owner-test"), workflow_run_id: quote("run-test"),
      credential_reference_id: quote("broker://harness/user-1"), credential_expires_at: "2000000000",
    },
  };
}

function identityJson(parts: Parts = {}): string {
  const base = defaults();
  const root: RawFields = {
    console: object(merged(base.console, parts.console, parts.omit?.console)),
    console_scope: object(merged(base.scope, parts.scope, parts.omit?.scope)),
    harness: object(merged(base.harness, parts.harness, parts.omit?.harness)),
    ...parts.root,
  };
  return object(root);
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function refusal(text: string): CandidateRefusal {
  const error = caught(text);
  if (isOwnerIdentityCandidateRefusal(error)) return error.refusal;
  throw error;
}

function caught(text: string): unknown {
  try {
    decodeOwnerIdentityCorrelationV2Candidate(bytes(text));
  } catch (error) {
    return error;
  }
  throw new Error("expected identity candidate refusal");
}

function expectDecodeRefusal(text: string): void {
  expect(refusal(text)).toEqual({ kind: "json_decoding" });
}

describe("Console OwnerIdentityCorrelationV2 candidate", () => {
  it("decodes the exact closed top-level correlation and returns frozen untrusted data", () => {
    const result = decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson()));
    expect(result.kind).toBe("untrusted_owner_identity_correlation_v2");
    expect(result.trust).toBe("untrusted");
    expect(result.authority).toBe("none");
    expect(result.identity.console.issuer).toBe("https://identity.example/tenant/one");
    expect(result.identity.console_scope.run_id).toBe("run-test");
    expect(result.identity.harness.credential_reference_id).toBe("broker://harness/user-1");
    expect(result.identity.console.grant_generation).toBe(3n);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.identity.console)).toBe(true);
    expect(Object.keys(result)).toEqual(["kind", "trust", "authority", "identity"]);
  });

  it("rejects missing, unknown, and wrong-type fields at every closed object level", () => {
    const base = defaults();
    for (const key of ["console", "console_scope", "harness"]) {
      const root: RawFields = { console: object(base.console), console_scope: object(base.scope), harness: object(base.harness) };
      delete root[key];
      expectDecodeRefusal(object(root));
      expectDecodeRefusal(identityJson({ root: { [key]: "null" } }));
    }
    expectDecodeRefusal(identityJson({ root: { extra: "true" } }));
    for (const [part, fields] of [["console", base.console], ["scope", base.scope], ["harness", base.harness]] as const) {
      for (const key of Object.keys(fields)) {
        expectDecodeRefusal(identityJson(omitPart(part, key)));
        const wrong = { [key]: key.endsWith("generation") || key.endsWith("expires_at") ? quote("7") : "true" };
        expectDecodeRefusal(identityJson(overridePart(part, wrong)));
      }
      expectDecodeRefusal(identityJson(overridePart(part, { unknown_identity_field: "true" })));
    }
    expectDecodeRefusal(identityJson({ console: { grant_generation: object({ kind: quote("raw-json-number"), token: quote("3") }) } }));
  });

  it("keeps subject and workflow-run joins distinct and reports the source error labels", () => {
    expect(refusal(identityJson({ harness: { actor_subject: quote("other-user") } }))).toEqual({
      kind: "correlation_mismatch", field: "actor_subject",
    });
    expect(refusal(identityJson({ harness: { workflow_run_id: quote("other-run") } }))).toEqual({
      kind: "correlation_mismatch", field: "workflow_run_id",
    });
    expect(refusal(identityJson({ console: { grant_expires_at: "0" } }))).toEqual({
      kind: "invalid_value", field: "console_grant_lifetime",
    });
    expect(refusal(identityJson({ harness: { credential_expires_at: "0" } }))).toEqual({
      kind: "invalid_value", field: "harness_credential_expiry",
    });
    expect(decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({ console: { grant_generation: "0" } })))
      .identity.console.grant_generation).toBe(0n);
    expect(refusal(identityJson({ console: { issuer: quote(""), subject: quote("_invalid") } }))).toEqual({
      kind: "invalid_identifier", field: "console_issuer",
    });
    expect(refusal(identityJson({ console: { grant_expires_at: "0" }, scope: { project_id: quote("_invalid") } }))).toEqual({
      kind: "invalid_value", field: "console_grant_lifetime",
    });
  });

  it("retains distinct full-u64 tokens on either side of JavaScript safe-integer precision", () => {
    const low = decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({ console: {
      grant_generation: "9007199254740992", grant_expires_at: "18446744073709551614",
    } })));
    const high = decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({ console: {
      grant_generation: "9007199254740993", grant_expires_at: "18446744073709551615",
    } })));
    expect(low.identity.console.grant_generation).toBe(9_007_199_254_740_992n);
    expect(high.identity.console.grant_generation).toBe(9_007_199_254_740_993n);
    expect(low.identity.console.grant_expires_at).toBe(18_446_744_073_709_551_614n);
    expect(high.identity.console.grant_expires_at).toBe(18_446_744_073_709_551_615n);
    const harnessMaximum = decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({ harness: {
      credential_expires_at: "18446744073709551615",
    } })));
    expect(harnessMaximum.identity.harness.credential_expires_at).toBe(18_446_744_073_709_551_615n);
  });

  it("accepts u64 zero only for grant generation and rejects overflow or non-integer tokens", () => {
    expect(decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({ console: {
      grant_generation: "0", grant_expires_at: "1",
    }, harness: { credential_expires_at: "1" } }))).identity.console.grant_generation).toBe(0n);
    for (const token of ["18446744073709551616", "999999999999999999999999999999999999"])
      expectDecodeRefusal(identityJson({ console: { grant_generation: token } }));
    for (const token of ["1.0", "1e0", "-1", "-0", "+1", "01"])
      expectDecodeRefusal(identityJson({ console: { grant_generation: token } }));
    expectDecodeRefusal(identityJson({ console: { grant_generation: "true" } }));
    expectDecodeRefusal(identityJson({ harness: { credential_expires_at: "18446744073709551616" } }));
  });

  it("applies Console UTF-8 correlation and ASCII identifier boundaries without normalization", () => {
    for (const field of ["issuer", "audience", "credential_id"] as const) {
      expect(decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({ console: { [field]: quote("é".repeat(256)) } })))).toBeDefined();
      expect(refusal(identityJson({ console: { [field]: quote("é".repeat(257)) } }))).toEqual({ kind: "invalid_identifier", field: `console_${field === "credential_id" ? "credential_id" : field}` });
    }
    expect(decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({ harness: {
      credential_reference_id: quote("é".repeat(256)),
    } })))).toBeDefined();
    expect(refusal(identityJson({ harness: { credential_reference_id: quote("€".repeat(171)) } }))).toEqual({
      kind: "invalid_identifier", field: "harness_credential_reference_id",
    });
    for (const control of ["\u0009", "\u0085"])
      expect(refusal(identityJson({ console: { issuer: quote(`x${control}y`) } }))).toMatchObject({ kind: "invalid_identifier" });
    const maximumIdentifier = "A".repeat(128);
    expect(decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({
      console: { subject: quote(maximumIdentifier) }, harness: { actor_subject: quote(maximumIdentifier) },
    })))).toBeDefined();
    expect(refusal(identityJson({ console: { subject: quote("A".repeat(129)) } }))).toEqual({ kind: "invalid_identifier", field: "console_subject" });
    expect(refusal(identityJson({ scope: { project_id: quote("_bad-start") } }))).toEqual({ kind: "invalid_identifier", field: "console_project_id" });
    expect(refusal(identityJson({ scope: { agent_id: quote("非ASCII") } }))).toEqual({ kind: "invalid_identifier", field: "console_agent_id" });
  });

  it("rejects lone UTF-16 surrogates during JSON decoding and retains valid pairs", () => {
    for (const issuer of ["\ud800", `middle\ud800tail`, "\udc00"]) {
      expectDecodeRefusal(identityJson({ console: { issuer: quote(issuer) } }));
    }
    const validPair = decodeOwnerIdentityCorrelationV2Candidate(bytes(identityJson({
      console: { issuer: quote("tenant😀identity") },
    })));
    expect(validPair.identity.console.issuer).toBe("tenant😀identity");
  });

  it("keeps fixed refusals redacted and separates JSON/serde failures from semantic labels", () => {
    const secret = "private user value 42";
    const semantic = refusal(identityJson({ console: { subject: quote(secret) } }));
    expect(semantic).toEqual({ kind: "invalid_identifier", field: "console_subject" });
    expect(JSON.stringify(semantic)).not.toContain(secret);
    expect(refusal(`{"console":${secret}}`)).toEqual({ kind: "json_decoding" });
    const semanticError = caught(identityJson({ console: { subject: quote(secret) } })) as OwnerIdentityCandidateError;
    expect(semanticError.message).not.toContain(secret);
    expect(JSON.stringify(semanticError.refusal)).not.toContain(secret);
  });
});
