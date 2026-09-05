import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { GraphExplorer } from "./GraphExplorer";

/**
 * Graph Explorer entry page (Target Architecture Blueprint Phase 8, BL-39,
 * FR-KB-04). Gated on the `knowledge` module (same module/RBAC boundary Phase 7b's
 * Collections screens use — read-only browsing needs `Read`, never `Write`; this
 * phase adds no mutation capability over the graph).
 */
export default async function GraphExplorerPage({ params }: { params: Promise<{ id: string; generationId: string }> }) {
  const { id, generationId } = await params;
  const level = await getModuleAccessLevel("knowledge");
  if (level === "None") return <AccessDeniedState moduleLabel="Knowledge" />;
  return <GraphExplorer collectionId={id} generationId={generationId} />;
}
