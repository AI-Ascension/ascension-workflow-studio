import { useCallback, useRef, useState } from "react";
import {
  InferenceProfileRevisionRequestSchema,
  type InferenceProfileDescriptor,
  type InferenceProfileRevisionAdoption,
  type InferenceProfileRevisionRequest,
} from "@studio/contracts";
import { ClientError, CapabilityGateError, type StudioClient } from "@studio/client";

/** Why an edit could not even be attempted, kept apart from the owner's own
 * three outcomes.
 *
 * These are LOCAL refusals, decided from the sealed catalog in hand. They are
 * not a second copy of the owner's policy: the owner re-checks `grants.edit`
 * and the digest itself, and its refusal is reported separately below. The
 * point of checking locally is that a profile the owner publishes as
 * non-editable must not be offered an edit control that could only ever fail. */
export type InferenceProfileEditRefusal =
  | "edit_not_granted"
  | "profile_not_available"
  | "request_invalid"
  | "owner_refused"
  | "transport_failed";

/** The owner's three admitted outcomes, plus the local refusals above.
 *
 * `conflict` is deliberately its own case and is NOT an error state: the
 * owner answered completely and told us a concurrent edit won. The UI must
 * name that winner and require an explicit human re-author. Treating it as a
 * failure to display, or retrying it, would both be lies about what happened. */
export type InferenceProfileRevisionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "adopted"; adoption: InferenceProfileRevisionAdoption }
  | { status: "replayed"; adoption: InferenceProfileRevisionAdoption }
  | { status: "conflict"; adoption: InferenceProfileRevisionAdoption }
  | { status: "refused"; refusal: InferenceProfileEditRefusal; detail: string };

/** Draft values for the editable allow-list. Every key here is a member the
 * producer's request accepts; adding a key that is not in
 * `InferenceProfileRevisionRequest` will not typecheck, which is the point. */
export interface InferenceProfileRevisionDraft {
  version: string;
  prompt_revision: string;
  settings_revision: string;
  supported_settings: string;
  max_input_bytes: string;
  max_output_tokens: string;
  max_provider_calls: string;
}

/** Seeds the form from the revision being edited. Only the allow-listed
 * members are read — nothing here reaches for `adapter`, `requested_model`,
 * `grants`, `node_kinds` or `operations`, because there is nowhere to put them
 * and no honest way to render them. */
export function revisionDraftFor(descriptor: InferenceProfileDescriptor): InferenceProfileRevisionDraft {
  return {
    version: "",
    prompt_revision: descriptor.prompt_revision,
    settings_revision: descriptor.settings_revision,
    supported_settings: descriptor.supported_settings.join(","),
    max_input_bytes: String(descriptor.effective_budgets.max_input_bytes),
    max_output_tokens: String(descriptor.effective_budgets.max_output_tokens),
    max_provider_calls: String(descriptor.effective_budgets.max_provider_calls),
  };
}

export interface InferenceProfileRevisionEditor {
  /** The outcome for one profile, or `idle` when that profile has none.
   *
   * Outcome state is keyed by `profile_id` because the panel renders one
   * editor per descriptor from a single hook. A single shared `state` would
   * make every profile's card render the same banner, so profile B could
   * display profile A's adopted reference or name the wrong winner on a
   * conflict. The key is the profile the edit was submitted for, read from
   * the descriptor at submit time — never from form input. */
  stateFor(profileId: string): InferenceProfileRevisionState;
  submit(
    descriptor: InferenceProfileDescriptor,
    draft: InferenceProfileRevisionDraft,
  ): Promise<void>;
  reset(profileId: string): void;
}

/** The authorized revision editor for `POST
 * /v1/inference-profiles/{profile_id}/revisions`.
 *
 * Three disciplines are inherited from `useInferenceProfileCatalog` and are
 * the reason this is a hook rather than component-local state:
 *
 * 1. The compare-and-swap expectation is TAKEN FROM THE REVISION IN HAND —
 *    `descriptor.digest` — and never from a value the user typed, a field the
 *    component held from an earlier render, or a previous submission. The
 *    expected digest is what makes a concurrent edit lose instead of silently
 *    overwriting a winner.
 * 2. After an `adopted` outcome the catalog MUST BE RE-READ FROM THE OWNER.
 *    The response's `revision` is not patched into local state and called
 *    truth: the owner records an accepted revision in an append-only journal
 *    and does not splice it into the catalog it serves, so what the catalog
 *    publishes afterwards is the only thing a later admission resolves.
 * 3. A lost swap is NEVER retried here, and never rewritten from the winner.
 *    The winner is surfaced by name and an explicit re-author is required. */
