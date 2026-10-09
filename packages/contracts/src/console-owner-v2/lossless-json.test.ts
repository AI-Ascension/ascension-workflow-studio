import { describe, expect, it } from "vitest";
import { parseBoundedJson, type RawJsonNumber } from "./lossless-json";
import { MAX_OWNER_JSON_BODY_BYTES, OwnerIdentityCandidateError } from "./wire-scalars";

const encoder = new TextEncoder();

function parse(text: string) {
  return parseBoundedJson(encoder.encode(text));
}

function expectRefusal(bytes: Uint8Array, kind: string, field?: string): void {
  try {
    parseBoundedJson(bytes);
    throw new Error("expected bounded JSON refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(OwnerIdentityCandidateError);
    const refusal = (error as OwnerIdentityCandidateError).refusal;
    expect(refusal.kind).toBe(kind);
    if (field !== undefined) expect("field" in refusal ? refusal.field : undefined).toBe(field);
  }
}

describe("bounded lossless JSON candidate parser", () => {
  it("retains integer spelling rather than converting through Number", () => {
    const token = "18446744073709551615";
    const parsed = parse(`{"n":${token}}`);
    const number = (parsed.value as Readonly<Record<string, RawJsonNumber>>).n;
    expect(number).toEqual({ kind: "raw-json-number", token });
    expect(parsed.nodeCount).toBe(2);
  });

  it("rejects duplicate keys after JSON escape decoding", () => {
    expectRefusal(encoder.encode('{"subject":1,"\\u0073ubject":2}'), "json_decoding");
  });

  it("enforces strict JSON, trailing-data, fatal UTF-8, and preserved BOM behavior", () => {
    for (const text of ["", "{", "[1,]", "01", "{} {}", "\uFEFF{}"])
      expectRefusal(encoder.encode(text), "json_decoding");
    expectRefusal(Uint8Array.from([0xc3, 0x28]), "json_decoding");
  });

  it("rejects escaped lone surrogates while retaining valid Unicode pairs", () => {
    expectRefusal(encoder.encode('{"x":"\\ud800"}'), "json_decoding");
    expectRefusal(encoder.encode('{"x":"middle\\ud800tail"}'), "json_decoding");
    expectRefusal(encoder.encode('{"x":"\\udc00"}'), "json_decoding");
    expect((parse('{"x":"\\ud83d\\ude00"}').value as Readonly<Record<string, string>>).x).toBe("😀");
  });

  it("enforces depth 32 and the byte-derived node ceiling", () => {
    const nested = (depth: number) => `${"[".repeat(depth - 1)}0${"]".repeat(depth - 1)}`;
    expect(parse(nested(32)).nodeCount).toBe(32);
    expectRefusal(encoder.encode(nested(33)), "out_of_bounds", "json_shape");
    const dense = `[${Array.from({ length: 2_000 }, () => "0").join(",")}]`;
    const result = parse(dense);
    expect(result.nodeCount).toBe(2_001);
    expect(result.nodeCount).toBeLessThanOrEqual(result.byteLength + 1);
  });

  it("checks the actual intrinsic view length before decoding or copying", () => {
    const exactLimit = new Uint8Array(MAX_OWNER_JSON_BODY_BYTES).fill(0x20);
    exactLimit.set(encoder.encode("null"));
    const exact = parseBoundedJson(exactLimit);
    expect(exact.byteLength).toBe(MAX_OWNER_JSON_BODY_BYTES);
    expect(exact.nodeCount).toBe(1);
    const oversized = new Uint8Array(MAX_OWNER_JSON_BODY_BYTES + 1).fill(0x20);
    Object.defineProperty(oversized, "byteLength", { get: () => 1 });
    expectRefusal(oversized, "out_of_bounds", "json_body");
    const input = encoder.encode('{"n":7}');
    Object.defineProperty(input, "byteLength", { get: () => 1 });
    const parsed = parseBoundedJson(input);
    expect(parsed.byteLength).toBe(7);
    expect(parsed.nodeCount).toBe(2);
  });

  it("does not invoke caller-overridden byte access, subarray, or iterator hooks", () => {
    const input = new Uint8Array(encoder.encode('{"n":9}'));
    let hooks = 0;
    Object.defineProperties(input, {
      byteLength: { get: () => { hooks += 1; throw new Error("caller getter"); } },
      subarray: { value: () => { hooks += 1; throw new Error("caller method"); } },
      [Symbol.iterator]: { value: () => { hooks += 1; throw new Error("caller iterator"); } },
    });
    const parsed = parseBoundedJson(input);
    expect(parsed.byteLength).toBe(7);
    expect(hooks).toBe(0);
  });

  it("keeps parsed values detached from later caller buffer changes", () => {
    const input = encoder.encode('{"n":11}');
    const parsed = parseBoundedJson(input);
    input.fill(0);
    const object = parsed.value as Readonly<Record<string, RawJsonNumber>>;
    expect(object.n.token).toBe("11");
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(object.n)).toBe(true);
  });
});
