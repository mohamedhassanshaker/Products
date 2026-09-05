import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ChannelTest } from "./ChannelTest";

/** QA Defect U3 pattern (FR-ADM-02 fail-closed deep-link guard), applied to this new
 * screen from day one, matching `channels/page.tsx`'s own convention. */
export default async function ChannelTestPage({ params }: { params: Promise<{ channelId: string }> }) {
  const level = await getModuleAccessLevel("channels");
  if (level === "None") return <AccessDeniedState moduleLabel="Channels" />;
  const { channelId } = await params;
  return <ChannelTest channelId={channelId} />;
}
