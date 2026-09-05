import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ConversationsList } from "./ConversationsList";

/** QA Defect U3 pattern (FR-ADM-02 fail-closed deep-link guard) applied from day one. */
export default async function ConversationsPage() {
  const level = await getModuleAccessLevel("conversations");
  if (level === "None") return <AccessDeniedState moduleLabel="Conversations" />;
  return <ConversationsList permissionLevel={level} />;
}
