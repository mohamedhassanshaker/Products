import type { TenantContext } from "@nextbot/db";
import type { CreateModelRouteRequest, CreateModelRouteVersionRequest } from "@nextbot/contracts";
import * as routes from "../application/route-service.js";
import { getUsageReport, getCostPerResolvedConversation, type UsageGroupBy } from "../application/usage-service.js";

/** `http/` layer (LLD §2.2) — plain functions; RBAC checks (`agent_platform` module,
 * matching the existing Model Gateway console's convention) are applied by the
 * composition root (`apps/web`). LLD §14.8.5's API surface. */

export async function handleCreateRoute(ctx: TenantContext, input: CreateModelRouteRequest) {
  return routes.createRoute(ctx, input);
}

export async function handleListRoutes(ctx: TenantContext) {
  return routes.listRoutes(ctx);
}

export async function handleGetRoute(ctx: TenantContext, id: string) {
  return routes.getRouteOrThrow(ctx, id);
}

export async function handleListRouteVersions(ctx: TenantContext, routeId: string) {
  return routes.listVersionsForRoute(ctx, routeId);
}

/** `POST /routes/{id}/versions` — returns the created version on success; a
 * `RouteValidationFailedError`/`RouteCapabilityUnsatisfiedError` thrown here maps to a
 * 422 with the exact offending hop(s) named (composition root's `problemResponse`). */
export async function handleCreateRouteVersion(ctx: TenantContext, routeId: string, input: CreateModelRouteVersionRequest & { publish?: boolean }, createdByUserId?: string) {
  return routes.createRouteVersion(ctx, routeId, { chain: input.chain, policy: input.policy, createdByUserId }, input.publish ?? false);
}

/** `POST /routes/{id}/versions/validate` — dry run, never saves. */
export async function handleValidateRouteVersion(ctx: TenantContext, routeId: string, input: CreateModelRouteVersionRequest) {
  return routes.validateRouteVersionDryRun(ctx, routeId, input);
}

export async function handlePublishRouteVersion(ctx: TenantContext, routeId: string, versionId: string) {
  return routes.publishRouteVersion(ctx, routeId, versionId);
}

export async function handleGetStandardRoutes(ctx: TenantContext) {
  return routes.getStandardRoutesChecklist(ctx);
}

export async function handleGetUsageReport(ctx: TenantContext, input: { from: string; to: string; groupBy: UsageGroupBy }) {
  return getUsageReport(ctx, { from: new Date(input.from), to: new Date(input.to), groupBy: input.groupBy });
}

export async function handleGetCostPerResolvedConversation(ctx: TenantContext, input: { from: string; to: string }) {
  return getCostPerResolvedConversation(ctx, { from: new Date(input.from), to: new Date(input.to) });
}
