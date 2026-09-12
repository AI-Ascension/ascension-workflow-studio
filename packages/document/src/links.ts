import { z } from "zod";

/**
 * An approved observability/artifact mapping. Only mappings configured by the
 * operator are used; event- or data-supplied URLs are never resolved directly.
 */
export const ApprovedLinkMappingSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(128),
  kind: z.enum(["run", "trace", "artifact"]),
  origin: z.string().url().refine((value) => value.startsWith("https://"), "Approved links must use https"),
  template: z.string().min(1).max(256),
}).strict();
export type ApprovedLinkMapping = z.infer<typeof ApprovedLinkMappingSchema>;

export type LinkResolution =
  | { status: "approved"; url: string; mapping: ApprovedLinkMapping }
  | { status: "unavailable"; reason: string }
  | { status: "rejected"; reason: string };

const PLACEHOLDER = /\{(run_id|trace_id|artifact_id)\}/g;
const UNSAFE_IDENTIFIER = /[\u0000-\u001f\u007f]/;
const ABSOLUTE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const PROTOCOL_RELATIVE = /^\/\//;

export function mappingFor(mappings: ApprovedLinkMapping[], kind: ApprovedLinkMapping["kind"]): ApprovedLinkMapping | undefined {
  return mappings.find((mapping) => mapping.kind === kind);
}

/**
 * Resolves an identifier through an approved mapping only. A raw URL, an
 * unsafe identifier, or a template that escapes the approved origin is
 * rejected instead of being followed — there is no general proxy link.
 */
export function resolveApprovedLink(mappings: ApprovedLinkMapping[], kind: ApprovedLinkMapping["kind"], identifier: string): LinkResolution {
  const trimmed = identifier.trim();
  if (trimmed.length === 0) return { status: "unavailable", reason: "No identifier to resolve." };
  if (UNSAFE_IDENTIFIER.test(trimmed)) return { status: "rejected", reason: "Identifier contains control characters." };
  if (ABSOLUTE_URL.test(trimmed) || PROTOCOL_RELATIVE.test(trimmed)) {
    return { status: "rejected", reason: "Raw URLs are not resolved; only approved mappings are used." };
  }
  const mapping = mappingFor(mappings, kind);
  if (!mapping) return { status: "unavailable", reason: `No approved ${kind} mapping is configured.` };
  if (mapping.template.includes("../")) return { status: "rejected", reason: "Approved template must not traverse paths." };
  const substituted = mapping.template.replace(PLACEHOLDER, (_match, token: string) => {
    if (token === "run_id") return encodeURIComponent(trimmed);
    return encodeURIComponent(trimmed);
  });
  let url: URL;
  try {
    url = new URL(substituted, mapping.origin);
  } catch {
    return { status: "rejected", reason: "Approved template did not produce a valid URL." };
  }
  if (url.origin !== new URL(mapping.origin).origin) {
    return { status: "rejected", reason: "Resolved URL escapes the approved origin." };
  }
  if (url.protocol !== "https:") return { status: "rejected", reason: "Resolved URL is not https." };
  return { status: "approved", url: url.toString(), mapping };
}
