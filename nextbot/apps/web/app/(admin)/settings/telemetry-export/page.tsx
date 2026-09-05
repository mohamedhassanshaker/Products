import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { TelemetryExportSettings } from "./TelemetryExportSettings";

/** Settings → Telemetry Export (Target Architecture Blueprint Phase 18, BL-49,
 * FR-ADM-10). RBAC: `security_settings`, the same module the webhooks screen uses. */
export default async function TelemetryExportPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="Telemetry Export" />;
  return <TelemetryExportSettings permissionLevel={level} />;
}
