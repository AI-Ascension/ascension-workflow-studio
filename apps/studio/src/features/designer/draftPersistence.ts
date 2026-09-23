import { type DraftRecord, type LayoutSidecar } from "@studio/contracts";
import { type SemanticDocument } from "@studio/document";

/**
 * Owner-backed draft identity and state surfaced by the designer surface.
 * `state` is the user-visible persistence status; `server` carries the owner
 * revision when it must be reviewed (loaded or reported conflicts).
 */
export interface DraftState {
  revision: number;
  etag: string;
  state: "saved" | "saving" | "offline" | "conflict";
  message: string;
  server?: DraftRecord;
}

export function draftIdFor(definitionId: string): string {
  return `draft.${definitionId}`;
}

export function initialDraftState(): DraftState {
  return { revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." };
}

/**
 * Structural identity of a persisted candidate. Two states with the same key
 * are byte-equivalent and do not need another owner save.
 */
export function valueKey(nextDocument: SemanticDocument, nextLayout: LayoutSidecar): string {
  return JSON.stringify({ document: nextDocument, layout: nextLayout });
}
