import { redirect } from "next/navigation";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { SkillForm } from "../SkillForm";

/** Gated on `agent_platform=Write` — the entire page is a mutating action (same
 * convention as `/agent-platform/definitions/[id]/versions/new`). */
export default async function NewSkillPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level !== "Write") redirect("/skills");
  return <SkillForm mode="create" />;
}
