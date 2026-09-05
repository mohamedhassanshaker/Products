import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { CommunityDetail } from "./CommunityDetail";

/** Community view (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04),
 *  gated on `knowledge` (Read is sufficient — read-only screen). */
export default async function CommunityDetailPage({ params }: { params: Promise<{ id: string; generationId: string; communityId: string }> }) {
  const { id, generationId, communityId } = await params;
  const level = await getModuleAccessLevel("knowledge");
  if (level === "None") return <AccessDeniedState moduleLabel="Knowledge" />;
  return <CommunityDetail collectionId={id} generationId={generationId} communityId={communityId} />;
}
