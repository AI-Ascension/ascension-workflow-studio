import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { CapabilityGateError, type StudioClient } from "@studio/client";
import { LayoutSidecarSchema, type LayoutSidecar } from "@studio/contracts";
import { canonicalJson, cloneDocument, createLayout, type SemanticDocument } from "@studio/document";

import {
  draftValueKey,
  initialDraftState,
  type DraftState,
} from "./draftState";

export interface DraftPersistenceOptions {
  client: StudioClient;
  definitionId: string;
  draftId: string;
  document: SemanticDocument;
  layout: LayoutSidecar;
  initialDocument: SemanticDocument;
  initialRawText?: string;
  /** True while an archival import suspends owner writes (`archivalImport`). */
  suspended: boolean;
  setDocument: Dispatch<SetStateAction<SemanticDocument>>;
  setLayout: Dispatch<SetStateAction<LayoutSidecar>>;
  syncFlowNodes: (nextDocument: SemanticDocument, nextLayout: LayoutSidecar, selected?: string[]) => void;
  resetHistory: (nextDocument: SemanticDocument, nextLayout: LayoutSidecar) => void;
  setFocusedGraph: (graphId: string) => void;
  setGraphTrail: (graphIds: string[]) => void;
  setConflictOpen: (open: boolean) => void;
  setRawText: (value: string) => void;
}

export interface DraftPersistence {
  draft: DraftState;
  setDraft: Dispatch<SetStateAction<DraftState>>;
  draftRef: MutableRefObject<DraftState>;
  draftHydrated: boolean;
  saveRetry: number;
  retrySave: () => Promise<void>;
  persistedKeyRef: MutableRefObject<string | undefined>;
  mergeBaseRef: MutableRefObject<SemanticDocument>;
  mergeBaseLayoutRef: MutableRefObject<LayoutSidecar>;
  /** Reset draft state around a newly loaded semantic document. */
  resetDraftForDocument: (nextDocument: SemanticDocument, nextLayout: LayoutSidecar) => void;
}

/**
 * Owns draft hydration, debounced autosave, the persisted-key and merge-base
 * bookkeeping, and the offline retry reconciliation. Publication and conflict
 * resolution live in sibling modules and consume this controller.
 */
export function useDraftPersistence({
  client,
  definitionId,
  draftId,
  document,
  layout,
  initialDocument,
  initialRawText,
  suspended,
  setDocument,
  setLayout,
  syncFlowNodes,
  resetHistory,
  setFocusedGraph,
  setGraphTrail,
  setConflictOpen,
  setRawText,
}: DraftPersistenceOptions): DraftPersistence {
  const [draft, setDraft] = useState<DraftState>(initialDraftState);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const mergeBaseRef = useRef<SemanticDocument>(cloneDocument(initialDocument));
  const mergeBaseLayoutRef = useRef<LayoutSidecar>(createLayout(initialDocument, "pending"));
  const persistedKeyRef = useRef<string | undefined>(undefined);
  const mutationIdsRef = useRef(new Map<string, string>());
  const saveGenerationRef = useRef(0);

  const resetDraftForDocument = useCallback((nextDocument: SemanticDocument, nextLayout: LayoutSidecar): void => {
    setDraftHydrated(false);
    persistedKeyRef.current = undefined;
    mergeBaseRef.current = cloneDocument(nextDocument);
    mergeBaseLayoutRef.current = nextLayout;
    setConflictOpen(true);
    setDraft(initialDraftState());
  }, [setConflictOpen]);

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
          resetHistory(saved.document, nextLayout);
          mergeBaseRef.current = cloneDocument(saved.document);
          mergeBaseLayoutRef.current = nextLayout;
          setFocusedGraph(saved.document.entry_graph);
          setGraphTrail([saved.document.entry_graph]);
          if (saved.conflict) setConflictOpen(true);
          setDocument(saved.document);
          setLayout(nextLayout);
          syncFlowNodes(saved.document, nextLayout);
          // `initialRawText` intentionally stays out of the dependency list: the
          // hydration key is the draft identity, matching the pre-extraction effect.
          if (!initialRawText) setRawText(JSON.stringify(saved.document, null, 2));
          setDraft({ revision: saved.revision, etag: saved.etag, state: saved.conflict ? "conflict" : "saved", message: saved.conflict ? "The owner returned a persisted draft conflict." : "Loaded the owner-backed draft.", server: saved.conflict ? saved : undefined });
          persistedKeyRef.current = draftValueKey(saved.document, nextLayout);
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
  }, [client, draftId, resetHistory, setDocument, setLayout, syncFlowNodes, setFocusedGraph, setGraphTrail, setConflictOpen, setRawText]);

  useEffect(() => {
    if (suspended || !draftHydrated || draftRef.current.state === "conflict") return;
    const currentDraft = draftRef.current;
    const currentKey = draftValueKey(document, layout);
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
  }, [client, definitionId, draftHydrated, document, layout, draftId, saveRetry, suspended, setConflictOpen]);

  const retrySave = async (): Promise<void> => {
    if (draft.state !== "offline") return;
    setDraft((current) => ({ ...current, state: "saving", message: "Reconciling the owner revision before retrying…" }));
    try {
      const server = await client.getDraft(draftId);
      if (server) {
        const storedMatchesLocal = canonicalJson(server.document) === canonicalJson(document) && canonicalJson(server.layout) === canonicalJson(layout);
        if (storedMatchesLocal) {
          persistedKeyRef.current = draftValueKey(document, layout);
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

  return {
    draft,
    setDraft,
    draftRef,
    draftHydrated,
    saveRetry,
    retrySave,
    persistedKeyRef,
    mergeBaseRef,
    mergeBaseLayoutRef,
    resetDraftForDocument,
  };
}
