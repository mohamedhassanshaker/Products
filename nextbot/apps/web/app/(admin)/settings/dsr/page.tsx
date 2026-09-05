import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { DsrTool } from "./DsrTool";

/** B.8.4 "Process Data Subject Request" GDPR tool (RBAC: security_settings). */
export default async function DsrPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Data Subject Requests" />;
  return <DsrTool permissionLevel={level} />;
}
