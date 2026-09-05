import type { TenantContext } from "@nextbot/db";
import type { CreateConnectorRequest } from "@nextbot/contracts";
import { createConnector } from "../application/create-connector.js";
import { discoverTools } from "../application/discover-tools.js";
import { listConnectors, findConnectorById } from "../infrastructure/connector-repository.js";

/**
 * `http/` layer (LLD §2.2): plain `(ctx, input) => output` functions with NO RBAC
 * check inside them — `connectors` cannot depend on `iam` (LLD §2.3's allow-list is
 * `connectors -> tenancy, secrets` only), so `requirePermission(...)` for the
 * `connectors` RBAC module is called by the composition root
 * (`apps/web/app/api/v1/admin/connectors/**\/route.ts`), which is free to import both
 * `@nextbot/iam` and `@nextbot/connectors`.
 */

export async function handleListConnectors(ctx: TenantContext) {
  return listConnectors(ctx);
}

export async function handleGetConnector(ctx: TenantContext, id: string) {
  return findConnectorById(ctx, id);
}

export async function handleCreateConnector(ctx: TenantContext, input: CreateConnectorRequest) {
  return createConnector(ctx, input);
}

export async function handleDiscoverTools(ctx: TenantContext, connectorId: string) {
  return discoverTools(ctx, connectorId);
}
