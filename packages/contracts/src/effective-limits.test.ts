import { describe, expect, it } from "vitest";
import fixtures from "../../../contracts/accepted/effective-limits/producer.json";
import {
  admitEffectiveLimit, effectiveLimit, effectiveLimitDisclosure,
  MemoryCapabilitiesSchema, ProviderSessionCapabilitiesSchema,
} from "./effective-limits";

describe("pinned original harness-library synthetic capability vectors", () => {
  for (const [surface, vectors, schema] of [
    ["memory", fixtures.memory, MemoryCapabilitiesSchema],
    ["session", fixtures.session, ProviderSessionCapabilitiesSchema],
  ] as const) {
    for (const vector of vectors) {
      it(`${surface}/${vector.name} matches every producer executable row and boundary`, () => {
        if (!vector.producer_descriptor_valid) {
          expect(schema.safeParse(vector.descriptor).success).toBe(false);
          return;
        }
        const descriptor = schema.parse(vector.descriptor);
        for (const row of vector.record.rows) {
          const preview = effectiveLimit(descriptor, row.field);
          if (!vector.record.enabled) {
            expect(preview).toEqual({ state: "unavailable", reason: "disabled" });
          } else {
            expect(preview).toMatchObject({ state: "available", ceiling: row.executable_ceiling });
            expect(admitEffectiveLimit(descriptor, preview, 1)).toEqual(preview);
            expect(admitEffectiveLimit(descriptor, preview, row.executable_ceiling)).toEqual(preview);
            expect(admitEffectiveLimit(descriptor, preview, row.executable_ceiling + 1))
              .toEqual({ state: "unavailable", reason: "effective_limit_exceeded" });
          }
        }
      });
    }
    it(`${surface} rejects tampering, missing v3 fields and stale policy pins`, () => {
      const original = structuredClone(vectors[0].descriptor);
      const tampered = structuredClone(original);
      tampered.effective_limits.max_candidates = 1;
      expect(effectiveLimit(schema.parse(tampered), "max_candidates"))
        .toEqual({ state: "unavailable", reason: "descriptor_tampered" });
      const missing = { ...original, binding: undefined };
      expect(schema.safeParse(missing).success).toBe(false);
      const extra = { ...original, secret: "must-not-pass" };
      expect(schema.safeParse(extra).success).toBe(false);
      original.binding.policy_schema_sha256 = "0".repeat(64);
      expect(effectiveLimit(schema.parse(original), "max_candidates"))
        .toEqual({ state: "unavailable", reason: "descriptor_stale" });
    });
    it(`${surface} invalidates previews after descriptor/profile change`, () => {
      const first = schema.parse(vectors[0].descriptor);
      const second = schema.parse(vectors[1].descriptor);
      expect(admitEffectiveLimit(second, effectiveLimit(first, "max_candidates"), 1))
        .toEqual({ state: "unavailable", reason: "descriptor_stale" });
      expect(effectiveLimit(first, "unadvertised_tokens"))
        .toEqual({ state: "unavailable", reason: "field_not_advertised" });
      expect(effectiveLimit(first, "__proto__"))
        .toEqual({ state: "unavailable", reason: "field_not_advertised" });
    });
  }

  it("does not infer executable limits from legacy v1 or portable maxima", () => {
    const { binding: _binding, effective_limits: _limits, ...legacy } = fixtures.memory[0].descriptor;
    const descriptor = MemoryCapabilitiesSchema.parse({ ...legacy, schema: "ascension.context-memory.capabilities.v1" });
    expect(effectiveLimit(descriptor, "optional_byte_budget"))
      .toEqual({ state: "unavailable", reason: "field_not_advertised" });
    const restricted = MemoryCapabilitiesSchema.parse(fixtures.memory[1].descriptor);
    expect(effectiveLimitDisclosure(restricted, "optional_byte_budget")).toContain("bytes. Token accounting is unavailable.");
    expect(admitEffectiveLimit(restricted, effectiveLimit(restricted, "optional_byte_budget"), 8192).state).toBe("unavailable");
  });

  it("retains strict legacy provider encryption/method guards while v3 reads widening", () => {
    const { binding: _binding, effective_limits: _limits, ...legacy } = fixtures.session[0].descriptor;
    const descriptor = { ...legacy, schema: "ascension.provider-session.capabilities.v1",
      enabled_methods: ["initialize"], hardening: { ...legacy.hardening, encrypted_state: true } };
    const parsed = ProviderSessionCapabilitiesSchema.parse(descriptor);
    expect(effectiveLimit(parsed, "max_prepared_bytes").state).toBe("unavailable");
    expect(ProviderSessionCapabilitiesSchema.safeParse({ ...descriptor, hardening: { ...descriptor.hardening, encrypted_state: false } }).success).toBe(false);
    expect(ProviderSessionCapabilitiesSchema.safeParse({ ...descriptor, enabled_methods: ["thread/read"] }).success).toBe(false);
    expect(ProviderSessionCapabilitiesSchema.safeParse(fixtures.session[0].descriptor).success).toBe(true);
  });
});