export function useInferenceProfileRevisionEditor(
  client: StudioClient,
  onCatalogChanged: () => void,
): InferenceProfileRevisionEditor {
  // Keyed by profile_id so one profile's outcome cannot be attributed to
  // another. A submission updates only its own key; every other profile keeps
  // whatever it had, including `idle`.
  const [states, setStates] = useState<Record<string, InferenceProfileRevisionState>>({});
  const generation = useRef(0);

  const submit = useCallback(async (
    descriptor: InferenceProfileDescriptor,
    draft: InferenceProfileRevisionDraft,
  ): Promise<void> => {
    const current = ++generation.current;
    const profileId = descriptor.profile_id;
    // Scoped to this profile's key only: a sibling profile's outcome is left
    // untouched, so an in-flight edit elsewhere cannot blank it.
    const setProfileState = (next: InferenceProfileRevisionState) =>
      setStates((previous) => ({ ...previous, [profileId]: next }));
    setProfileState({ status: "submitting" });

    // Local preconditions, from the sealed catalog in hand. The owner repeats
    // both of these itself; refusing here means the UI never offers a control
    // that could only fail, and never sends a request for a profile the owner
    // has already said is not editable.
    if (!descriptor.grants.edit) {
      setProfileState({
        status: "refused",
        refusal: "edit_not_granted",
        detail: "The owner does not publish this inference profile as editable.",
      });
      return;
    }
    if (descriptor.state !== "available") {
      setProfileState({
        status: "refused",
        refusal: "profile_not_available",
        detail: `Only an available revision can be edited; this one is ${descriptor.state}.`,
      });
      return;
    }

    const candidate = InferenceProfileRevisionRequestSchema.safeParse({
      schema_version: "ascension.inference-profile-revision/v1",
      // From the descriptor, never from the form.
      expected_revision_digest: descriptor.digest,
      client_mutation_id: `studio.revision.${cryptoRandomMutationId()}`,
      version: draft.version.trim(),
      prompt_revision: draft.prompt_revision.trim(),
      settings_revision: draft.settings_revision.trim(),
      supported_settings: draft.supported_settings.split(",").map((value) => value.trim())
        .filter((value) => value.length > 0),
      effective_budgets: {
        max_input_bytes: Number(draft.max_input_bytes),
        max_output_tokens: Number(draft.max_output_tokens),
        max_provider_calls: Number(draft.max_provider_calls),
      },
    });
    if (!candidate.success) {
      // The closed request shape rejects here rather than sending a payload
      // the owner would refuse with an opaque error.
      setProfileState({
        status: "refused",
        refusal: "request_invalid",
        detail: "The edit does not satisfy the owner's editable request shape, so it was not sent.",
      });
      return;
    }
    const request: InferenceProfileRevisionRequest = candidate.data;

    try {
      const adoption = await client.adoptInferenceProfileRevision(descriptor.profile_id, request);
      if (generation.current !== current) return;
      if (adoption.conflicted) {
        // A concurrent edit won. The winner is reported and left alone; this
        // editor does not retry, does not re-aim at the winner, and does not
        // carry the losing candidate forward.
        setProfileState({ status: "conflict", adoption });
        return;
      }
      setProfileState({ status: adoption.adopted ? "adopted" : "replayed", adoption });
      // Re-read from the owner on any accepted outcome (`adopted` and
      // `replayed` both name a revision the owner accepted). The response is
      // not patched into local state: the owner decides what it now serves.
      if (adoption.adopted || adoption.outcome === "replayed") onCatalogChanged();
    } catch (error: unknown) {
      if (generation.current !== current) return;
      setProfileState({
        status: "refused",
        refusal: error instanceof CapabilityGateError ? "owner_refused"
          : error instanceof ClientError ? "owner_refused" : "transport_failed",
        detail: error instanceof Error ? error.message : "The owner did not answer this edit.",
      });
    }
  }, [client, onCatalogChanged]);

  const reset = useCallback((profileId: string): void => {
    generation.current += 1;
    setStates((previous) => ({ ...previous, [profileId]: { status: "idle" } }));
  }, []);

  const stateFor = useCallback((profileId: string): InferenceProfileRevisionState =>
    states[profileId] ?? { status: "idle" }, [states]);

  return { stateFor, submit, reset };
}

function cryptoRandomMutationId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
