/**
 * ADR-0016 §2.1 — the typed change set a structural diff produces, deliberately
 * distinct from a text hunk: each entry names a JSON-path-shaped location, the kind of
 * change, and (where applicable) the before/after value, so the console can render a
 * *semantic* diff ("approval tier: 1 -> 3") rather than a line diff.
 */
export type ChangeOp = "added" | "removed" | "changed" | "moved";

export interface Change {
  /** `added` — the path exists only in `right`. `removed` — exists only in `left`.
   * `changed` — exists in both but the value differs. `moved` — reserved for a future
   * keyed-array reorder-detection refinement; not emitted by this version (a keyed
   * array's member order is not itself a change this diff reports — only membership
   * and per-member content are). */
  op: ChangeOp;
  /** Dotted path from the artifact root, e.g. `spec.toolPolicy.maxToolCallsPerTurn` or
   * `spec.toolGrants[refund_tool].tier` for a keyed-array member. */
  path: string;
  before?: unknown;
  after?: unknown;
  /** ADR-0016 §2.1 — "security-relevant paths ... are tagged so the review UI can
   * surface them first." Determined by the per-artifact-kind `SECURITY_RELEVANT_PATH_
   * PREFIXES` table in `security-tags.ts`, never left to the caller to guess. */
  securityRelevant: boolean;
}

export type ChangeSet = Change[];
