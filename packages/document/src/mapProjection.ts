import { z } from "zod";

const identity = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:/-]+$/);
const nullableIdentity = identity.nullable();
const boundedText = z.string().max(256).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Text must not contain control characters");

export const MapProjectionNodeSchema = z.object({
  id: identity,
  row: z.number().int().min(-32768).max(32767),
  column: z.number().int().min(-32768).max(32767),
  category: z.enum(["unknown", "start", "monster", "elite", "rest", "shop", "event", "treasure", "boss", "other"]),
  visited: z.boolean(),
}).strict();

export const MapProjectionEdgeSchema = z.object({ from: identity, to: identity }).strict();

export const MapProjectionBindingSchema = z.object({
  graph_node_id: identity,
  host_action_id: z.string().min(1).max(512).regex(/^[A-Za-z0-9._:/-]+$/),
  action: z.object({ kind: z.literal("select_map_node"), node_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:/-]+$/) }).strict(),
}).strict();

export const MapProjectionPositionSchema = z.union([
  z.object({ kind: z.literal("pre_start") }).strict(),
  z.object({ kind: z.literal("current"), node_id: identity }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);

/**
 * Bounded read-only `visible-map-v1` projection. It is a different graph from the
 * orchestration graph; the Studio renders it as inert data only.
 */
export const VisibleMapProjectionSchema = z.object({
  state_id: identity,
  generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  schema_version: z.literal("visible-map-v1"),
  projection_version: identity,
  game_build: boundedText,
  mod_version: boundedText,
  map_instance_id: nullableIdentity,
  act_id: z.number().int().min(0).max(4294967295).nullable(),
  scope_id: nullableIdentity,
  availability: z.enum(["available", "unavailable", "not_observable", "unsupported"]),
  completeness: z.enum(["complete", "incomplete", "unknown"]),
  freshness: z.enum(["current", "historical"]),
  reason: boundedText.nullable(),
  nodes: z.array(MapProjectionNodeSchema).max(256),
  edges: z.array(MapProjectionEdgeSchema).max(1024),
  position: MapProjectionPositionSchema,
  history: z.array(identity).max(256),
  terminal_node_ids: z.array(identity).max(256),
  bindings: z.array(MapProjectionBindingSchema).max(256),
}).strict();
export type VisibleMapProjection = z.infer<typeof VisibleMapProjectionSchema>;

export interface MapProjectionSupport {
  state: "available" | "stale" | "unavailable";
  availability: VisibleMapProjection["availability"];
  freshness: VisibleMapProjection["freshness"];
  message: string;
}

/** Support/freshness is derived from the projection's own labels, never inferred. */
export function mapProjectionSupport(projection: VisibleMapProjection): MapProjectionSupport {
  if (projection.availability !== "available") {
    return { state: "unavailable", availability: projection.availability, freshness: projection.freshness, message: projection.reason ?? `Map projection availability is ${projection.availability}.` };
  }
  if (projection.freshness !== "current") {
    return { state: "stale", availability: projection.availability, freshness: projection.freshness, message: projection.reason ?? "Map projection is historical and may not reflect the current game." };
  }
  return { state: "available", availability: projection.availability, freshness: projection.freshness, message: "Current host-provided map projection." };
}

export interface MapPinnedIdentity {
  schemaVersion: string;
  projectionVersion: string;
  generation: number;
  mapInstanceId: string | null;
  actId: number | null;
  scopeId: string | null;
  stateId: string;
}

export function pinnedMapIdentity(projection: VisibleMapProjection): MapPinnedIdentity {
  return {
    schemaVersion: projection.schema_version,
    projectionVersion: projection.projection_version,
    generation: projection.generation,
    mapInstanceId: projection.map_instance_id,
    actId: projection.act_id,
    scopeId: projection.scope_id,
    stateId: projection.state_id,
  };
}
