import { redirect } from "next/navigation";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { StudioWizard } from "./StudioWizard";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13) — the Agent Design
 * Studio's own entry point, alongside `/versions/new` (Text/Design mode).
 * Gated `Write` (same convention as `/versions/new` and `/mcp/servers/new` —
 * this whole screen is a mutating action).
 */
export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  const { id } = await params;
  if (level !== "Write") redirect(`/agent-platform/definitions/${id}`);
  return <StudioWizard definitionId={id} />;
}
