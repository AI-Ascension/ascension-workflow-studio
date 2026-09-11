import { describe, expect, it } from "vitest";
import { catalogEntries, catalogUrl } from "./catalog";

const entry = {
  id: "linux-0fe208b7478a16e173a2204b15f90555",
  file: "linux-0fe208b7478a16e173a2204b15f90555.zip",
  bundle_sha256: "0be99128547f2fd4d6a4004dd1ca0a0261f7c376c2a64755d209365055d2a06a",
  semantic_digest: "93d2295b4ea4e6e8792693a84099e2dfe63042a813cf5e24dfcfb592e17f4c29",
  event_records: 6,
  accounting_records: 1,
  source: "sanitized_train_export",
};

describe("recording catalog", () => {
  it("accepts only a bounded same-origin catalog entry", () => {
    expect(catalogEntries({ entries: [entry] })).toEqual([entry]);
    expect(catalogUrl(entry)).toBe(`/recordings/${entry.file}`);
  });

  it("rejects an arbitrary artifact path", () => {
    expect(() => catalogEntries({ entries: [{ ...entry, file: "https://example.test/run.zip" }] })).toThrow("catalog");
  });
});
