import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { AuditLogViewer } from "./AuditLogViewer";

/** B.8.2 Audit Log Viewer (RBAC module: `audit_log`). */
export default async function AuditLogPage() {
  const level = await getModuleAccessLevel("audit_log");
  if (level === "None") return <AccessDeniedState moduleLabel="Audit Log" />;
  return <AuditLogViewer />;
}
