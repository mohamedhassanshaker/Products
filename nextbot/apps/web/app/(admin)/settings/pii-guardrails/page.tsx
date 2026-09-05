import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { PiiGuardrailSettings } from "./PiiGuardrailSettings";

/** FR-SEC-04 PII detection/masking + guardrail authoring (RBAC: security_settings). */
export default async function PiiGuardrailsPage() {
  const level = await getModuleAccessLevel("security_settings");
  if (level === "None") return <AccessDeniedState moduleLabel="PII & Guardrails" />;
  return <PiiGuardrailSettings permissionLevel={level} />;
}
