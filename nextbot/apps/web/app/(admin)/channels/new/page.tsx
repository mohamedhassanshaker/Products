import { redirect } from "next/navigation";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ChannelTypePicker } from "./ChannelTypePicker";

/** Gated on `channels=Write` specifically — the entire page is a mutating action
 * (same convention as `/connectors/new`). FR-OC-03: the type-selection step
 * (UX_GUIDELINES.md §7.1) now precedes the type-specific form. */
export default async function NewChannelPage() {
  const level = await getModuleAccessLevel("channels");
  if (level !== "Write") redirect("/channels");
  return <ChannelTypePicker />;
}
