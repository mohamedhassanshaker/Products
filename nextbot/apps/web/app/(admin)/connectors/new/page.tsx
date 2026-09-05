import { redirect } from "next/navigation";
import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";

/**
 * Phase 3 (BL-34, LLD §14.3.1): "after the migration, the 'Add Connector' entry
 * point redirects to the wizard." This v1 single-page form (`ConnectorWizard.tsx`,
 * still present and still covered by its own test — nothing here is deleted) is
 * superseded for new enrolments by the 9-step `/mcp/servers/new` wizard, which
 * additionally captures per-environment bindings, manifest pinning, classification,
 * grouping, runtime policy, and a dry run this older form never did. The direct
 * `POST /api/v1/admin/connectors` API route itself is deliberately left working
 * unchanged (retained for the Developer Portal/API per LLD §14.3.1) — only this UI
 * entry point redirects.
 */
export default async function NewConnectorPage() {
  const level = await getModuleAccessLevel("connectors");
  if (level !== "Write") return <AccessDeniedState moduleLabel="Connectors" />;
  redirect("/mcp/servers/new");
}
