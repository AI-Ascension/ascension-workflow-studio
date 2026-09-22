/**
 * Public facade for the client package.
 *
 * The former single-file implementation is now split into cohesive
 * transport/resource modules and this entrypoint re-exports the complete,
 * unchanged public surface so existing consumers (`@studio/client`) keep
 * importing from the same path:
 *
 * - `errors`: the shared `ClientError` / `CapabilityGateError` taxonomy.
 * - `types`: client-facing interfaces and the `StudioClient` contract.
 * - `transport`: relative-base, identifier and bounded-transport primitives.
 * - `targets`: target admission/configuration validation guards.
 * - `fixture-catalogs`: deterministic fixture target and context catalogs.
 * - `records`: owner definition/draft decoding into Studio records.
 * - `provider-policy`: provider-session policy upload/operation guards.
 * - `projection`: run projection, SSE parsing and safe command construction.
 * - `context-service`: the read-only Context Console client.
 * - `owner-api`: the live owner API adapter and provider-session policy client.
 * - `fixture`: the in-memory fixture adapter.
 *
 * Behavior is preserved verbatim; nothing here alters semantics.
 */
export { ClientError, CapabilityGateError } from "./errors";
export type {
  ClientMode,
  DraftWrite,
  PublishResult,
  RunSubmissionOptions,
  StudioClient,
  OwnerApiClientOptions,
  ProviderSessionPolicyClient,
  RunProjection,
  ProjectionResult,
} from "./types";
export { normalizeRelativeBase } from "./transport";
export { validateTargetAdmissionBinding, validateTargetConfiguration } from "./targets";
export { fixtureTargetCatalog, fixtureContextOwnerCatalog } from "./fixture-catalogs";
export { createProjection, applyEventPage, parseSseDataChunk, buildSafeCommand } from "./projection";
export { ContextServiceClient } from "./context-service";
export { OwnerApiClient } from "./owner-api";
export { FixtureClient } from "./fixture";
