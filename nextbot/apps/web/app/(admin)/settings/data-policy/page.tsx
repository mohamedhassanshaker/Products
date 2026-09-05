import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { DataPolicySettings } from "./DataPolicySettings";

/** B.8.4 Retention & Residency settings (RBAC: security_settings). */
export default async function DataPolicyPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Retention & Residency" />;
  return <DataPolicySettings permissionLevel={level} />;
}
