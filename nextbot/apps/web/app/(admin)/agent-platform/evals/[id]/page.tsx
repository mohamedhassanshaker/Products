import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { EvalSuiteDetail } from "./EvalSuiteDetail";

export default async function EvalSuiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { id } = await params;
  return <EvalSuiteDetail suiteId={id} canWrite={level === "Write"} />;
}
