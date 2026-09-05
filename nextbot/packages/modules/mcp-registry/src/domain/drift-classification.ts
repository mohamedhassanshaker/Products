import { createHash } from "node:crypto";

/** ADR-0014 §2.2's decision table, expressed as a pure function over one live tool's
 * discovered shape compared against the pinned manifest items it's being reconciled
 * against — no I/O, exhaustively unit-testable (mirrors this codebase's
 * `promotion-policy.ts`/`emergency-rollback-policy.ts` convention of keeping the
 * actual decision logic DB-free). */
export interface PinnedManifestItem {
  name: string;
  schemaHash: string;
}

export interface LiveTool {
  name: string;
  schemaHash: string;
}

export type DriftChangeKind = "ItemAdded" | "ItemRemoved" | "SchemaChanged";

export interface DriftClassification {
  changeKind: DriftChangeKind;
  itemName: string;
  oldSchemaHash: string | null;
  newSchemaHash: string | null;
}

/**
 * ADR-0014 §2.2's three drift rows, computed by name-matching the live tool set
 * against the pinned manifest item set:
 *   - A live name not in the pinned set -> `ItemAdded`.
 *   - A pinned name not in the live set -> `ItemRemoved` (the pinned item stays
 *     callable; this is a reporting fact, not a mutation — the caller decides what,
 *     if anything, to do with it).
 *   - A name in both sets whose `schemaHash` differs -> `SchemaChanged` — **this is
 *     the security-critical row**: treated as an entirely new item identity by the
 *     caller (never an in-place update), so nothing approved for the old shape is
 *     silently approved for the new one.
 *   - A name in both sets with the same `schemaHash` -> no classification (not
 *     returned) — this is the cosmetic-change/idempotency case ADR-0014 §2.1's
 *     canonicalization exists to make correctly common.
 */
export function classifyDrift(pinnedItems: PinnedManifestItem[], liveTools: LiveTool[]): DriftClassification[] {
  const pinnedByName = new Map(pinnedItems.map((i) => [i.name, i]));
  const liveByName = new Map(liveTools.map((t) => [t.name, t]));
  const out: DriftClassification[] = [];

  for (const [name, live] of liveByName) {
    const pinned = pinnedByName.get(name);
    if (!pinned) {
      out.push({ changeKind: "ItemAdded", itemName: name, oldSchemaHash: null, newSchemaHash: live.schemaHash });
    } else if (pinned.schemaHash !== live.schemaHash) {
      out.push({ changeKind: "SchemaChanged", itemName: name, oldSchemaHash: pinned.schemaHash, newSchemaHash: live.schemaHash });
    }
  }
  for (const [name, pinned] of pinnedByName) {
    if (!liveByName.has(name)) {
      out.push({ changeKind: "ItemRemoved", itemName: name, oldSchemaHash: pinned.schemaHash, newSchemaHash: null });
    }
  }
  return out;
}

/**
 * ADR-0014 §2.2's idempotency key: `sha256(pinnedVersionId‖changeKind‖itemKind‖
 * itemName‖coalesce(newSchemaHash,''))`. Three consecutive reconciler runs against an
 * unchanged server compute the exact same key for the exact same (would-be) drift
 * event every time, so the partial-unique-index `ON CONFLICT DO NOTHING` at the
 * repository layer is what actually makes repeated runs write zero new rows —  this
 * function only has to be deterministic, which it is by construction (no randomness,
 * no timestamp).
 */
export function computeDriftDedupeKey(input: { pinnedVersionId: string; changeKind: DriftChangeKind; itemKind: string; itemName: string; newSchemaHash: string | null }): string {
  const raw = [input.pinnedVersionId, input.changeKind, input.itemKind, input.itemName, input.newSchemaHash ?? ""].join("‖");
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
