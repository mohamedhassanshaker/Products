import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { KnowledgeCollectionsList } from "./KnowledgeCollectionsList";

/**
 * Knowledge Collections list (Target Architecture Blueprint Phase 7b, BL-38,
 * ADR-0018, LLD §14.4). Gated on the new `knowledge` module (blueprint §5.2) — a
 * routine CRUD list/detail screen this project's Skills Library screen already
 * documents the pattern for (list -> detail -> create form), so no `nexus-ux`
 * dispatch was made for this phase (per this agent's own guidance to apply an
 * existing documented pattern rather than re-derive it). No Figma input was
 * supplied for this feature.
 */
export default async function KnowledgePage() {
  const level = await getModuleAccessLevel("knowledge");
  if (level === "None") return <AccessDeniedState moduleLabel="Knowledge" />;
  return <KnowledgeCollectionsList canWrite={level === "Write"} />;
}
