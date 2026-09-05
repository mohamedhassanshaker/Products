import { createHash } from "node:crypto";

/**
 * Deterministic sha256 of the `(tenantPolicy, chain, requested)` triple (LLD
 * §14.2.2's `scopeHash` — the cache key and the value written to
 * `tool_call.scope_hash`/`delegation_event.scope_hash`). Same recursive-key-sort
 * canonicalisation `agent-platform`'s `definition-hash.ts` and `skills`'
 * `skill-hash.ts` use — copied rather than imported (this module has no allowed
 * dependency on either, and it's a ~10-line pure function).
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

export function hashScopeInput(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
