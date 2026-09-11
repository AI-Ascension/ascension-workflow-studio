import type { JsonObject } from "@studio/contracts";

/** Studio presentation model only; populated after the protocol-owned decoder accepts a bundle. */
export interface InspectionRecord {
  key: string;
  kind: string;
  stream: string;
  ordinal: number;
  sequence?: string;
  timestamp?: string;
  unsupported: boolean;
  identities: JsonObject;
  evidence: JsonObject;
  payload: JsonObject;
}
export interface RecordingInspection {
  digest: string;
  bundleIdentity: string;
  identities: JsonObject;
  provenance: JsonObject;
  completeness: JsonObject;
  evidence: JsonObject;
  omissions: JsonObject;
  records: InspectionRecord[];
  accounting: InspectionRecord[];
  diagnostics: string[];
}
export interface ImportDiagnostic { code: string; message: string }
