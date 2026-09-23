import { LayoutSidecarSchema, type DraftRecord, type LayoutSidecar } from "@studio/contracts";
import { createLayout, type SemanticDocument } from "@studio/document";

/**
 * Owner-backed draft lifecycle shared by the persistence, publication and
 * conflict paths. Extracted from `DesignerView.tsx` (#152) without changing the
 * observable states, messages or serialized data.
 */
export type DraftLifecycle = "saved" | "saving" | "offline" | "conflict";

export interface DraftState {
  revision: number;
  etag: string;
  state: DraftLifecycle;
  message: string;
  server?: DraftRecord;
}

export function initialDraftState(): DraftState {
  return { revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." };
}

/**
 * Serialized identity of a semantic document plus its layout sidecar. Used to
 * decide whether the current candidate already matches the persisted revision.
 */
export function draftValueKey(nextDocument: SemanticDocument, nextLayout: LayoutSidecar): string {
  return JSON.stringify({ document: nextDocument, layout: nextLayout });
}

/**
 * The conflict view's remote layout: the owner-reported conflict layout when
 * present, otherwise the record's own layout, falling back to a pending layout.
 */
export function conflictRemoteLayoutFor(server: DraftRecord, remoteDocument: SemanticDocument): LayoutSidecar {
  const parsed = LayoutSidecarSchema.safeParse(server.conflict?.serverLayout ?? server.layout);
  return parsed.success ? parsed.data : createLayout(remoteDocument, "pending");
}
