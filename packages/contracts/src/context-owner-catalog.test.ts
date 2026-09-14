import { describe, expect, it } from "vitest";
import fixture from "../../../contracts/accepted/context-control/catalog-conformance.json";
import { parseBoundedJson } from "@studio/document";
import { ContextOwnerCatalogSchema, ContextOwnerLimitsSchema, contextBindingsFromOwnerCatalog } from "./context-owner-catalog";
import { catalogFixture, reseal } from "./context-owner-catalog.test-fixtures";

describe("producer context-control catalogs", () => {
  it("admits all four unmodified producer catalogs and their usable projections", () => {
    for (const row of fixture.catalogs) {
      const parsed = ContextOwnerCatalogSchema.parse(row.catalog);
      expect(Boolean(contextBindingsFromOwnerCatalog(parsed)?.length)).toBe(row.binding_usable);
    }
  });
  it("matches all 25 producer boundary outcomes independently of digest rejection", () => {
    for (const row of fixture.descriptor_boundaries) {
      const limits = { ...catalogFixture().descriptors[0].effective_limits, [row.field]: row.value };
      expect(ContextOwnerLimitsSchema.safeParse(limits).success, `${row.field}/${row.case}`).toBe(row.descriptor_result === "valid");
    }
  });
  it("uses typed key order but preserves array order and every limit's digest", () => {
    const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value;
    expect(ContextOwnerCatalogSchema.safeParse(reverseKeys(catalogFixture())).success).toBe(true);
    for (const field of Object.keys(catalogFixture().descriptors[0].effective_limits)) {
      const c = catalogFixture();
      (c.descriptors[0].effective_limits as unknown as Record<string, number>)[field] -= 1;
      expect(ContextOwnerCatalogSchema.safeParse(c).success).toBe(false);
    }
    const c = catalogFixture();
    c.descriptors[0].node_kinds.reverse();
    expect(ContextOwnerCatalogSchema.safeParse(c).success).toBe(false);
    expect(ContextOwnerCatalogSchema.safeParse(reseal(c)).success).toBe(true);
    c.catalog_digest = "0".repeat(64);
    expect(ContextOwnerCatalogSchema.safeParse(c).success).toBe(false);
  });
  it("rejects missing and unknown keys in every nested object", () => {
    const base = catalogFixture();
    base.descriptors[0].sources = [{ source_id: "source.v1", version: 1, digest: "a".repeat(64) }];
    reseal(base);
    const paths = [[], ["descriptors", 0], ["descriptors", 0, "sources", 0],
      ["descriptors", 0, "effective_limits"], ["descriptors", 0, "continuity"], ["descriptors", 0, "grants"]];
    for (const path of paths) {
      for (const mutation of ["missing", "unknown"]) {
        const copy = structuredClone(base);
        let object: unknown = copy;
        for (const key of path) object = (object as Record<string | number, unknown>)[key];
        const record = object as Record<string, unknown>;
        if (mutation === "missing") delete record[Object.keys(record)[0]];
        else record.unlimited = true;
        expect(ContextOwnerCatalogSchema.safeParse(copy).success).toBe(false);
      }
    }
  });
  it("rejects duplicate identities, operations, kinds, bad grants and unsafe versions even when resealed", () => {
    const mutations = [
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors.push(structuredClone(c.descriptors[0])); },
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors[0].node_kinds = ["decide", "decide"]; },
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors[0].operations = ["pause", "pause"]; },
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors[0].sources = Array(2).fill({ source_id: "source", version: 1, digest: "a".repeat(64) }); },
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors[0].grants = { metadata_read: false, content_read: true, edit: false, control: false }; },
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors[0].grants.edit = true; },
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors[0].grants.control = true; },
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors[0].version = Number.MAX_SAFE_INTEGER + 1; },
      (c: ReturnType<typeof catalogFixture>) => { c.owner_id = "owner/foreign"; },
      (c: ReturnType<typeof catalogFixture>) => { c.descriptors[0].node_kinds = Array.from({ length: 17 }, (_, i) => `kind${i}`); },
    ];
    for (const mutate of mutations) {
      const c = catalogFixture(); mutate(c);
      expect(ContextOwnerCatalogSchema.safeParse(reseal(c)).success).toBe(false);
    }
  });
  it("keeps unavailable and ambiguous descriptors inspectable without usable selections", () => {
    for (const state of ["disabled", "denied", "unattached", "stale", "unsupported"] as const) {
      const c = catalogFixture(); c.descriptors[0].state = state;
      expect(contextBindingsFromOwnerCatalog(reseal(c))).toEqual([]);
    }
    const c = catalogFixture();
    c.descriptors.push({ ...structuredClone(c.descriptors[0]), binding_id: "another.binding" });
    expect(contextBindingsFromOwnerCatalog(reseal(c))).toEqual([]);
    c.descriptors[1].state = "disabled";
    expect(contextBindingsFromOwnerCatalog(reseal(c))).toHaveLength(1);
    c.descriptors[0].node_kinds = ["future_kind"];
    expect(contextBindingsFromOwnerCatalog(reseal(c))).toEqual([]);
  });
  it("fits maximal representable producer-shaped metadata within existing parser guards", () => {
    const c = catalogFixture();
    c.owner_id = "x".repeat(128); c.owner_version = "v".repeat(128);
    const d = c.descriptors[0];
    d.context_ref = "c".repeat(128); d.version = Number.MAX_SAFE_INTEGER;
    d.node_kinds = Array.from({ length: 16 }, (_, i) => `k${i}`.padEnd(128, "x"));
    d.sources = Array.from({ length: 16 }, (_, i) => ({ source_id: `s${i}`.padEnd(128, "x"), version: Number.MAX_SAFE_INTEGER, digest: "f".repeat(64) }));
    d.operations = ["include_item", "exclude_item", "pin_item", "unpin_item", "put_note", "remove_note", "set_objective", "restore_configuration", "pause", "commit", "resume"];
    d.grants = { metadata_read: true, content_read: true, edit: true, control: true };
    c.descriptors = Array.from({ length: 128 }, (_, i) => ({ ...structuredClone(d), binding_id: `b${i}`.padEnd(128, "x") }));
    const raw = JSON.stringify(reseal(c));
    expect(new TextEncoder().encode(raw).length).toBeLessThan(2 * 1024 * 1024);
    expect(ContextOwnerCatalogSchema.safeParse(parseBoundedJson(raw)).success).toBe(true);
  });
});
