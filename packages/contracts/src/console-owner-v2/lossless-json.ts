import {
  MAX_OWNER_JSON_BODY_BYTES,
  MAX_OWNER_JSON_DEPTH,
  OwnerIdentityCandidateError,
  refuseJson,
} from "./wire-scalars";

export interface RawJsonNumber {
  readonly kind: "raw-json-number";
  readonly token: string;
}

const rawJsonNumbers = new WeakSet<object>();

export function isRawJsonNumber(value: object): value is RawJsonNumber {
  return rawJsonNumbers.has(value);
}

export interface BoundedJsonObject {
  readonly [key: string]: BoundedJsonValue;
}

export type BoundedJsonValue =
  | null
  | boolean
  | string
  | RawJsonNumber
  | readonly BoundedJsonValue[]
  | BoundedJsonObject;

export interface BoundedJsonDocument {
  readonly value: BoundedJsonValue;
  readonly byteLength: number;
  readonly nodeCount: number;
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const apply = Reflect.apply;
const NativeUint8Array = Uint8Array;
const NativeTextDecoder = TextDecoder;
const decodeUtf8 = TextDecoder.prototype.decode;
const nativeJsonParse = JSON.parse;

/** Parse strict bounded JSON from a fresh owned copy; concurrent shared writes are not atomic. */
export function parseBoundedJson(input: Uint8Array): BoundedJsonDocument {
  const owned = copyBoundedInput(input);
  let text: string;
  try {
    const decoder = new NativeTextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    text = apply(decodeUtf8, decoder, [owned]) as string;
  } catch {
    refuseJson();
  }
  const scanner = new JsonScanner(text, owned.byteLength + 1);
  const value = scanner.document();
  return Object.freeze({ value, byteLength: owned.byteLength, nodeCount: scanner.nodes });
}

function copyBoundedInput(input: Uint8Array): Uint8Array {
  if (!typedArrayByteLength || !typedArrayByteOffset || !typedArrayBuffer || !typedArrayTag) refuseJson();
  let byteLength: number;
  let byteOffset: number;
  let backing: ArrayBufferLike;
  try {
    if (apply(typedArrayTag, input, []) !== "Uint8Array") refuseJson();
    byteLength = apply(typedArrayByteLength, input, []) as number;
    if (byteLength > MAX_OWNER_JSON_BODY_BYTES) {
      throw new OwnerIdentityCandidateError({ kind: "out_of_bounds", field: "json_body" });
    }
    byteOffset = apply(typedArrayByteOffset, input, []) as number;
    backing = apply(typedArrayBuffer, input, []) as ArrayBufferLike;
  } catch (error) {
    if (error instanceof OwnerIdentityCandidateError) throw error;
    refuseJson();
  }
  try {
    const source = new NativeUint8Array(backing, byteOffset, byteLength);
    const owned = new NativeUint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 1) owned[index] = source[index] ?? 0;
    if ((apply(typedArrayByteLength, source, []) as number) !== byteLength) refuseJson();
    return owned;
  } catch (error) {
    if (error instanceof OwnerIdentityCandidateError) throw error;
    refuseJson();
  }
}

class JsonScanner {
  private index = 0;
  nodes = 0;

  constructor(private readonly text: string, private readonly maxNodes: number) {}

  document(): BoundedJsonValue {
    this.space();
    const value = this.value(1);
    this.space();
    if (this.index !== this.text.length) refuseJson();
    return value;
  }

  private value(depth: number): BoundedJsonValue {
    this.nodes += 1;
    if (depth > MAX_OWNER_JSON_DEPTH || this.nodes > this.maxNodes) {
      throw new OwnerIdentityCandidateError({ kind: "out_of_bounds", field: "json_shape" });
    }
    const code = this.text.charCodeAt(this.index);
    if (code === 0x22) return this.string();
    if (code === 0x7b) return this.object(depth);
    if (code === 0x5b) return this.array(depth);
    if (code === 0x74) return this.literal("true", true);
    if (code === 0x66) return this.literal("false", false);
    if (code === 0x6e) return this.literal("null", null);
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return this.number();
    return refuseJson();
  }

