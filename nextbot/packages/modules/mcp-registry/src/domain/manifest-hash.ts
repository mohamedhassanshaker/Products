import { createHash } from "node:crypto";

/**
 * ADR-0014 §2.1 — "hash canonicalization matters and is part of the decision, not an
 * implementation detail." Recursively sorts object keys so two structurally identical
 * schemas serialized in different key order (a server that reserializes its schema
 * differently on each boot) hash identically — the same recursive-sort discipline
 * `agent-platform`'s `definition-hash.ts` already established, deliberately not
 * `JSON.stringify`'s replacer-array form (a global property allow-list, not a
 * per-level sort — the exact mistake that caused a hash collision bug elsewhere in
 * this codebase, per that file's own doc comment).
 *
 * `default`/`title`/`description` are included (they reach the model, so they are
 * part of the contract, per ADR-0014 §2.1) — this function makes no attempt to strip
 * them; property *ordering* is what's normalized away, not any field's presence.
 */
export function canonicalizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSchema);
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalizeSchema((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

/** ADR-0014 §2.1 — `schema_hash`: sha256 over the canonical form of one item's JSON
 * Schema (input + output, where both exist — this phase's `Tool`-only discovery
 * scope, see the schema file's doc comment, means the input is `inputSchema` and the
 * caller decides what else to fold in; the hash itself doesn't care about the
 * source's shape, only that it's canonicalized first). */
export function computeSchemaHash(schemaJson: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalizeSchema(schemaJson)), "utf8").digest("hex");
}

export interface ManifestHashItem {
  kind: string;
  name: string;
  schemaHash: string;
}

/** ADR-0014 §2.1 — `manifest_hash`: sha256 over the sorted list of `(kind, name,
 * schema_hash)` tuples, sorted by `(kind, name)`. **This is the pinned value** — the
 * reconciler recomputes this over the live server's current tool set and compares it
 * to the pinned `mcp_server_version.manifest_hash` to decide whether anything to
 * investigate has happened at all (LLD §14.3.2). Sorting by `(kind, name)` before
 * hashing means the live server returning its tool list in a different order between
 * reconciler runs never looks like drift. */
export function computeManifestHash(items: ManifestHashItem[]): string {
  const sorted = [...items].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));
  const canonical = sorted.map((i) => ({ kind: i.kind, name: i.name, schemaHash: i.schemaHash }));
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}
