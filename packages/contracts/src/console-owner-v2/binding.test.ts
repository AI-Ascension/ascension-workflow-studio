import { describe, expect, it } from "vitest";
import { decodeContextOwnerBindingV1Candidate } from "./binding";
import { OwnerIdentityCandidateError, type CandidateRefusal } from "./wire-scalars";

type RawFields = Record<string, string>;
type Part = "root" | "boundary" | "grants" | "continuity";
type Overrides = {
  readonly root?: RawFields;
  readonly boundary?: RawFields;
  readonly grants?: RawFields;
  readonly continuity?: RawFields;
  readonly omit?: Partial<Record<Part, readonly string[]>>;
};

const quote = (value: string) => JSON.stringify(value);
const encoder = new TextEncoder();
const schema = "ascension.context-control.owner-binding.v1";
const rootFields: readonly string[] = [
  "schema_version", "owner_id", "owner_version", "invocation_id", "binding_id", "binding_version",
  "binding_digest", "context_ref", "instance_id", "node_kind", "state", "workflow_run_id",
  "definition_digest", "graph_id", "node_id", "node_execution_id", "boundary", "lease_epoch",
  "snapshot_id", "approved_revision_id", "plan_epoch", "grants", "continuity",
];
const boundaryFields: readonly string[] = [
  "run_id", "episode_id", "agent_id", "state_id", "generation", "observation_sha256", "catalog_sha256",
  "adapter_revision", "model_revision", "configuration_sha256", "output_schema_sha256", "controller_epoch",
  "gate_epoch", "control_version",
];
const grantsFields = ["metadata_read", "content_read", "edit", "control"] as const;
const continuityFields = ["survives_controller_restart", "receipt_recovery", "provider_session_continuity"] as const;
const rootU64 = ["binding_version", "lease_epoch", "plan_epoch"] as const;
const boundaryU64 = ["generation", "controller_epoch", "gate_epoch", "control_version"] as const;

function defaults(): Required<Pick<Overrides, "root" | "boundary" | "grants" | "continuity">> {
  return {
    root: {
      schema_version: quote(schema), owner_id: quote("owner-1"), owner_version: quote("v1"),
      invocation_id: quote("invocation-1"), binding_id: quote("binding-1"), binding_version: "1",
      binding_digest: quote("a".repeat(64)), context_ref: quote("context-1"), instance_id: quote("instance-1"),
      node_kind: quote("agent"), state: quote("available"), workflow_run_id: quote("run-1"),
      definition_digest: quote("b".repeat(64)), graph_id: quote("graph-1"), node_id: quote("node-1"),
      node_execution_id: quote("execution-1"), lease_epoch: "2", snapshot_id: quote("snapshot-1"),
      approved_revision_id: quote("revision-1"), plan_epoch: "3",
    },
    boundary: {
      run_id: quote("run-1"), episode_id: quote("episode-1"), agent_id: quote("agent-1"),
      state_id: quote("state-1"), generation: "4", observation_sha256: quote("c".repeat(64)),
      catalog_sha256: quote("d".repeat(64)), adapter_revision: quote("adapter-1"),
      model_revision: quote("model-1"), configuration_sha256: quote("e".repeat(64)),
      output_schema_sha256: quote("f".repeat(64)), controller_epoch: "5", gate_epoch: "6", control_version: "7",
    },
    grants: { metadata_read: "true", content_read: "false", edit: "false", control: "false" },
    continuity: {
      survives_controller_restart: "true", receipt_recovery: "false", provider_session_continuity: "true",
    },
  };
}

function object(fields: RawFields): string {
  return `{${Object.entries(fields).map(([key, value]) => `${quote(key)}:${value}`).join(",")}}`;
}

function merged(base: RawFields, additions: RawFields | undefined, omitted: readonly string[] | undefined): RawFields {
  const fields = { ...base, ...additions };
  for (const key of omitted ?? []) delete fields[key];
  return fields;
}

function bindingJson(overrides: Overrides = {}): string {
  const base = defaults();
  const boundary = object(merged(base.boundary, overrides.boundary, overrides.omit?.boundary));
  const grants = object(merged(base.grants, overrides.grants, overrides.omit?.grants));
  const continuity = object(merged(base.continuity, overrides.continuity, overrides.omit?.continuity));
  const root = { ...base.root, boundary, grants, continuity, ...overrides.root };
  return object(merged(root, undefined, overrides.omit?.root));
}

function omit(part: Part, field: string): Overrides {
  if (part === "root") return { omit: { root: [field] } };
  if (part === "boundary") return { omit: { boundary: [field] } };
  if (part === "grants") return { omit: { grants: [field] } };
  return { omit: { continuity: [field] } };
}

function addUnknown(part: Part): Overrides {
  if (part === "root") return { root: { unexpected: "true" } };
  if (part === "boundary") return { boundary: { unexpected: "true" } };
  if (part === "grants") return { grants: { unexpected: "true" } };
  return { continuity: { unexpected: "true" } };
}

