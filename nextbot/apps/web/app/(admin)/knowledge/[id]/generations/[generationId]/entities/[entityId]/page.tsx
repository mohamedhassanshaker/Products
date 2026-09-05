import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { EntityDetail } from "./EntityDetail";

/** Entity inspector (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04),
 *  gated on `knowledge` (Read is sufficient — read-only screen). */
export default async function EntityDetailPage({ params }: { params: Promise<{ id: string; generationId: string; entityId: string }> }) {
  const { id, generationId, entityId } = await params;
  const level = await getModuleAccessLevel("knowledge");
  if (level === "None") return <AccessDeniedState moduleLabel="Knowledge" />;
  return <EntityDetail collectionId={id} generationId={generationId} entityId={entityId} />;
}
