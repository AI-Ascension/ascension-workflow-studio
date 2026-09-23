import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { type StudioClient } from "@studio/client";
import {
  LayoutSidecarSchema,
  type LayoutSidecar,
  type ValidateResponse,
} from "@studio/contracts";
import {
  cloneDocument,
  createLayout,
  mergeDocuments,
  mergeLayoutSidecars,
  semanticDigest,
  type EditGeneration,
  type SemanticDocument,
} from "@studio/document";

import { conflictRemoteLayoutFor, draftValueKey, type DraftState } from "./draftState";

export interface DraftConflictOptions {
  client: StudioClient;
  definitionId: string;
  draftId: string;
  draft: DraftState;
  setDraft: Dispatch<SetStateAction<DraftState>>;
  document: SemanticDocument;
  layout: LayoutSidecar;
  setDocument: Dispatch<SetStateAction<SemanticDocument>>;
  setLayout: Dispatch<SetStateAction<LayoutSidecar>>;
  syncFlowNodes: (nextDocument: SemanticDocument, nextLayout: LayoutSidecar, selected?: string[]) => void;
  resetHistory: (nextDocument: SemanticDocument, nextLayout: LayoutSidecar) => void;
  setRawText: (value: string) => void;
  commitSnapshot: (nextDocument: SemanticDocument, nextLayout: LayoutSidecar) => void;
  setConflictOpen: (open: boolean) => void;
  editGeneration: MutableRefObject<EditGeneration>;
  setValidationState: (state: "idle" | "running" | "valid" | "invalid" | "error") => void;
  setValidationMessage: (message: string) => void;
  setDiagnostics: (result: ValidateResponse | undefined) => void;
  mergeBaseRef: MutableRefObject<SemanticDocument>;
  mergeBaseLayoutRef: MutableRefObject<LayoutSidecar>;
  persistedKeyRef: MutableRefObject<string | undefined>;
}

export interface DraftConflict {
  conflictRemoteDocument?: SemanticDocument;
  conflictRemoteLayout?: LayoutSidecar;
  reloadRemoteConflict: () => void;
  saveLocalAsNew: () => Promise<void>;
  mergeConflict: () => Promise<void>;
  cancelConflictResolution: () => void;
}

/**
 * Three-way conflict resolution for a diverged draft: reload the remote
 * revision, keep the local candidate as a new draft, or apply a reviewed
 * non-overlapping merge. The local candidate is never discarded implicitly.
 */
export function useDraftConflict({
  client,
  definitionId,
  draftId,
  draft,
  setDraft,
  document,
  layout,
  setDocument,
  setLayout,
  syncFlowNodes,
  resetHistory,
  setRawText,
  commitSnapshot,
  setConflictOpen,
  editGeneration,
  setValidationState,
  setValidationMessage,
  setDiagnostics,
  mergeBaseRef,
  mergeBaseLayoutRef,
  persistedKeyRef,
}: DraftConflictOptions): DraftConflict {
  const conflictRemoteDocument = draft.server ? (draft.server.conflict?.serverDocument ?? draft.server.document) : undefined;
  const conflictRemoteLayout = conflictRemoteDocument
    ? conflictRemoteLayoutFor(draft.server as NonNullable<DraftState["server"]>, conflictRemoteDocument)
    : undefined;

  const reloadRemoteConflict = (): void => {
    const remote = draft.server?.conflict?.serverDocument;
    if (!remote || !draft.server) return;
    const remoteLayout = conflictRemoteLayoutFor(draft.server, remote);
    resetHistory(remote, remoteLayout);
    mergeBaseRef.current = cloneDocument(remote);
    mergeBaseLayoutRef.current = remoteLayout;
    setDocument(remote);
    setLayout(remoteLayout);
    syncFlowNodes(remote, remoteLayout);
    setRawText(JSON.stringify(remote, null, 2));
    persistedKeyRef.current = draftValueKey(remote, remoteLayout);
    setConflictOpen(true);
    setDraft({ revision: draft.server.revision, etag: draft.server.etag, state: "saved", message: "Remote revision loaded; local conflict was discarded." });
  };

  const saveLocalAsNew = async (): Promise<void> => {
    try {
      const saved = await client.saveDraft({ draftId: `draft.${definitionId}.copy.${Date.now()}`, definitionId, revision: 0, etag: "fixture-0", document, layout, clientMutationId: `studio.copy.${Date.now()}` });
      mergeBaseRef.current = cloneDocument(saved.document);
      const parsedLayout = LayoutSidecarSchema.safeParse(saved.layout);
      mergeBaseLayoutRef.current = parsedLayout.success ? parsedLayout.data : createLayout(saved.document, "pending");
      setDraft({ revision: saved.revision, etag: saved.etag, state: "saved", message: "Local candidate was saved as a new draft." });
    } catch (error: unknown) {
      setDraft((current) => ({ ...current, state: "conflict", message: error instanceof Error ? error.message : "Could not save a new draft; the local candidate is preserved." }));
    }
  };

  const cancelConflictResolution = (): void => {
    setConflictOpen(false);
  };

  const mergeConflict = async (): Promise<void> => {
    const server = draft.server;
    const remote = server?.conflict?.serverDocument;
    if (!remote || !server) return;
    const remoteLayout = conflictRemoteLayoutFor(server, remote);
    const semantic = mergeDocuments(mergeBaseRef.current, document, remote);
    if (semantic.conflicts.length > 0 || !semantic.document) {
      setValidationState("error");
      setValidationMessage(`Merge needs review at ${semantic.conflicts.map((conflict) => conflict.path).join(", ")}.`);
      return;
    }
    const neutral = (side: LayoutSidecar): LayoutSidecar => ({ ...side, semanticDigest: "merge" });
    const layoutMerge = mergeLayoutSidecars(neutral(mergeBaseLayoutRef.current), neutral(layout), neutral(remoteLayout));
    const nextLayout = layoutMerge.layout ?? layout;
    commitSnapshot(semantic.document, nextLayout);
    setConflictOpen(true);
    setDraft({ revision: server.revision, etag: server.etag, state: "saving", message: "Saving the reviewed merge against the owner revision…" });
    setValidationState("running");
    setValidationMessage("Merged candidate requires fresh validation.");
    setDiagnostics(undefined);
    const generation = editGeneration.current.current();
    try {
      const result = await client.validate(semantic.document);
      if (!editGeneration.current.isCurrent(generation)) return;
      setDiagnostics(result);
      setValidationState(result.valid ? "valid" : "invalid");
      setValidationMessage(result.valid
        ? `Merged semantic and layout candidates revalidated at ${result.definition_digest.slice(0, 12)}…`
        : `${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? "" : "s"} reported for the merged candidate.`);
      const mergedLayoutBinding = await semanticDigest(semantic.document);
      setLayout((current) => ({ ...current, semanticDigest: mergedLayoutBinding }));
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Merged candidate validation failed.");
    }
  };

  return {
    conflictRemoteDocument,
    conflictRemoteLayout,
    reloadRemoteConflict,
    saveLocalAsNew,
    mergeConflict,
    cancelConflictResolution,
  };
}
