import { redirect } from "next/navigation";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { VersionEditor } from "./VersionEditor";

/** Gated on `agent_platform=Write` — the entire page is a mutating action (same
 * convention as `/connectors/new`). */
export default async function NewVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  const { id } = await params;
  if (level !== "Write") redirect(`/agent-platform/definitions/${id}`);
  return <VersionEditor definitionId={id} />;
}
