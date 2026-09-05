import { randomUUID } from "node:crypto";
import { assertValidGenerationLabel } from "@nextbot/graph-store";

/**
 * Mints a fresh, unique `graph_generation_label` (LLD §14.4.2/§14.4.6) — the value
 * stored on `knowledge_index_generation.graph_generation_label` AND passed as
 * `GraphScope.generationId` on every `GraphStorePort` call for this generation
 * (ADR-0018 §2.3: a correctness-boundary predicate, not the tenant's security
 * boundary). Format `G_<32 lowercase hex chars>` — label-safe (leading letter, hex
 * only), matching `@nextbot/graph-store`'s own `assertValidGenerationLabel` regex
 * exactly, which this function asserts against itself before returning so a
 * malformed label can never leave this one place.
 */
export function mintGenerationGraphLabel(): string {
  const hex = randomUUID().replace(/-/g, "").toLowerCase();
  const label = `G_${hex}`;
  assertValidGenerationLabel(label);
  return label;
}
