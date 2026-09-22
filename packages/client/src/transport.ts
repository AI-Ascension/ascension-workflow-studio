import { ClientError } from "./errors";

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeRelativeBase(baseUrl: string): string {
  if (!baseUrl.startsWith("/")) {
    throw new Error("Studio owner adapters require a same-origin relative API base");
  }
  if (baseUrl.startsWith("//") || baseUrl.includes("\\") || baseUrl.includes("#")) {
    throw new Error("API base contains an unsafe origin or fragment");
  }
  return baseUrl.replace(/\/$/, "");
}

export function encodeIdentifier(value: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ClientError("Identifier contains unsupported characters", "invalid_identifier");
  }
  return encodeURIComponent(value);
}

export function cryptoRandomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function isLiveExecutionProfile(profile: string): boolean {
  return profile === "live" || profile.startsWith("live.");
}
