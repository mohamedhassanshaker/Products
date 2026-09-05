import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { ProviderRegistryAndCatalog } from "./ProviderRegistryAndCatalog";

/** Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8) — the new
 * Provider Registry + Model Catalog console. RBAC gated on `agent_platform`, the same
 * module the pre-existing v1 Model Gateway screen uses (LLD/spec are silent on a
 * dedicated module for Module F this phase, and HLD §15.2.1 lists "Model Gateway v2"
 * under `agent-platform`'s owned surface) — fail-closed: `None` hides the whole page. */
export default async function ModelGatewayV2Page() {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  return <ProviderRegistryAndCatalog canWrite={level === "Write"} />;
}
