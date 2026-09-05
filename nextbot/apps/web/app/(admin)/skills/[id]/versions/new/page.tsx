import { redirect } from "next/navigation";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { NewSkillVersionForm } from "./NewSkillVersionForm";

/** Gated on `agent_platform=Write` — the entire page is a mutating action. */
export default async function NewSkillVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  const { id } = await params;
  if (level !== "Write") redirect(`/skills/${id}`);
  return <NewSkillVersionForm skillId={id} />;
}
