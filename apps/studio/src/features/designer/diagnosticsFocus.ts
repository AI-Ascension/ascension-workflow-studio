import { type WorkflowDefinition } from "@studio/contracts";

/** Focus targets are looked up by IDENTITY, never by parsing a path.
 *
 * Two different path vocabularies reach this component and they are not
 * interchangeable:
 *
 * - Ordinary owner diagnostics are ID-based. `management/validation.rs:120`
 *   composes `$.graphs.{graph_id}.nodes.{node_id}`, so the ids are in the path.
 * - Owner inference-profile entries are INDEX-based. The producer composes
 *   `$.graphs[{graph_index}].nodes[{node_index}].config.{field}`
 *   (`inference_profile_binding.rs:188`), so the path carries no ids at all.
 *
 * Substring-matching a node id inside a path therefore resolves the first
 * vocabulary and silently no-ops the second, which is what made the profile
 * focus button inert for all 11 profile-bearing nodes of the accepted fixtures.
 *
 * An id-based path is split EXACTLY, rather than by substring, so a diagnostic
 * whose path merely mentions another node's id cannot select that node: the
 * `.` in `$.graphs.` is a delimiter, not a character to match through.
 */
const ID_PATH_PREFIX = "$.graphs.";
const ID_PATH_SEPARATOR = ".nodes.";

/** What a focus request resolved to: one node, unambiguously. */
export interface FocusTarget {
  graphId: string;
  nodeId: string;
  /** The `graph_id:node_id` selector the designer selects nodes by. */
  qualifiedId: string;
}

/** Resolves one id-based owner diagnostic path against the open document.
 *
 * Used for ordinary diagnostic rows, whose paths carry the ids. Returns
 * `undefined` when the path is not that shape, when it names a node this
 * document does not contain, or when two nodes match: it fails closed rather
 * than selecting a guess.
 */
export function focusTargetFromDiagnosticPath(
  document: WorkflowDefinition,
  path: string,
): FocusTarget | undefined {
  if (!path.startsWith(ID_PATH_PREFIX)) return undefined;
  const body = path.slice(ID_PATH_PREFIX.length);
  // Producer identifiers admit `.`, so a graph id such as `campaign.iteration`
  // cannot be split with a "no dots allowed" pattern: the separator is
  // ambiguous in principle. Rather than guess a split rule, every candidate
  // split is tested against the document and only an UNAMBIGUOUS one, naming a
  // node that actually exists, resolves. Ambiguity fails closed.
  const candidates: FocusTarget[] = [];
  for (let at = body.indexOf(ID_PATH_SEPARATOR); at >= 0; at = body.indexOf(ID_PATH_SEPARATOR, at + 1)) {
    const graphId = body.slice(0, at);
    const nodeId = body.slice(at + ID_PATH_SEPARATOR.length);
    if (document.graphs.some(
      (graph) => graph.id === graphId && graph.nodes.some((node) => node.id === nodeId),
    )) candidates.push({ graphId, nodeId, qualifiedId: `${graphId}:${nodeId}` });
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Resolves an owner inference-profile entry by the ids the entry ITSELF
 * carries, so the focus target never depends on the shape of `path`.
 *
 * `path` is display text. The owner composes it from array indices, which
 * address a position in the owner's copy of the definition rather than a node
 * the browser can look up by id, so it cannot be the resolution key.
 */
export function focusTargetFromProfileEntry(
  document: WorkflowDefinition,
  entry: { graph_id: string; node_id: string },
): FocusTarget | undefined {
  return document.graphs.some(
    (graph) => graph.id === entry.graph_id && graph.nodes.some((node) => node.id === entry.node_id),
  )
    ? { graphId: entry.graph_id, nodeId: entry.node_id, qualifiedId: `${entry.graph_id}:${entry.node_id}` }
    : undefined;
}
