import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ConnectorsList } from "./ConnectorsList";

/**
 * QA Defect U3 (FR-ADM-02 fail-closed deep-link guard): a role with `None` access to
 * `connectors` must see the full-page "You don't have access to this section" state
 * on a direct deep link — checked server-side, before `ConnectorsList` (and its
 * client-side data fetch) ever renders.
 */
export default async function ConnectorsPage() {
  const level = await getModuleAccessLevel("connectors");
  if (level === "None") return <AccessDeniedState moduleLabel="Connectors" />;
  return <ConnectorsList permissionLevel={level} />;
}
