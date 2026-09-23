import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";

import { LayoutSidecarSchema, type LayoutSidecar, type ValidateResponse } from "@studio/contracts";
import { CapabilityGateError, type StudioClient } from "@studio/client";
import {
  canonicalJson,
  cloneDocument,
  createLayout,
  mergeDocuments,
  mergeLayoutSidecars,
  semanticDigest,
  type EditGeneration,
  type SemanticDocument,
} from "@studio/document";

import { draftIdFor, initialDraftState, valueKey, type DraftState } from "./draftPersistence";

export type ValidationState = "idle" | "running" | "valid" | "invalid" | "error";

export interface ReplaceDocumentOptions {
  /** Focus the document's entry graph (used when hydrating an owner draft). */
  focusEntryGraph: boolean;
  /** Mirror the replaced document into the raw JSON surface. */
  updateRawText: boolean;
}

/**
 * Editor operations the draft controller needs from the designer surface.
 * Implementations must be referentially stable so the load effect keeps its
 * original `[client, draftId]` dependencies.
 */
export interface DraftPersistenceBridge {
  /** Replace the editor document/layout from an owner response, resetting history. */
  replaceDocument(nextDocument: SemanticDocument, nextLayout: LayoutSidecar, options: ReplaceDocumentOptions): void;
  /** Commit a resolved merge through the normal history path. */
  commitSnapshot(nextDocument: SemanticDocument, nextLayout: LayoutSidecar): void;
  /** Replace the layout sidecar (used to bind a fresh semantic digest). */
  setLayout: Dispatch<SetStateAction<LayoutSidecar>>;
  /** Report validation state/message owned by the designer surface. */
  reportValidation(state: ValidationState, message: string): void;
  /** Replace the latest owner validation response. */
  setDiagnostics: Dispatch<SetStateAction<ValidateResponse | undefined>>;
  /** Monotonic edit generation used to reject obsolete async results. */
  editGeneration: MutableRefObject<EditGeneration>;
}

export interface DraftPersistenceOptions {
  client: StudioClient;
  definitionId: string;
  initialDocument: SemanticDocument;
  initialRawText?: string;
  document: SemanticDocument;
  layout: LayoutSidecar;
  /** True while an archival import suspends autosave and publication writes. */
  suspended: boolean;
  bridge: DraftPersistenceBridge;
}

export interface DraftPersistence {
  draft: DraftState;
  publicationState: "idle" | "publishing";
  conflictOpen: boolean;
  setConflictOpen: Dispatch<SetStateAction<boolean>>;
  /** Merge base (last persisted/loaded revision) for three-way conflict review. */
  mergeBase: SemanticDocument;
  mergeBaseLayout: LayoutSidecar;
  conflictRemoteDocument?: SemanticDocument;
  conflictRemoteLayout?: LayoutSidecar;
  retrySave(): Promise<void>;
  publish(): Promise<void>;
  reloadRemoteConflict(): void;
  saveLocalAsNew(): Promise<void>;
  mergeConflict(): Promise<void>;
  cancelConflictResolution(): void;
  /** Advance the persisted-key identity after validation binds a layout digest. */
  rebindPersistedKey(nextDocument: SemanticDocument, previousLayout: LayoutSidecar, nextLayout: LayoutSidecar): void;
  /** Reset draft state when the editor is re-seeded from a new document. */
  reset(nextDocument: SemanticDocument, nextLayout: LayoutSidecar): void;
}

/**
 * Owns owner-backed draft persistence, publication and conflict resolution for
 * the designer. Autosave keeps one stable mutation identity per (revision,
 * etag, value) triple, load/save generations reject stale responses, and a
 * reported conflict preserves the local candidate until an explicit review.
 */
