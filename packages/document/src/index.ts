/**
 * Public facade for the document package.
 *
 * The former single-file implementation is now split into cohesive modules and
 * this entrypoint re-exports the complete, unchanged public surface so existing
 * consumers (`@studio/document`) keep importing from the same path:
 *
 * - `semantic-document`: the owner workflow definition type alias.
 * - `owner-nodes`: admitted owner node kinds, output ports, binding validation
 *   and shape-correct default/convert configs.
 * - `json`: canonical JSON and shared JSON helpers.
 * - `bounded-json`: bounded JSON parsing and definition import classification.
 * - `digest`: SHA-256 semantic and definition-identity digests.
 * - `layout`: layout sidecars and the Studio flow projection.
 * - `document-edits`: structural document mutations and clipboard operations.
 * - `bundle`: digest-bound Studio bundle serialization/parsing.
 * - `merge`: three-way document and layout merge.
 * - `history`: bounded undo/redo history.
 *
 * Behavior is preserved verbatim; nothing here alters semantics.
 */
export * from "./guard";
export * from "./reference";
export * from "./recovery";
export * from "./links";
export * from "./mapProjection";
export * from "./generation";

export type { SemanticDocument } from "./semantic-document";

export {
  OWNER_NODE_KINDS,
  OWNER_EDGE_OUTCOMES,
  isOwnerNodeKind,
  nodeOutputs,
  compatibleNodeOutputs,
  validateNodeBindings,
  defaultNodeConfig,
  convertNodeKind,
} from "./owner-nodes";
export type {
  OwnerNodeKind,
  OwnerEdgeOutcome,
  NodeOutputDescriptor,
  NodeBindingDiagnostic,
} from "./owner-nodes";

export {
  canonicalJsonComplete,
  canonicalize,
  canonicalJson,
} from "./json";

export { parseBoundedJson, parseDefinitionImport } from "./bounded-json";
export type { JsonImportLimits, DefinitionImport } from "./bounded-json";

export { sha256Hex, semanticDigest, definitionIdentityDigest } from "./digest";

export {
  qualifiedNodeId,
  createLayout,
  createFlowProjection,
  updateLayout,
  layoutIsValid,
  layoutOnlyChange,
  alignLayout,
  autoLayout,
} from "./layout";
export type { StudioFlowNode, StudioFlowEdge, DocumentBundle } from "./layout";

export {
  cloneDocument,
  diffDocuments,
  updateNode,
  addNode,
  removeNode,
  addEdge,
  reconnectEdge,
  updateEdge,
  copyNodes,
  pasteNodes,
  MAX_CLIPBOARD_NODES,
  MAX_CLIPBOARD_EDGES,
  MAX_CLIPBOARD_BYTES,
} from "./document-edits";
export type { DocumentChange, NodeClipboard, PasteResult } from "./document-edits";

export { serializeStudioBundle, parseStudioBundle } from "./bundle";
export type { StudioBundleEnvelope } from "./bundle";

export { mergeDocuments, mergeLayoutSidecars } from "./merge";
export type { MergeConflict, DocumentMergeResult, LayoutMergeResult } from "./merge";

export { History } from "./history";