function wrongType(part: Part, field: string): Overrides {
  const value = part === "root" && ["boundary", "grants", "continuity"].includes(field)
    ? "null"
    : part === "root" && field === "state"
      ? quote("unknown-state")
    : part === "root" && rootU64.some((key) => key === field)
        ? quote("1")
        : part === "boundary" && boundaryU64.some((key) => key === field)
          ? quote("1")
          : part === "grants" || part === "continuity"
            ? quote("true")
            : "true";
  if (part === "root") return { root: { [field]: value } };
  if (part === "boundary") return { boundary: { [field]: value } };
  if (part === "grants") return { grants: { [field]: value } };
  return { continuity: { [field]: value } };
}

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function caught(text: string): unknown {
  try {
    decodeContextOwnerBindingV1Candidate(bytes(text));
  } catch (error) {
    return error;
  }
  throw new Error("expected owner binding refusal");
}

function refusal(text: string): CandidateRefusal {
  const error = caught(text);
  if (error instanceof OwnerIdentityCandidateError) return error.refusal;
  throw error;
}

function expectJsonRefusal(text: string): void {
  expect(refusal(text)).toEqual({ kind: "json_decoding" });
}

describe("Console ContextOwnerBinding candidate", () => {
  it("decodes the exact 23-field binding and returns deeply frozen untrusted data", () => {
    const result = decodeContextOwnerBindingV1Candidate(bytes(bindingJson()));
    expect(result.kind).toBe("untrusted_context_owner_binding_v1");
    expect(result.trust).toBe("untrusted");
    expect(result.authority).toBe("none");
    expect(Object.keys(result.binding)).toEqual(rootFields);
    expect(result.binding.state).toBe("available");
    expect(result.binding.boundary.run_id).toBe("run-1");
    expect(result.binding.grants.metadata_read).toBe(true);
    expect(result.binding.continuity.receipt_recovery).toBe(false);
    for (const value of [result, result.binding, result.binding.boundary, result.binding.grants, result.binding.continuity]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("requires every outer and nested field and rejects unknown keys at every level", () => {
    const nestedFields: readonly [Part, readonly string[]][] = [
      ["root", rootFields], ["boundary", boundaryFields], ["grants", grantsFields], ["continuity", continuityFields],
    ];
    for (const [part, fields] of nestedFields) {
      for (const field of fields) expectJsonRefusal(bindingJson(omit(part, field)));
      expectJsonRefusal(bindingJson(addUnknown(part)));
    }
  });

  it("rejects every wrong outer and nested JSON type, including unknown state variants", () => {
    const nestedFields: readonly [Part, readonly string[]][] = [
      ["root", rootFields], ["boundary", boundaryFields], ["grants", grantsFields], ["continuity", continuityFields],
    ];
    for (const [part, fields] of nestedFields) {
      for (const field of fields) expectJsonRefusal(bindingJson(wrongType(part, field)));
    }
  });

  it("finishes all nested typed decoding before schema, identifier, or boundary semantics", () => {
    expectJsonRefusal(bindingJson({
      root: { schema_version: quote("unsupported"), owner_id: quote("_invalid") },
      boundary: { run_id: quote("_invalid") },
      continuity: { provider_session_continuity: quote("true") },
    }));
    expectJsonRefusal(bindingJson({
      root: { owner_id: quote("_invalid") },
      boundary: { run_id: quote("_invalid") },
      grants: { control: quote("false") },
      omit: { continuity: ["receipt_recovery"] },
    }));
  });

  it("checks the fixed schema before semantic binding fields without echoing caller text", () => {
    expect(refusal(bindingJson({
      root: { schema_version: quote("caller-private-schema"), owner_id: quote("_invalid") },
      boundary: { run_id: quote("_invalid") },
      grants: { metadata_read: "false", content_read: "true" },
    }))).toEqual({ kind: "unsupported_schema", expected: schema });
    const error = caught(bindingJson({ root: { schema_version: quote("caller-private-schema") } })) as OwnerIdentityCandidateError;
    expect(error.message).not.toContain("caller-private-schema");
    expect(JSON.stringify(error.refusal)).not.toContain("caller-private-schema");
    const secretId = "private owner value";
    const identifierError = caught(bindingJson({ root: { owner_id: quote(secretId) } })) as OwnerIdentityCandidateError;
    expect(identifierError).toBeInstanceOf(OwnerIdentityCandidateError);
    expect(identifierError.refusal).toEqual({ kind: "invalid_identifier", field: "binding_owner_id" });
    expect(identifierError.message).not.toContain(secretId);
    expect(JSON.stringify(identifierError.refusal)).not.toContain(secretId);
  });

  it("validates all thirteen identifiers in Console order before digests and nested semantics", () => {
    const cases = [
      ["owner_id", "binding_owner_id"], ["owner_version", "binding_owner_version"],
      ["invocation_id", "binding_invocation_id"], ["binding_id", "binding_id"],
      ["context_ref", "binding_context_ref"], ["instance_id", "binding_instance_id"],
      ["node_kind", "binding_node_kind"], ["workflow_run_id", "binding_run_id"],
      ["graph_id", "binding_graph_id"], ["node_id", "binding_node_id"],
      ["node_execution_id", "binding_node_execution_id"], ["snapshot_id", "binding_snapshot_id"],
      ["approved_revision_id", "binding_approved_revision_id"],
    ] as const;
    for (const [key, label] of cases) {
      expect(refusal(bindingJson({ root: { [key]: quote("_bad") } }))).toEqual({ kind: "invalid_identifier", field: label });
    }
    expect(refusal(bindingJson({
      root: { owner_id: quote("_bad"), owner_version: quote("_bad"), binding_digest: quote("invalid") },
      boundary: { run_id: quote("_bad") },
    }))).toEqual({ kind: "invalid_identifier", field: "binding_owner_id" });
  });

  it("checks the two outer digests before nested boundary, grants, and final correlations", () => {
    expect(refusal(bindingJson({
      root: { binding_digest: quote("invalid"), definition_digest: quote("invalid") },
      boundary: { run_id: quote("_bad") },
    }))).toEqual({ kind: "invalid_digest", field: "binding_digest" });
    expect(refusal(bindingJson({ root: { definition_digest: quote("invalid") } }))).toEqual({
      kind: "invalid_digest", field: "binding_definition_digest",
    });
    expect(refusal(bindingJson({
      boundary: { run_id: quote("_bad") }, grants: { content_read: "true" },
    }))).toEqual({ kind: "invalid_identifier", field: "boundary_run_id" });
    expect(refusal(bindingJson({
      root: { binding_version: "0" },
      grants: { metadata_read: "false", content_read: "true" },
    }))).toEqual({ kind: "invalid_value", field: "binding_grants" });
  });

  it("applies exactly the three grants constraints and final owner_binding conditions", () => {
    const invalidGrants: readonly RawFields[] = [
      { metadata_read: "false", content_read: "true" },
      { content_read: "false", edit: "true" },
      { metadata_read: "false", control: "true" },
    ];
    for (const grants of invalidGrants) {
      expect(refusal(bindingJson({ grants }))).toEqual({ kind: "invalid_value", field: "binding_grants" });
    }
    for (const field of ["binding_version", "lease_epoch", "plan_epoch"]) {
      expect(refusal(bindingJson({ root: { [field]: "0" } }))).toEqual({ kind: "invalid_value", field: "owner_binding" });
    }
    expect(refusal(bindingJson({ root: { workflow_run_id: quote("other-run") } }))).toEqual({
      kind: "invalid_value", field: "owner_binding",
    });
    const fullGrant = decodeContextOwnerBindingV1Candidate(bytes(bindingJson({
      grants: { metadata_read: "true", content_read: "true", edit: "true", control: "true" },
    })));
    expect(fullGrant.binding.grants).toEqual({ metadata_read: true, content_read: true, edit: true, control: true });
  });

  it("requires metadata_read for available state but does not infer other state constraints", () => {
    expect(refusal(bindingJson({ grants: { metadata_read: "false" } }))).toEqual({
      kind: "invalid_value", field: "owner_binding",
    });
    for (const state of ["disabled", "unattached", "denied", "stale", "unsupported"]) {
      expect(decodeContextOwnerBindingV1Candidate(bytes(bindingJson({
        root: { state: quote(state) }, grants: { metadata_read: "false" },
      })))).toBeDefined();
    }
  });

  it("preserves full-width numeric outer u64 fields and rejects invalid tokens", () => {
    for (const field of rootU64) {
      const high = decodeContextOwnerBindingV1Candidate(bytes(bindingJson({ root: { [field]: "9007199254740993" } })));
      const maximum = decodeContextOwnerBindingV1Candidate(bytes(bindingJson({ root: { [field]: "18446744073709551615" } })));
      expect(high.binding[field]).toBe(9_007_199_254_740_993n);
      expect(maximum.binding[field]).toBe(18_446_744_073_709_551_615n);
      expect(refusal(bindingJson({ root: { [field]: "0" } }))).toEqual({ kind: "invalid_value", field: "owner_binding" });
      for (const token of ["-0", "-1", "1.5", "1e0", "18446744073709551616", quote("1")]) {
        expectJsonRefusal(bindingJson({ root: { [field]: token } }));
      }
    }
  });

  it("retains every nested boundary u64 as exact bigint values through the full binding", () => {
    for (const field of boundaryU64) {
      const high = decodeContextOwnerBindingV1Candidate(bytes(bindingJson({
        boundary: { [field]: "9007199254740993" },
      })));
      const maximum = decodeContextOwnerBindingV1Candidate(bytes(bindingJson({
        boundary: { [field]: "18446744073709551615" },
      })));
      expect(high.binding.boundary[field]).toBe(9_007_199_254_740_993n);
      expect(maximum.binding.boundary[field]).toBe(18_446_744_073_709_551_615n);
    }
    for (const field of boundaryU64) {
      expect(refusal(bindingJson({ boundary: { [field]: "0" } }))).toEqual({
        kind: "invalid_value", field: "boundary_epoch",
      });
      for (const token of ["-0", "-1", "1.5", "1e0", "18446744073709551616", quote("1")]) {
        expectJsonRefusal(bindingJson({ boundary: { [field]: token } }));
      }
    }
  });
});