export function useDraftPersistence({ client, definitionId, initialDocument, initialRawText, document, layout, suspended, bridge }: DraftPersistenceOptions): DraftPersistence {
  const { replaceDocument, commitSnapshot, setLayout, reportValidation, setDiagnostics, editGeneration } = bridge;
  const draftId = draftIdFor(definitionId);

  const [draft, setDraft] = useState<DraftState>(initialDraftState);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [publicationState, setPublicationState] = useState<"idle" | "publishing">("idle");
  const [conflictOpen, setConflictOpen] = useState(true);
  const draftRef = useRef(draft);
  const mergeBaseRef = useRef<SemanticDocument>(cloneDocument(initialDocument));
  const mergeBaseLayoutRef = useRef<LayoutSidecar>(createLayout(initialDocument, "pending"));
  const persistedKeyRef = useRef<string | undefined>(undefined);
  const mutationIdsRef = useRef(new Map<string, string>());
  const publicationIdsRef = useRef(new Map<string, string>());
  const saveGenerationRef = useRef(0);

  draftRef.current = draft;

  useEffect(() => {
    let active = true;
    const loadDraft = async (): Promise<void> => {
      const loadGeneration = saveGenerationRef.current;
      try {
        const saved = await client.getDraft(draftId);
        if (!active) return;
        // A save that started after this load must win; a late load response
        // cannot repopulate newer local state.
        if (saveGenerationRef.current !== loadGeneration) return;
        if (saved) {
          const parsedLayout = LayoutSidecarSchema.safeParse(saved.layout);
          const nextLayout = parsedLayout.success ? parsedLayout.data : createLayout(saved.document, "pending");
          replaceDocument(saved.document, nextLayout, { focusEntryGraph: true, updateRawText: !initialRawText });
          mergeBaseRef.current = cloneDocument(saved.document);
          mergeBaseLayoutRef.current = nextLayout;
          if (saved.conflict) setConflictOpen(true);
          setDraft({ revision: saved.revision, etag: saved.etag, state: saved.conflict ? "conflict" : "saved", message: saved.conflict ? "The owner returned a persisted draft conflict." : "Loaded the owner-backed draft.", server: saved.conflict ? saved : undefined });
          persistedKeyRef.current = valueKey(saved.document, nextLayout);
        }
      } catch (error: unknown) {
        if (active && !(error instanceof CapabilityGateError)) {
          setDraft((current) => ({ ...current, state: "offline", message: error instanceof Error ? error.message : "Draft load failed." }));
        }
      } finally {
        if (active) setDraftHydrated(true);
      }
    };
    void loadDraft();
    return () => { active = false; };
  }, [client, draftId]);

  useEffect(() => {
    if (suspended || !draftHydrated || draftRef.current.state === "conflict") return;
    const currentDraft = draftRef.current;
    const currentKey = valueKey(document, layout);
    if (persistedKeyRef.current === currentKey) return;
    const mutationKey = JSON.stringify({ draftId, currentDraft: { revision: currentDraft.revision, etag: currentDraft.etag }, value: currentKey });
    const clientMutationId = mutationIdsRef.current.get(mutationKey) ?? `studio.mutation.${Date.now()}.${mutationIdsRef.current.size}`;
    mutationIdsRef.current.set(mutationKey, clientMutationId);
    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;
    const timer = window.setTimeout(() => {
      setDraft((current) => ({ ...current, state: "saving", message: "Saving draft through the owner adapter…" }));
      void client.saveDraft({
        draftId,
        definitionId,
        revision: currentDraft.revision,
        etag: currentDraft.etag,
        document,
        layout,
        clientMutationId,
      }).then((saved) => {
        if (generation !== saveGenerationRef.current) return;
        if (!saved.conflict) {
          persistedKeyRef.current = currentKey;
          mergeBaseRef.current = cloneDocument(document);
          mergeBaseLayoutRef.current = layout;
        } else {
          persistedKeyRef.current = undefined;
          setConflictOpen(true);
        }
        setDraft({ revision: saved.revision, etag: saved.etag, state: saved.conflict ? "conflict" : "saved", message: saved.conflict ? "The owner reported a revision conflict." : "Autosaved to the active adapter.", server: saved.conflict ? saved : undefined });
      }).catch((error: unknown) => {
        if (generation !== saveGenerationRef.current) return;
        if (error instanceof CapabilityGateError) {
          setDraft((current) => ({ ...current, state: "offline", message: "Draft persistence is unavailable through the active owner adapter." }));
        } else {
          setDraft((current) => ({ ...current, state: "offline", message: error instanceof Error ? error.message : "Draft save failed." }));
        }
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [client, definitionId, draftHydrated, document, layout, draftId, saveRetry, suspended]);

  const retrySave = async (): Promise<void> => {
    if (draft.state !== "offline") return;
    setDraft((current) => ({ ...current, state: "saving", message: "Reconciling the owner revision before retrying…" }));
    try {
      const server = await client.getDraft(draftId);
      if (server) {
        const storedMatchesLocal = canonicalJson(server.document) === canonicalJson(document) && canonicalJson(server.layout) === canonicalJson(layout);
        if (storedMatchesLocal) {
          persistedKeyRef.current = valueKey(document, layout);
          mergeBaseRef.current = cloneDocument(server.document);
          setDraft({ revision: server.revision, etag: server.etag, state: "saved", message: "The owner already stored this candidate; the retry resolved to the existing revision." });
          return;
        }
        if (server.revision !== draft.revision || server.etag !== draft.etag) {
          setDraft({ revision: server.revision, etag: server.etag, state: "conflict", message: "The owner revision moved while this tab was offline; review the conflict before saving.", server });
          return;
        }
      }
    } catch {
      // Reconciliation is best-effort; a failed lookup falls back to the retry identity.
    }
    setDraft((current) => ({ ...current, state: "saving", message: "Retrying the same draft save identity…" }));
    setSaveRetry((current) => current + 1);
  };

  const publish = async (): Promise<void> => {
    if (draft.state !== "saved") {
      reportValidation("error", "Wait for the draft to reach a saved revision before publishing.");
      return;
    }
    setPublicationState("publishing");
    reportValidation("running", "");
    const generation = editGeneration.current.current();
    try {
      const validation = await client.validate(document);
      if (!editGeneration.current.isCurrent(generation)) return;
      setDiagnostics(validation);
      if (!validation.valid) {
        reportValidation("invalid", "Publication was blocked by owner validation diagnostics.");
        return;
      }
      const publishKey = `${draft.revision}:${draft.etag}:${validation.definition_digest}`;
      const clientMutationId = publicationIdsRef.current.get(publishKey) ?? `studio.publish.${Date.now()}.${publicationIdsRef.current.size}`;
      publicationIdsRef.current.set(publishKey, clientMutationId);
      const result = await client.publishDraft(draftId, draft.revision, draft.etag, validation.definition_digest, clientMutationId);
      if (result.outcome === "conflict" && result.draft) {
        setDraft({ revision: result.draft.revision, etag: result.draft.etag, state: "conflict", message: "The owner returned a publication conflict.", server: result.draft });
        reportValidation("error", "Publication needs conflict resolution before it can create an immutable revision.");
      } else {
        reportValidation("valid", result.outcome === "already_published" ? "This exact semantic digest is already published." : "Published an immutable owner revision.");
      }
    } catch (error: unknown) {
      reportValidation("error", error instanceof Error ? error.message : "Publication failed.");
    } finally {
      setPublicationState("idle");
    }
  };

  const reloadRemoteConflict = (): void => {
    const remote = draft.server?.conflict?.serverDocument;
    if (!remote || !draft.server) return;
    const remoteLayoutResult = LayoutSidecarSchema.safeParse(draft.server.conflict?.serverLayout ?? draft.server.layout);
    const remoteLayout = remoteLayoutResult.success ? remoteLayoutResult.data : createLayout(remote, "pending");
    replaceDocument(remote, remoteLayout, { focusEntryGraph: false, updateRawText: true });
    mergeBaseRef.current = cloneDocument(remote);
    mergeBaseLayoutRef.current = remoteLayout;
    persistedKeyRef.current = valueKey(remote, remoteLayout);
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
    const remoteLayoutResult = LayoutSidecarSchema.safeParse(server.conflict?.serverLayout ?? server.layout);
    const remoteLayout = remoteLayoutResult.success ? remoteLayoutResult.data : createLayout(remote, "pending");
    const semantic = mergeDocuments(mergeBaseRef.current, document, remote);
    if (semantic.conflicts.length > 0 || !semantic.document) {
      reportValidation("error", `Merge needs review at ${semantic.conflicts.map((conflict) => conflict.path).join(", ")}.`);
      return;
    }
    const neutral = (side: LayoutSidecar): LayoutSidecar => ({ ...side, semanticDigest: "merge" });
    const layoutMerge = mergeLayoutSidecars(neutral(mergeBaseLayoutRef.current), neutral(layout), neutral(remoteLayout));
    const nextLayout = layoutMerge.layout ?? layout;
    commitSnapshot(semantic.document, nextLayout);
    setConflictOpen(true);
    setDraft({ revision: server.revision, etag: server.etag, state: "saving", message: "Saving the reviewed merge against the owner revision…" });
    reportValidation("running", "Merged candidate requires fresh validation.");
    setDiagnostics(undefined);
    const generation = editGeneration.current.current();
    try {
      const result = await client.validate(semantic.document);
      if (!editGeneration.current.isCurrent(generation)) return;
      setDiagnostics(result);
      reportValidation(result.valid ? "valid" : "invalid", result.valid
        ? `Merged semantic and layout candidates revalidated at ${result.definition_digest.slice(0, 12)}…`
        : `${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? "" : "s"} reported for the merged candidate.`);
      const mergedLayoutBinding = await semanticDigest(semantic.document);
      setLayout((current) => ({ ...current, semanticDigest: mergedLayoutBinding }));
    } catch (error: unknown) {
      reportValidation("error", error instanceof Error ? error.message : "Merged candidate validation failed.");
    }
  };

  const rebindPersistedKey = useCallback((nextDocument: SemanticDocument, previousLayout: LayoutSidecar, nextLayout: LayoutSidecar): void => {
    if (persistedKeyRef.current === valueKey(nextDocument, previousLayout)) {
      persistedKeyRef.current = valueKey(nextDocument, nextLayout);
    }
  }, []);

  const reset = useCallback((nextDocument: SemanticDocument, nextLayout: LayoutSidecar): void => {
    setDraftHydrated(false);
    persistedKeyRef.current = undefined;
    mergeBaseRef.current = cloneDocument(nextDocument);
    mergeBaseLayoutRef.current = nextLayout;
    setConflictOpen(true);
    setDraft(initialDraftState());
  }, []);

  const conflictRemoteDocument = draft.server ? (draft.server.conflict?.serverDocument ?? draft.server.document) : undefined;
  const conflictRemoteLayout = conflictRemoteDocument
    ? (() => { const parsed = LayoutSidecarSchema.safeParse(draft.server?.conflict?.serverLayout ?? draft.server?.layout); return parsed.success ? parsed.data : createLayout(conflictRemoteDocument, "pending"); })()
    : undefined;

  return {
    draft,
    publicationState,
    conflictOpen,
    setConflictOpen,
    mergeBase: mergeBaseRef.current,
    mergeBaseLayout: mergeBaseLayoutRef.current,
    conflictRemoteDocument,
    conflictRemoteLayout,
    retrySave,
    publish,
    reloadRemoteConflict,
    saveLocalAsNew,
    mergeConflict,
    cancelConflictResolution,
    rebindPersistedKey,
    reset,
  };
}
