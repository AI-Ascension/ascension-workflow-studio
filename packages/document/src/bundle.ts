import { type LayoutSidecar, LayoutSidecarSchema, WorkflowDefinitionSchema } from "@studio/contracts";

import { parseBoundedJson, unknownNodeKinds } from "./bounded-json";
import { semanticDigest } from "./digest";
import { cloneDocument } from "./document-edits";
import { isJsonRecord } from "./json";
import { type DocumentBundle, layoutIsValid } from "./layout";
import type { SemanticDocument } from "./semantic-document";

export interface StudioBundleEnvelope {
  bundleVersion: "ascension.studio-bundle/v1";
  semanticDigest: string;
  semantic: SemanticDocument;
  layout: LayoutSidecar;
}

export async function serializeStudioBundle(bundle: DocumentBundle): Promise<string> {
  const digest = await semanticDigest(bundle.semantic);
  if (bundle.layout.semanticDigest !== digest || !layoutIsValid(bundle.semantic, bundle.layout)) {
    throw new Error("cannot export a bundle with an unbound or invalid layout sidecar");
  }
  assertNoSecretLikeKeys(bundle.semantic);
  const envelope: StudioBundleEnvelope = {
    bundleVersion: "ascension.studio-bundle/v1",
    semanticDigest: digest,
    semantic: cloneDocument(bundle.semantic),
    layout: LayoutSidecarSchema.parse(bundle.layout),
  };
  return JSON.stringify(envelope, null, 2);
}

export async function parseStudioBundle(raw: string): Promise<DocumentBundle> {
  const parsed = parseBoundedJson(raw);
  if (!isJsonRecord(parsed)) {
    throw new Error("Studio bundle must be a JSON object");
  }
  const record = parsed;
  if (record.bundleVersion !== "ascension.studio-bundle/v1") {
    throw new Error("Studio bundle version is unsupported");
  }
  const semanticRecord = isJsonRecord(record.semantic) ? record.semantic : undefined;
  if (semanticRecord && unknownNodeKinds(semanticRecord).length > 0) {
    throw new Error("Studio bundle contains an unsupported owner node kind");
  }
  const semantic = WorkflowDefinitionSchema.parse(record.semantic);
  const layout = LayoutSidecarSchema.parse(record.layout);
  assertNoSecretLikeKeys(semantic);
  const digest = await semanticDigest(semantic);
  if (record.semanticDigest !== digest || layout.semanticDigest !== digest) {
    throw new Error("Studio bundle semantic digest does not match its content");
  }
  if (!layoutIsValid(semantic, layout)) {
    throw new Error("Studio bundle layout contains an unknown or missing node binding");
  }
  return { semantic, layout };
}

function assertNoSecretLikeKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikeKeys(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/(?:^|[_-])(token|secret|password|api[_-]?key|private[_-]?key)(?:$|[_-])/i.test(key) || /^(token|secret|password|apikey|privatekey)$/i.test(key)) {
      throw new Error("Studio bundle refuses secret-like field " + path + "." + key);
    }
    assertNoSecretLikeKeys(child, `${path}.${key}`);
  }
}
