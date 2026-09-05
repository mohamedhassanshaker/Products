import type { TenantContext } from "@nextbot/db";
import type {
  McpAuthRequest,
  McpClassifyRequest,
  McpDryRunRequest,
  McpGroupingRequest,
  McpIdentifyRequest,
  McpRuntimePolicy,
  McpTransportRequest,
} from "@nextbot/contracts";
import {
  createServerWithApprovedVersion,
  getServer,
  listBindingsForVersion,
  listPendingDriftEvents,
  listServers,
  listServerVersions,
  reviewDrift,
  type McpManifestItemInput,
} from "../infrastructure/mcp-server-repository.js";
import { reconcileServer } from "../application/reconciler.js";
import { migrateExistingConnectorsForTenant } from "../application/connector-migration.js";
import {
  createDraft,
  deleteEnrolmentDraft,
  getEnrolmentDraft,
  submitAuth,
  submitClassify,
  submitDiscover,
  submitDryRun,
  submitEnrol,
  submitGrouping,
  submitIdentify,
  submitPolicy,
  submitTransport,
} from "../application/enrolment-draft-service.js";

/** `http/` layer (LLD §2.2) — plain functions; RBAC checks (the `connectors` module,
 * matching this platform's existing convention that MCP-server-shaped configuration is
 * gated the same way connector configuration is) are applied by the composition root
 * (`apps/web`). */

export async function handleCreateServer(
  ctx: TenantContext,
  input: { name: string; description?: string; endpointUrl: string; transport?: string; credentialId?: string | null; reconcileIntervalSeconds?: number; items: McpManifestItemInput[] },
  createdByUserId: string,
) {
  return createServerWithApprovedVersion(ctx, { ...input, createdByUserId });
}

export async function handleGetServer(ctx: TenantContext, id: string) {
  return getServer(ctx, id);
}

export async function handleReconcileServer(ctx: TenantContext, id: string) {
  const server = await getServer(ctx, id);
  if (!server) throw new Error(`mcp_server '${id}' not found`);
  return reconcileServer(ctx, server);
}

export async function handleListPendingDrift(ctx: TenantContext, serverId: string) {
  return listPendingDriftEvents(ctx, serverId);
}

export async function handleReviewDrift(
  ctx: TenantContext,
  serverId: string,
  decisions: Parameters<typeof reviewDrift>[2],
  actorUserId: string,
) {
  return reviewDrift(ctx, serverId, decisions, actorUserId);
}

export async function handleListServers(ctx: TenantContext) {
  return listServers(ctx);
}

export async function handleListServerVersions(ctx: TenantContext, serverId: string) {
  return listServerVersions(ctx, serverId);
}

export async function handleListBindingsForVersion(ctx: TenantContext, serverVersionId: string) {
  return listBindingsForVersion(ctx, serverVersionId);
}

export async function handleMigrateExistingConnectors(ctx: TenantContext, actorUserId: string) {
  return migrateExistingConnectorsForTenant(ctx, actorUserId);
}

// ---- 9-step enrolment wizard (Phase 3, BL-34, LLD §14.3.4) ----

export async function handleCreateDraft(ctx: TenantContext, createdByUserId: string) {
  return createDraft(ctx, createdByUserId);
}

export async function handleGetDraft(ctx: TenantContext, draftId: string) {
  return getEnrolmentDraft(ctx, draftId);
}

export async function handleDeleteDraft(ctx: TenantContext, draftId: string) {
  return deleteEnrolmentDraft(ctx, draftId);
}

export async function handleSubmitIdentify(ctx: TenantContext, draftId: string, input: McpIdentifyRequest) {
  return submitIdentify(ctx, draftId, input);
}

export async function handleSubmitTransport(ctx: TenantContext, draftId: string, input: McpTransportRequest) {
  return submitTransport(ctx, draftId, input);
}

export async function handleSubmitAuth(ctx: TenantContext, draftId: string, input: McpAuthRequest) {
  return submitAuth(ctx, draftId, input);
}

export async function handleSubmitDiscover(ctx: TenantContext, draftId: string) {
  return submitDiscover(ctx, draftId);
}

export async function handleSubmitClassify(ctx: TenantContext, draftId: string, input: McpClassifyRequest) {
  return submitClassify(ctx, draftId, input);
}

export async function handleSubmitGrouping(ctx: TenantContext, draftId: string, input: McpGroupingRequest) {
  return submitGrouping(ctx, draftId, input);
}

export async function handleSubmitPolicy(ctx: TenantContext, draftId: string, input: McpRuntimePolicy) {
  return submitPolicy(ctx, draftId, input);
}

export async function handleSubmitDryRun(ctx: TenantContext, draftId: string, input: McpDryRunRequest) {
  return submitDryRun(ctx, draftId, input);
}

export async function handleSubmitEnrol(ctx: TenantContext, draftId: string, actorUserId: string) {
  return submitEnrol(ctx, draftId, actorUserId);
}
