import type { TenantContext } from "@nextbot/db";
import { KnowledgeCollectionNotFoundError } from "@nextbot/contracts";
import { getCollectionByName } from "../infrastructure/collection-repository.js";

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05, Blueprint §7.5) —
 * resolves an agent version's authored `spec.knowledge.collections` pin
 * (`"<name>@<N>"`) to a real, existing `knowledge_collection.id` for THIS tenant, at
 * agent-version SAVE time (`@nextbot/agent-platform`'s `createAgentDefinitionVersion`,
 * the one caller of this function — mirrors `@nextbot/skills`'s `resolveSkillPin`
 * exactly: "first unresolvable reference fails the save, nothing dangling persisted").
 *
 * The trailing `@N` is intentionally NOT used to select a specific generation — see
 * `AgentKnowledgeConfigInput.collections`'s own doc comment in `@nextbot/contracts`
 * for why (a knowledge collection's generations are continuously rebuilt, unlike an
 * immutable skill/agent version; LLD §14.4.4 step 1 always resolves the collection's
 * LIVE `current_generation_id` at retrieval time, never a pinned generation number).
 */
export async function resolveKnowledgeCollectionPin(ctx: TenantContext, pin: string): Promise<{ collectionId: string; collectionName: string }> {
  const atIndex = pin.lastIndexOf("@");
  const name = atIndex === -1 ? pin : pin.slice(0, atIndex);
  const collection = await getCollectionByName(ctx, name);
  if (!collection) throw new KnowledgeCollectionNotFoundError(name);
  return { collectionId: collection.id, collectionName: collection.name };
}
