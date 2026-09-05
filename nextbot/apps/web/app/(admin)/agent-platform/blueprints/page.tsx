import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { BlueprintsGallery } from "./BlueprintsGallery";

/** Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-15) — read access is
 * enough to browse the gallery; instantiating (a mutating action) is its own
 * `Write`-gated route, matching every other list/detail-vs-action split in this
 * console. */
export default async function BlueprintsPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <BlueprintsGallery />;
}
