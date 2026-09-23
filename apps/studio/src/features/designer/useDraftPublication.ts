import { type Dispatch, type MutableRefObject, type SetStateAction, useRef, useState } from "react";

import { type StudioClient } from "@studio/client";
import { type ValidateResponse } from "@studio/contracts";
import { type EditGeneration, type SemanticDocument } from "@studio/document";

import { type DraftState } from "./draftState";

export interface DraftPublicationOptions {
  client: StudioClient;
  draftId: string;
  document: SemanticDocument;
  draft: DraftState;
  setDraft: Dispatch<SetStateAction<DraftState>>;
  editGeneration: MutableRefObject<EditGeneration>;
  setValidationState: (state: "idle" | "running" | "valid" | "invalid" | "error") => void;
  setValidationMessage: (message: string) => void;
  setDiagnostics: (result: ValidateResponse | undefined) => void;
}

export interface DraftPublication {
  publicationState: "idle" | "publishing";
  publish: () => Promise<void>;
}

/**
 * Publication of a saved draft revision. Validates through the owner first,
 * reuses a stable publication identity per revision/digest, and maps owner
 * conflicts back onto the shared draft state.
 */
export function useDraftPublication({
  client,
  draftId,
  document,
  draft,
  setDraft,
  editGeneration,
  setValidationState,
  setValidationMessage,
  setDiagnostics,
}: DraftPublicationOptions): DraftPublication {
  const [publicationState, setPublicationState] = useState<"idle" | "publishing">("idle");
  const publicationIdsRef = useRef(new Map<string, string>());

  const publish = async (): Promise<void> => {
    if (draft.state !== "saved") {
      setValidationState("error");
      setValidationMessage("Wait for the draft to reach a saved revision before publishing.");
      return;
    }
    setPublicationState("publishing");
    setValidationState("running");
    setValidationMessage("");
    const generation = editGeneration.current.current();
    try {
      const validation = await client.validate(document);
      if (!editGeneration.current.isCurrent(generation)) return;
      setDiagnostics(validation);
      if (!validation.valid) {
        setValidationState("invalid");
        setValidationMessage("Publication was blocked by owner validation diagnostics.");
        return;
      }
      const publishKey = `${draft.revision}:${draft.etag}:${validation.definition_digest}`;
      const clientMutationId = publicationIdsRef.current.get(publishKey) ?? `studio.publish.${Date.now()}.${publicationIdsRef.current.size}`;
      publicationIdsRef.current.set(publishKey, clientMutationId);
      const result = await client.publishDraft(draftId, draft.revision, draft.etag, validation.definition_digest, clientMutationId);
      if (result.outcome === "conflict" && result.draft) {
        setDraft({ revision: result.draft.revision, etag: result.draft.etag, state: "conflict", message: "The owner returned a publication conflict.", server: result.draft });
        setValidationState("error");
        setValidationMessage("Publication needs conflict resolution before it can create an immutable revision.");
      } else {
        setValidationState("valid");
        setValidationMessage(result.outcome === "already_published" ? "This exact semantic digest is already published." : "Published an immutable owner revision.");
      }
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Publication failed.");
    } finally {
      setPublicationState("idle");
    }
  };

  return { publicationState, publish };
}
