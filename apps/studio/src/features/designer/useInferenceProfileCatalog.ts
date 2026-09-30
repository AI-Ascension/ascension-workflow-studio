import { useCallback, useEffect, useRef, useState } from "react";
import {
  InferenceProfileCatalogSchema,
  type InferenceProfileCatalog,
} from "@studio/contracts";
import { ClientError, type StudioClient } from "@studio/client";

/** Deliberately the same discriminated shape as `ContextCatalogState`, so an
 * unreachable owner catalog and an unreachable profile catalog are handled
 * identically: there is no third "empty" state that could read as "the owner
 * published nothing selectable" when the truth is "the owner never answered".
 *
 * There is deliberately NO `profiles` field separate from `catalog`. The only
 * way to obtain selectable options is through a catalog that passed
 * `InferenceProfileCatalogSchema`, which is what keeps a pending or failed
 * request from ever presenting a binding as selectable. A fixture catalog is
 * never substituted here; fixture mode belongs to `FixtureClient`, which is
 * the correct seam for a synthetic test, not a runtime fallback. */
export type InferenceProfileCatalogState =
  | { status: "pending" }
  | { status: "available"; catalog: InferenceProfileCatalog }
  | { status: "unavailable"; reason: string };

export function useInferenceProfileCatalog(client: StudioClient, principal: string) {
  const [request, setRequest] = useState(0);
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    client: StudioClient; principal: string; request: number; value: InferenceProfileCatalogState;
  }>();
  const refresh = useCallback(() => {
    generation.current += 1;
    setRequest((value) => value + 1);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    const publish = (value: InferenceProfileCatalogState): void => {
      if (active && generation.current === current) setSnapshot({ client, principal, request, value });
    };
    void client.listInferenceProfiles().then((value) => {
      const parsed = InferenceProfileCatalogSchema.safeParse(value);
      publish(parsed.success
        ? { status: "available", catalog: parsed.data }
        : { status: "unavailable", reason: "The owner profile catalog failed integrity or bounds validation." });
    }).catch((error: unknown) => {
      publish({ status: "unavailable", reason: error instanceof ClientError && error.status === 403
        ? "The owner denied access to the profile catalog."
        : "The owner profile catalog could not be admitted. No profile can be selected." });
    });
    return () => { active = false; };
  }, [client, principal, request]);

  // Hide stale values during render, before the replacement effect starts.
  const state: InferenceProfileCatalogState = snapshot?.client === client && snapshot.principal === principal
    && snapshot.request === request ? snapshot.value : { status: "pending" };
  return { state, refresh };
}
