import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ChannelsList } from "./ChannelsList";

/** QA Defect U3 pattern (FR-ADM-02 fail-closed deep-link guard), applied to the new
 * Channels screen from day one rather than retrofitted after a QA finding. */
export default async function ChannelsPage() {
  const level = await getModuleAccessLevel("channels");
  if (level === "None") return <AccessDeniedState moduleLabel="Channels" />;
  return <ChannelsList permissionLevel={level} />;
}
