import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ApprovalQueue } from "./ApprovalQueue";

/** B.3.6 Approval Queue (RBAC module: `approval_queue`). FR-ADM-02 fail-closed
 * deep-link guard applied from day one, same pattern as every other Admin Console page. */
export default async function ApprovalsPage() {
  const level = await getModuleAccessLevel("approval_queue");
  if (level === "None") return <AccessDeniedState moduleLabel="Approval Queue" />;
  return <ApprovalQueue permissionLevel={level} />;
}
