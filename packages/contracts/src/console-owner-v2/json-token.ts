import { isRawJsonNumber, type BoundedJsonObject, type BoundedJsonValue, type RawJsonNumber } from "./lossless-json";
import { MAX_U64, MAX_U64_DECIMAL_DIGITS, refuseJson } from "./wire-scalars";

export type JsonObject = BoundedJsonObject;

const nativeBigInt = BigInt;

export function expectClosedObject(value: BoundedJsonValue, fields: readonly string[]): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object" || isNumber(value)) refuseJson();
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) refuseJson();
  return value as JsonObject;
}

export function expectString(value: BoundedJsonValue): string {
  if (typeof value !== "string") refuseJson();
  return value;
}

export function expectU64(value: BoundedJsonValue): bigint {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !isNumber(value)) refuseJson();
  const token = (value as RawJsonNumber).token;
  if (token.length === 0 || token.length > MAX_U64_DECIMAL_DIGITS) refuseJson();
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    if (code < 0x30 || code > 0x39) refuseJson();
  }
  const parsed = nativeBigInt(token);
  if (parsed > MAX_U64) refuseJson();
  return parsed;
}

function isNumber(value: object): value is RawJsonNumber {
  return isRawJsonNumber(value);
}
