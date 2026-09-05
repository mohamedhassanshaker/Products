import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { EvalSuitesList } from "./EvalSuitesList";

export default async function EvalsPage() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <EvalSuitesList canWrite={level === "Write"} />;
}
