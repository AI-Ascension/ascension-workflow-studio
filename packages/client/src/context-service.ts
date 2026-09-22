import { z } from "zod";

import {
  ContextComparisonSchema,
  ContextEventPageSchema,
  ContextSnapshotListSchema,
  ContextSnapshotManifestSchema,
  MemoryCapabilitiesSchema,
  ProviderSessionCapabilitiesSchema,
  decodeWith,
  type ContextComparison,
  type ContextEventPage,
  type ContextSnapshotList,
  type ContextSnapshotManifest,
  type MemoryCapabilities,
  type ProviderSessionCapabilities,
} from "@studio/contracts";

import { ClientError } from "./errors";
import { encodeIdentifier, normalizeRelativeBase } from "./transport";

/** Separate same-origin client for Context Console projections. It intentionally
 * exposes only typed read methods and is not a generic route proxy. */
export class ContextServiceClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private token: string | undefined;

  public constructor(options: { baseUrl?: string; token?: string; fetcher?: typeof fetch } = {}) {
    this.baseUrl = normalizeRelativeBase(options.baseUrl ?? "/api/context");
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.token = options.token;
  }

  public setToken(token: string | undefined): void { this.token = token; }

  public async memoryCapabilities(): Promise<MemoryCapabilities> {
    return decodeWith(MemoryCapabilitiesSchema, await this.json("/v3/memory/capabilities"), "memory capabilities");
  }

  public async providerSessionCapabilities(contextRunId: string): Promise<ProviderSessionCapabilities> {
    const response = await this.json(`/v1/runs/${encodeIdentifier(contextRunId)}/provider-sessions/capabilities`);
    // Console capability projections use the same operation/value envelope as
    // session reads. This route uses the explicit Context run association.
    const envelope = z.object({
      schema: z.literal("ascension.provider-session.api-result.v1"),
      operation: z.literal("capabilities"),
      value: ProviderSessionCapabilitiesSchema,
      effect_class: z.literal("local_metadata_only"),
      inference_calls: z.literal(0),
      game_effects: z.literal(0),
    }).strict();
    return decodeWith(envelope, response, "provider-session capabilities").value;
  }

  public async snapshots(runId: string): Promise<ContextSnapshotList> {
    return decodeWith(ContextSnapshotListSchema, await this.json(`/v1/runs/${encodeIdentifier(runId)}/snapshots`), "context snapshot list");
  }

  public async compareSnapshots(runId: string, leftSnapshotId: string, rightSnapshotId: string): Promise<ContextComparison> {
    const query = new URLSearchParams({ left: encodeIdentifier(leftSnapshotId), right: encodeIdentifier(rightSnapshotId) });
    return decodeWith(ContextComparisonSchema, await this.json(`/v1/runs/${encodeIdentifier(runId)}/compare?${query}`), "context comparison");
  }

  public async snapshot(runId: string, snapshotId: string): Promise<ContextSnapshotManifest> {
    return decodeWith(ContextSnapshotManifestSchema, await this.json(`/v1/runs/${encodeIdentifier(runId)}/snapshots/${encodeIdentifier(snapshotId)}`), "context snapshot manifest");
  }

  public async events(runId: string, cursor?: string): Promise<ContextEventPage> {
    const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : "";
    return decodeWith(ContextEventPageSchema, await this.json(`/v1/runs/${encodeIdentifier(runId)}/events${query}`), "context event page");
  }

  private async json(path: string): Promise<unknown> {
    try { return await (await this.request(path)).json(); }
    catch { throw new ClientError("Context service returned invalid JSON", "context_service_decode"); }
  }

  private async request(path: string): Promise<Response> {
    const headers = new Headers({ Accept: "application/json" });
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { method: "GET", headers, credentials: "same-origin" });
    } catch {
      throw new ClientError("Context service is unavailable", "context_service_unavailable");
    }
    if (!response.ok) throw new ClientError("Context service request was rejected", "context_service_rejected", response.status);
    return response;
  }
}
