import { createHash } from "node:crypto";

/**
 * Deterministic sha256 of a skill artifact (LLD §14.5.2's `yaml_hash` — the FR-AGT-19
 * structural-diff key, and `skills.immutability.int.test.ts`'s drift-detection
 * comparison). Same recursive-key-sort canonicalisation `agent-platform`'s
 * `definition-hash.ts` uses (not duplicated via import — `skills` and
 * `agent-platform` are on opposite ends of the module allow-list edge, so this
 * small, pure, ~10-line function is copied rather than creating a dependency either
 * direction just to share it).
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

export function hashSkillArtifact(artifact: unknown): string {
  const canonical = JSON.stringify(canonicalize(artifact));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
