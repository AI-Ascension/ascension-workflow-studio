import Ajv2020 from "ajv/dist/2020.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";

import memorySchema from "../../../contracts/accepted/effective-limits/context-memory-capabilities.schema.json";
import sessionSchema from "../../../contracts/accepted/effective-limits/provider-session-capabilities.schema.json";
import sessionV1Schema from "../../../contracts/accepted/effective-limits/provider-session-capabilities-v1.schema.json";
import pins from "../../../contracts/effective-limits.lock.json";
import type { MemoryCapabilitiesV3, ProviderSessionCapabilitiesV1, ProviderSessionCapabilitiesV3 } from "./effective-limit-types";

export type { MemoryCapabilitiesV3, ProviderSessionCapabilitiesV1, ProviderSessionCapabilitiesV3 };
type V3 = MemoryCapabilitiesV3 | ProviderSessionCapabilitiesV3;
const ajv = new Ajv2020({ strict: false });
const memoryValid = ajv.compile(memorySchema);
const sessionValid = ajv.compile(sessionSchema);
const sessionV1Valid = ajv.compile(sessionV1Schema);

/** Preserve the existing legacy memory projection. It conveys no executable limits.
 * Some served v1 owners omit advisory fields, so keep their established reader. */
export const MemoryCapabilitiesV1Schema = z.object({
  schema: z.literal("ascension.context-memory.capabilities.v1"),
  product_phase: z.literal(3),
  scope: z.object({
    project_id: z.string().min(1).max(128), run_id: z.string().min(1).max(128),
    episode_id: z.string().min(1).max(128), agent_id: z.string().min(1).max(128),
  }).strict(),
  enabled: z.boolean(),
  supported_operations: z.array(z.string()).max(32),
  phase2_approval_required: z.boolean(),
  persistent_provider_sessions: z.boolean(),
  provider_side_compaction: z.boolean(),
  hidden_reasoning_access: z.boolean(),
  direct_game_dispatch: z.boolean(),
}).passthrough();

export const MemoryCapabilitiesV3Schema = z.custom<MemoryCapabilitiesV3>((value) => memoryValid(value));
export const ProviderSessionCapabilitiesV3Schema = z.custom<ProviderSessionCapabilitiesV3>((value) => sessionValid(value));
export const MemoryCapabilitiesSchema = z.union([MemoryCapabilitiesV1Schema, MemoryCapabilitiesV3Schema]);
export type MemoryCapabilities = z.infer<typeof MemoryCapabilitiesSchema>;
export const ProviderSessionCapabilitiesSchema = z.union([
  z.custom<ProviderSessionCapabilitiesV1>((value) => sessionV1Valid(value)),
  ProviderSessionCapabilitiesV3Schema,
]);
export type ProviderSessionCapabilities = z.infer<typeof ProviderSessionCapabilitiesSchema>;
export type EffectiveCapabilities = MemoryCapabilities | ProviderSessionCapabilities;

export type EffectiveLimitReason = "effective_limit_exceeded" | "disabled" | "field_not_advertised"
  | "descriptor_stale" | "descriptor_tampered" | "profile_mismatch";
export type EffectiveLimit = {
  state: "available"; field: string; ceiling: number; descriptor: string;
  unit: "bytes" | "seconds" | "count";
} | { state: "unavailable"; reason: EffectiveLimitReason };

type Shape = { [key: string]: unknown; properties?: Record<string, Shape>; items?: Shape };
/** Producer digest is serde struct order, NOT sorted-key JSON. The pinned schema
 * property order matches the producer structs; original library vectors test this. */
function ordered(value: unknown, shape: Shape): unknown {
  if (Array.isArray(value)) return value.map((item) => ordered(item, shape.items ?? {}));
  if (value && typeof value === "object" && shape.properties) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(shape.properties).map(([key, child]) => [key, ordered(record[key], child)]));
  }
  return value;
}

