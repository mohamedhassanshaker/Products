import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { CollectionDetail } from "./CollectionDetail";

export default async function KnowledgeCollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const level = await getModuleAccessLevel("knowledge");
  if (level === "None") return <AccessDeniedState moduleLabel="Knowledge" />;
  const configLevel = await getModuleAccessLevel("knowledge_config");
  return <CollectionDetail collectionId={id} canWrite={level === "Write"} canWriteConfig={configLevel === "Write"} />;
}
