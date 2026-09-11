import type { JsonObject, JsonValue } from "@studio/contracts";

export type GuardTruthValue = "true" | "false" | "unknown";

export type GuardValueType = "null" | "boolean" | "integer" | "text";

export type GuardFieldMap = Record<string, JsonValue | undefined>;

export interface GuardOperandSpec {
  name: string;
  type: string;
}

export interface GuardOperatorSpec {
  kind: string;
  label: string;
  summary: string;
  operands: GuardOperandSpec[];
}

/**
 * Registered guard operators, mirroring the owner's admitted expression set
 * (`crates/harness/src/workflow/node.rs`). Presentation only: the owner remains
 * authoritative and the preview below never executes game code.
 */
export const GUARD_OPERATORS: GuardOperatorSpec[] = [
  { kind: "exists", label: "exists", summary: "true when the observation is present", operands: [{ name: "field", type: "observation field" }] },
  { kind: "field", label: "field", summary: "truthiness of a field value (unknown when absent)", operands: [{ name: "field", type: "observation field" }] },
  { kind: "literal", label: "literal", summary: "constant truthiness", operands: [{ name: "value", type: "null | boolean | integer | text" }] },
  { kind: "equal", label: "equal", summary: "field equals literal", operands: [{ name: "left", type: "observation field" }, { name: "right", type: "null | boolean | integer | text" }] },
  { kind: "not_equal", label: "not_equal", summary: "field differs from literal", operands: [{ name: "left", type: "observation field" }, { name: "right", type: "null | boolean | integer | text" }] },
  { kind: "less", label: "less", summary: "field is less than literal", operands: [{ name: "left", type: "observation field" }, { name: "right", type: "integer | text" }] },
  { kind: "less_or_equal", label: "less_or_equal", summary: "field is at most literal", operands: [{ name: "left", type: "observation field" }, { name: "right", type: "integer | text" }] },
  { kind: "greater", label: "greater", summary: "field is greater than literal", operands: [{ name: "left", type: "observation field" }, { name: "right", type: "integer | text" }] },
  { kind: "greater_or_equal", label: "greater_or_equal", summary: "field is at least literal", operands: [{ name: "left", type: "observation field" }, { name: "right", type: "integer | text" }] },
  { kind: "in", label: "in", summary: "field matches one admitted literal", operands: [{ name: "field", type: "observation field" }, { name: "values", type: "null | boolean | integer | text list" }] },
  { kind: "add", label: "add", summary: "integer field plus offset is non-zero", operands: [{ name: "left", type: "integer observation field" }, { name: "right", type: "integer offset" }] },
];

const REGISTERED_OPERATOR_KINDS = new Set(GUARD_OPERATORS.map((operator) => operator.kind));

const COMPARISON_OPERATORS = new Set(["equal", "not_equal", "less", "less_or_equal", "greater", "greater_or_equal"]);

export function isRegisteredGuardOperator(kind: unknown): kind is string {
  return typeof kind === "string" && REGISTERED_OPERATOR_KINDS.has(kind);
}

export function guardOperatorSpec(kind: string): GuardOperatorSpec | undefined {
  return GUARD_OPERATORS.find((operator) => operator.kind === kind);
}

type DecodedValue = { present: true; value: null | boolean | number | string } | { present: false };

const ABSENT: DecodedValue = { present: false };

