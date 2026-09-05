import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ConversationDetail } from "./ConversationDetail";

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("conversations");
  if (level === "None") return <AccessDeniedState moduleLabel="Conversations" />;
  const { id } = await params;
  return <ConversationDetail conversationId={id} permissionLevel={level} />;
}
