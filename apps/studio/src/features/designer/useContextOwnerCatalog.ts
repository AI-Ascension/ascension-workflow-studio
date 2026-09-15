import { useCallback, useEffect, useRef, useState } from "react";
import { ContextOwnerCatalogSchema, contextBindingsFromOwnerCatalog, type ContextOwnerCatalog } from "@studio/contracts";
import { ClientError, type StudioClient } from "@studio/client";

export type ContextCatalogState =
  | { status: "pending" }
  | { status: "available"; catalog: ContextOwnerCatalog }
  | { status: "unavailable"; reason: string };

export function useContextOwnerCatalog(client: StudioClient, principal: string) {
  const [request, setRequest] = useState(0);
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    client: StudioClient; principal: string; request: number; value: ContextCatalogState;
  }>();
  const refresh = useCallback(() => {
    generation.current += 1;
    setRequest((value) => value + 1);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    const publish = (value: ContextCatalogState): void => {
      if (active && generation.current === current) setSnapshot({ client, principal, request, value });
    };
    void client.listContextBindings().then((value) => {
      const parsed = ContextOwnerCatalogSchema.safeParse(value);
      publish(parsed.success
        ? { status: "available", catalog: parsed.data }
        : { status: "unavailable", reason: "The owner catalog failed integrity or bounds validation." });
    }).catch((error: unknown) => {
      publish({ status: "unavailable", reason: error instanceof ClientError && error.status === 403
        ? "The owner denied access to this catalog."
        : "The owner catalog could not be admitted. Previous bindings are unavailable." });
    });
    return () => { active = false; };
  }, [client, principal, request]);

  // Hide stale values during render, before the replacement effect starts.
  const state: ContextCatalogState = snapshot?.client === client && snapshot.principal === principal
    && snapshot.request === request ? snapshot.value : { status: "pending" };
  const bindings = state.status === "available" ? contextBindingsFromOwnerCatalog(state.catalog) : undefined;
  return { state, bindings, refresh };
}