  private object(depth: number): BoundedJsonObject {
    this.index += 1;
    this.space();
    const result: Record<string, BoundedJsonValue> = Object.create(null) as Record<string, BoundedJsonValue>;
    const keys = new Set<string>();
    if (this.take(0x7d)) return Object.freeze(result);
    while (true) {
      if (this.text.charCodeAt(this.index) !== 0x22) refuseJson();
      const key = this.string();
      if (keys.has(key)) refuseJson();
      keys.add(key);
      this.space();
      if (!this.take(0x3a)) refuseJson();
      this.space();
      result[key] = this.value(depth + 1);
      this.space();
      if (this.take(0x7d)) return Object.freeze(result);
      if (!this.take(0x2c)) refuseJson();
      this.space();
    }
  }

  private array(depth: number): readonly BoundedJsonValue[] {
    this.index += 1;
    this.space();
    const result: BoundedJsonValue[] = [];
    if (this.take(0x5d)) return Object.freeze(result);
    while (true) {
      result.push(this.value(depth + 1));
      this.space();
      if (this.take(0x5d)) return Object.freeze(result);
      if (!this.take(0x2c)) refuseJson();
      this.space();
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        let decoded: unknown;
        try {
          decoded = apply(nativeJsonParse, JSON, [this.text.slice(start, this.index)]);
        } catch {
          return refuseJson();
        }
        if (typeof decoded !== "string" || !isScalarString(decoded)) refuseJson();
        return decoded;
      }
      if (code < 0x20) refuseJson();
      if (code === 0x5c) {
        this.index += 1;
        const escaped = this.text.charCodeAt(this.index);
        if (escaped === 0x75) {
          for (let offset = 1; offset <= 4; offset += 1) {
            if (!isHex(this.text.charCodeAt(this.index + offset))) refuseJson();
          }
          this.index += 5;
          continue;
        }
        if (![0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74].includes(escaped)) refuseJson();
      }
      this.index += 1;
    }
    return refuseJson();
  }

  private number(): RawJsonNumber {
    const start = this.index;
    if (this.take(0x2d) && this.index >= this.text.length) refuseJson();
    if (this.take(0x30)) {
      if (isDigit(this.text.charCodeAt(this.index))) refuseJson();
    } else {
      const first = this.text.charCodeAt(this.index);
      if (first < 0x31 || first > 0x39) refuseJson();
      this.index += 1;
      while (isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    }
    if (this.take(0x2e)) {
      if (!isDigit(this.text.charCodeAt(this.index))) refuseJson();
      while (isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    }
    const exponent = this.text.charCodeAt(this.index);
    if (exponent === 0x65 || exponent === 0x45) {
      this.index += 1;
      if (this.text.charCodeAt(this.index) === 0x2b || this.text.charCodeAt(this.index) === 0x2d) this.index += 1;
      if (!isDigit(this.text.charCodeAt(this.index))) refuseJson();
      while (isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    }
    const number = Object.freeze({ kind: "raw-json-number" as const, token: this.text.slice(start, this.index) });
    rawJsonNumbers.add(number);
    return number;
  }

  private literal<T extends null | boolean>(token: string, value: T): T {
    if (!this.text.startsWith(token, this.index)) refuseJson();
    this.index += token.length;
    return value;
  }

  private space(): void {
    while ([0x20, 0x09, 0x0a, 0x0d].includes(this.text.charCodeAt(this.index))) this.index += 1;
  }

  private take(code: number): boolean {
    if (this.text.charCodeAt(this.index) !== code) return false;
    this.index += 1;
    return true;
  }
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isHex(code: number): boolean {
  return isDigit(code) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

function isScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
