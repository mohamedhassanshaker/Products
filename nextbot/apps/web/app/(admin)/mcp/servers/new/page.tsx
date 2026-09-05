import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { McpEnrolmentWizard } from "./McpEnrolmentWizard";

/**
 * Phase 3 (BL-34) — the 9-step MCP enrolment wizard entry point. Gated `Write` (not
 * merely `None`): this screen's only purpose is a mutating action, matching
 * `/connectors/new`'s own established precedent (`docs/design/UX_GUIDELINES.md` §2.3
 * fail-closed deep-link guard).
 */
export default async function NewMcpServerPage() {
  const level = await getModuleAccessLevel("connectors");
  if (level !== "Write") return <AccessDeniedState moduleLabel="Connectors" />;
  return <McpEnrolmentWizard />;
}