/** Decodes the owner's tagged `guard_value` shape; bare primitives remain readable. */
function decodeGuardValue(raw: unknown): DecodedValue {
  if (raw === null || typeof raw === "boolean" || typeof raw === "number" || typeof raw === "string") {
    return typeof raw === "number" && !Number.isFinite(raw) ? ABSENT : { present: true, value: raw };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return ABSENT;
  const tag = (raw as JsonObject).kind;
  if (tag === "null") return { present: true, value: null };
  const value = (raw as JsonObject).value;
  if (tag === "boolean") return typeof value === "boolean" ? { present: true, value } : ABSENT;
  if (tag === "integer") return typeof value === "number" && Number.isSafeInteger(value) ? { present: true, value } : ABSENT;
  if (tag === "text") return typeof value === "string" ? { present: true, value } : ABSENT;
  return ABSENT;
}

export function encodeGuardValue(kind: GuardValueType, value: null | boolean | number | string): JsonObject {
  if (kind === "null") return { kind: "null" };
  return { kind, value: value as JsonValue };
}

function decodeField(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function isGuardPrimitive(value: JsonValue | undefined): value is null | boolean | number | string {
  return value === undefined
    ? false
    : value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
}

function truthFromValue(value: null | boolean | number | string): GuardTruthValue {
  if (value === null) return "false";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return value === 0 ? "false" : "true";
  return value.length === 0 ? "false" : "true";
}

function compareValues(left: null | boolean | number | string, right: null | boolean | number | string): number | undefined {
  if (left === null && right === null) return 0;
  if (typeof left === "boolean" && typeof right === "boolean") return left === right ? 0 : left ? 1 : -1;
  if (typeof left === "number" && typeof right === "number") return left === right ? 0 : left < right ? -1 : 1;
  if (typeof left === "string" && typeof right === "string") return left === right ? 0 : left < right ? -1 : 1;
  return undefined;
}

function and(left: GuardTruthValue, right: GuardTruthValue): GuardTruthValue {
  if (left === "false" || right === "false") return "false";
  if (left === "unknown" || right === "unknown") return "unknown";
  return "true";
}

function or(left: GuardTruthValue, right: GuardTruthValue): GuardTruthValue {
  if (left === "true" || right === "true") return "true";
  if (left === "unknown" || right === "unknown") return "unknown";
  return "false";
}

const MAX_GUARD_DEPTH = 32;

/**
 * Pure, client-side evaluation of the owner's admitted guard semantics.
 * Advisory only: it never schedules, executes, or treats unknown as safe.
 */
export function evaluateGuard(expression: unknown, fields: GuardFieldMap = {}, depth = 0): GuardTruthValue {
  if (depth > MAX_GUARD_DEPTH) return "unknown";
  if (typeof expression !== "object" || expression === null || Array.isArray(expression)) return "unknown";
  const node = expression as JsonObject;
  const kind = node.kind;
  const value = node.value;
  switch (kind) {
    case "literal": {
      const decoded = decodeGuardValue(value);
      return decoded.present ? truthFromValue(decoded.value) : "unknown";
    }
    case "field": {
      const field = decodeField(value);
      if (field === undefined) return "unknown";
      const current = fields[field];
      return isGuardPrimitive(current) ? truthFromValue(current) : "unknown";
    }
    case "exists": {
      const field = decodeField(value);
      if (field === undefined) return "unknown";
      return fields[field] === undefined ? "false" : "true";
    }
    case "equal":
    case "not_equal":
    case "less":
    case "less_or_equal":
    case "greater":
    case "greater_or_equal": {
      const operand = value as JsonObject | undefined;
      if (operand === undefined || Array.isArray(operand)) return "unknown";
      const left = decodeField(operand.left);
      const right = decodeGuardValue(operand.right);
      if (left === undefined || !right.present) return "unknown";
      const current = fields[left];
      if (!isGuardPrimitive(current)) return "unknown";
      const ordering = compareValues(current, right.value);
      if (ordering === undefined) return "unknown";
      if (kind === "equal") return ordering === 0 ? "true" : "false";
      if (kind === "not_equal") return ordering === 0 ? "false" : "true";
      if (kind === "less") return ordering < 0 ? "true" : "false";
      if (kind === "less_or_equal") return ordering <= 0 ? "true" : "false";
      if (kind === "greater") return ordering > 0 ? "true" : "false";
      return ordering >= 0 ? "true" : "false";
    }
    case "and": {
      if (!Array.isArray(value) || value.length === 0) return "unknown";
      let result: GuardTruthValue = "true";
      for (const child of value) {
        result = and(result, evaluateGuard(child, fields, depth + 1));
        if (result === "false") break;
      }
      return result;
    }
    case "or": {
      if (!Array.isArray(value) || value.length === 0) return "unknown";
      let result: GuardTruthValue = "false";
      for (const child of value) {
        result = or(result, evaluateGuard(child, fields, depth + 1));
        if (result === "true") break;
      }
      return result;
    }
    case "not": {
      const inner = evaluateGuard(value, fields, depth + 1);
      return inner === "unknown" ? "unknown" : inner === "true" ? "false" : "true";
    }
    case "in": {
      const operand = value as JsonObject | undefined;
      if (operand === undefined || Array.isArray(operand)) return "unknown";
      const field = decodeField(operand.field);
      if (field === undefined) return "unknown";
      const current = fields[field];
      if (!isGuardPrimitive(current)) return "unknown";
      if (!Array.isArray(operand.values)) return "unknown";
      for (const candidate of operand.values) {
        const decoded = decodeGuardValue(candidate);
        if (decoded.present && decoded.value === current) return "true";
      }
      return "false";
    }
    case "add": {
      const operand = value as JsonObject | undefined;
      if (operand === undefined || Array.isArray(operand)) return "unknown";
      const field = decodeField(operand.left);
      const offset = operand.right;
      if (field === undefined || typeof offset !== "number" || !Number.isSafeInteger(offset)) return "unknown";
      const current = fields[field];
      if (typeof current !== "number" || !Number.isSafeInteger(current)) return "unknown";
      const sum = current + offset;
      if (!Number.isSafeInteger(sum)) return "unknown";
      return sum !== 0 ? "true" : "false";
    }
    default:
      return "unknown";
  }
}

/** Field ids referenced by an expression, in first-seen order. */
export function guardReferencedFields(expression: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > MAX_GUARD_DEPTH || typeof node !== "object" || node === null || Array.isArray(node)) return;
    const object = node as JsonObject;
    const kind = object.kind;
    const value = object.value;
    if (kind === "field" || kind === "exists") {
      const field = decodeField(value);
      if (field !== undefined && !found.includes(field)) found.push(field);
      return;
    }
    if (typeof kind === "string" && COMPARISON_OPERATORS.has(kind)) {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const left = decodeField((value as JsonObject).left);
        if (left !== undefined && !found.includes(left)) found.push(left);
      }
      return;
    }
    if (kind === "in") {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const field = decodeField((value as JsonObject).field);
        if (field !== undefined && !found.includes(field)) found.push(field);
      }
      return;
    }
    if (kind === "add") {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const left = decodeField((value as JsonObject).left);
        if (left !== undefined && !found.includes(left)) found.push(left);
      }
      return;
    }
    if ((kind === "and" || kind === "or") && Array.isArray(value)) {
      value.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (kind === "not") visit(value, depth + 1);
  };
  visit(expression, 0);
  return found;
}
