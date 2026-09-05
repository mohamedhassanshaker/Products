import { redirect } from "next/navigation";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { WhatsAppChannelConfig } from "./WhatsAppChannelConfig";

/** FR-OC-03/FR-META B.2.3 config screen. Gated on `channels` (Read at minimum —
 * the client component itself disables every mutating control when the session is
 * read-only, same convention as the rest of the Admin Console per
 * UX_GUIDELINES.md §2.3). */
export default async function WhatsAppChannelConfigPage({ params }: { params: Promise<{ channelId: string }> }) {
  const level = await getModuleAccessLevel("channels");
  if (level === "None") redirect("/channels");
  const { channelId } = await params;
  return <WhatsAppChannelConfig channelId={channelId} canWrite={level === "Write"} />;
}