function hash(value: string): string { return bytesToHex(sha256(new TextEncoder().encode(value))); }
function isMemory(value: V3): value is MemoryCapabilitiesV3 {
  return value.schema === "ascension.context-memory.capabilities.v3";
}
function policyDigest(surface: string): string | undefined {
  return pins.consumed_artifacts.find((entry) => entry.path.endsWith(`/${surface}-policy.schema.json`))?.sha256;
}

/** Structural parsing alone never authenticates executable capacity. The caller
 * obtains the descriptor through its scoped authenticated owner client. */
export function effectiveLimit(capabilities: EffectiveCapabilities, field: string): EffectiveLimit {
  if (capabilities.schema.endsWith(".v1")) return { state: "unavailable", reason: "field_not_advertised" };
  const candidate = capabilities as V3;
  const memory = isMemory(candidate);
  const valid = (memory ? MemoryCapabilitiesV3Schema : ProviderSessionCapabilitiesV3Schema).safeParse(candidate);
  if (!valid.success) return { state: "unavailable", reason: "descriptor_tampered" };
  const binding = candidate.binding;
  if (binding.policy_schema_sha256 !== policyDigest(memory ? "context-memory" : "provider-session")) {
    return { state: "unavailable", reason: "descriptor_stale" };
  }
  const unsigned = { ...candidate, binding: { ...binding, descriptor_sha256: "" } };
  if (hash(JSON.stringify(ordered(unsigned, memory ? memorySchema : sessionSchema))) !== binding.descriptor_sha256) {
    return { state: "unavailable", reason: "descriptor_tampered" };
  }
  if (isMemory(candidate)) {
    if (binding.adapter_revision_sha256 !== hash(binding.adapter_revision)) {
      return { state: "unavailable", reason: "descriptor_tampered" };
    }
    if (!candidate.enabled) return { state: "unavailable", reason: "disabled" };
  } else if (binding.model_revision !== candidate.native_version || binding.adapter_revision !== candidate.profile_id
    || binding.adapter_revision_sha256 !== candidate.profile_sha256) {
    return { state: "unavailable", reason: "profile_mismatch" };
  } else if (candidate.enabled_methods.some((method) => ![
    "initialize", "thread/start", "thread/read", "turn/start", "turn/interrupt", "thread/fork", "thread/compact/start",
  ].includes(method))) {
    // The v3 JSON pattern widens syntax; producer admission still denies
    // methods outside its fixed allowlist.
    return { state: "unavailable", reason: "descriptor_tampered" };
  }
  const limits = candidate.effective_limits as unknown as Record<string, unknown>;
  const ceiling = Object.hasOwn(limits, field) ? limits[field] : undefined;
  if (typeof ceiling !== "number") return { state: "unavailable", reason: "field_not_advertised" };
  return { state: "available", field, ceiling, descriptor: binding.descriptor_sha256,
    unit: field.includes("byte") ? "bytes" : field.endsWith("seconds") ? "seconds" : "count" };
}

/** A preview is valid only for the freshly fetched current owner descriptor.
 * This is client-side preflight; the authoritative owner still admits dispatch. */
export function admitEffectiveLimit(current: EffectiveCapabilities, preview: EffectiveLimit, requested: number): EffectiveLimit {
  if (preview.state === "unavailable") return preview;
  const next = effectiveLimit(current, preview.field);
  if (next.state === "unavailable") return next;
  if (next.descriptor !== preview.descriptor || next.ceiling !== preview.ceiling) {
    return { state: "unavailable", reason: "descriptor_stale" };
  }
  if (!Number.isSafeInteger(requested) || requested < 0 || requested > next.ceiling) {
    return { state: "unavailable", reason: "effective_limit_exceeded" };
  }
  return next;
}

export function effectiveLimitDisclosure(capabilities: EffectiveCapabilities, field: string): string {
  const limit = effectiveLimit(capabilities, field);
  return limit.state === "available"
    ? `Owner effective ${field}: ${limit.ceiling} ${limit.unit}. Token accounting is unavailable.`
    : `Effective input limits unavailable (${limit.reason}).`;
}
