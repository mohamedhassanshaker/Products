import { createHash } from "node:crypto";

/**
 * Deterministic sha256 of an agent-definition artifact — used for
 * `agent_definition_version.definition_hash` (FR-AGT-02's diff basis, and the eval-gate
 * "definition hasn't changed since the last passing eval run" check, LLD §3.10).
 *
 * Recursively sorts object keys (not `JSON.stringify`'s array-replacer form — that
 * argument is a *global property allow-list applied at every nesting level*, not a
 * per-level sort, and this exact mistake made a hash function elsewhere in this
 * codebase collide on every input; see `tool-registry`'s `hashSchemas()` history) so
 * two structurally-identical objects with differently-ordered keys hash identically.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function hashDefinitionArtifact(artifact: unknown): string {
  const canonical = JSON.stringify(canonicalize(artifact));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
