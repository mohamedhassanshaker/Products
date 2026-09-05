import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { McpServerNameDuplicateError } from "@nextbot/contracts";
import { computeManifestHash, computeSchemaHash } from "../domain/manifest-hash.js";

export interface McpServerRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  endpointUrl: string;
  transport: string;
  credentialId: string | null;
  status: "Active" | "Suspended" | "Retired";
  currentVersionId: string | null;
  reconcileIntervalSeconds: number;
  lastReconciledAt: Date | null;
  reachability: "Unknown" | "Reachable" | "Unreachable";
  lastProbeError: unknown;
  // Phase 3 (BL-34) additions — nullable/defaulted, see schema file's doc comment.
  backendType?: string | null;
  ownerUserId?: string | null;
  criticality?: "Low" | "Medium" | "High" | "BusinessCritical";
  trustLevel?: "Trusted" | "SemiTrusted" | "Untrusted";
}

export interface McpManifestItemInput {
  kind: "Tool" | "Resource" | "Prompt";
  name: string;
  descriptionSource: string;
  schemaJson: unknown;
  approvalTier?: "Tier1" | "Tier2" | "Tier3";
  enabled?: boolean;
  capabilityGroupId?: string | null;
}

/**
 * Bootstraps a server directly into an `Approved` v1 — this phase's stand-in for the
 * BL-34 enrolment wizard's steps 1/4/6/9 (identify, discover+hash, group, enrol). Every
 * item defaults fail-closed (`Tier3`, `enabled: false`) unless the caller explicitly
 * overrides it — mirrors FR-MCP-16's wizard-step-5 default, applied here since this
 * phase has no human classification step of its own.
 */
export async function createServerWithApprovedVersion(
  ctx: TenantContext,
  input: {
    name: string;
    description?: string;
    endpointUrl: string;
    transport?: string;
    credentialId?: string | null;
    reconcileIntervalSeconds?: number;
    items: McpManifestItemInput[];
    createdByUserId: string;
  },
): Promise<{ server: McpServerRow; serverVersionId: string }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const serverId = generateId();
    const versionId = generateId();

    const itemsWithHashes = input.items.map((item) => ({ ...item, schemaHash: computeSchemaHash(item.schemaJson) }));
    const manifestHash = computeManifestHash(itemsWithHashes.map((i) => ({ kind: i.kind, name: i.name, schemaHash: i.schemaHash })));

    await db.insert(schema.mcpServer).values({
      id: serverId,
      tenantId: ctx.tenantId,
      name: input.name,
      description: input.description ?? null,
      endpointUrl: input.endpointUrl,
      transport: input.transport ?? "StreamableHTTP",
      credentialId: input.credentialId ?? null,
      reconcileIntervalSeconds: input.reconcileIntervalSeconds ?? 3600,
      createdByUserId: input.createdByUserId,
    });

    await db.insert(schema.mcpServerVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      serverId,
      version: 1,
      manifestHash,
      itemCount: itemsWithHashes.length,
      status: "Approved",
      approvedByUserId: input.createdByUserId,
      approvedAt: new Date(),
      createdByUserId: input.createdByUserId,
    });

    if (itemsWithHashes.length > 0) {
      await db.insert(schema.mcpManifestItem).values(
        itemsWithHashes.map((item) => ({
          id: generateId(),
          tenantId: ctx.tenantId,
          serverVersionId: versionId,
          kind: item.kind,
          name: item.name,
          descriptionSource: item.descriptionSource,
          schemaJson: item.schemaJson as object,
          schemaHash: item.schemaHash,
          approvalTier: item.approvalTier ?? "Tier3",
          enabled: item.enabled ?? false,
          capabilityGroupId: item.capabilityGroupId ?? null,
        })),
      );
    }

    await db.update(schema.mcpServer).set({ currentVersionId: versionId }).where(eq(schema.mcpServer.id, serverId));

    const [server] = await db.select().from(schema.mcpServer).where(eq(schema.mcpServer.id, serverId));
    return { server: server as McpServerRow, serverVersionId: versionId };
  });
}

export async function getServerVersionManifestHash(ctx: TenantContext, serverVersionId: string): Promise<string | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db
      .select({ manifestHash: schema.mcpServerVersion.manifestHash })
      .from(schema.mcpServerVersion)
      .where(and(eq(schema.mcpServerVersion.tenantId, ctx.tenantId), eq(schema.mcpServerVersion.id, serverVersionId)));
    return row?.manifestHash ?? null;
  });
}

export async function getServer(ctx: TenantContext, id: string): Promise<McpServerRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db.select().from(schema.mcpServer).where(and(eq(schema.mcpServer.tenantId, ctx.tenantId), eq(schema.mcpServer.id, id)));
    return (row as McpServerRow) ?? null;
  });
}

/** LLD §14.3.2 — `mcp_server.name` is UNIQUE `(tenant_id, name)`. Used by the wizard's
 * step 1 (identify) for early feedback and by step 9 (enrol)'s authoritative check. */
export async function findServerByName(ctx: TenantContext, name: string): Promise<McpServerRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db.select().from(schema.mcpServer).where(and(eq(schema.mcpServer.tenantId, ctx.tenantId), eq(schema.mcpServer.name, name)));
    return (row as McpServerRow) ?? null;
  });
}

/** Phase 3 (BL-34) — lists every server for the registry list screen (`/mcp/servers`). */
export async function listServers(ctx: TenantContext): Promise<McpServerRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) =>
    db.select().from(schema.mcpServer).where(eq(schema.mcpServer.tenantId, ctx.tenantId)),
  ) as Promise<McpServerRow[]>;
}

/** Phase 3 (BL-34) — every version of a server, newest first, for the detail screen's
 * "Versions" tab. */
export async function listServerVersions(ctx: TenantContext, serverId: string) {
  return withTenant(ctx, async (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.mcpServerVersion)
      .where(and(eq(schema.mcpServerVersion.tenantId, ctx.tenantId), eq(schema.mcpServerVersion.serverId, serverId)))
      .orderBy(desc(schema.mcpServerVersion.version)),
  );
}

/** Target Architecture Blueprint Phase 15 (BL-47a, FR-MCP-21) — resolves a single
 * `mcp_server_version` by id, for a caller (`@nextbot/workflows`' graph validator,
 * V9) that pins an exact version and needs its `status` (a `ToolCall` node's
 * `mcpServerVersionId` must resolve to this tenant's own, non-`Superseded` version).
 * `null` (never a throw) when absent/not this tenant's. */
export interface McpServerVersionRow {
  id: string;
  tenantId: string;
  serverId: string;
  version: number;
  manifestHash: string;
  status: "Draft" | "Approved" | "Superseded";
  createdAt: Date;
}

export async function findServerVersionById(ctx: TenantContext, id: string): Promise<McpServerVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.mcpServerVersion).where(and(eq(schema.mcpServerVersion.tenantId, ctx.tenantId), eq(schema.mcpServerVersion.id, id)));
    return (rows[0] as McpServerVersionRow | undefined) ?? null;
  });
}

export async function listManifestItems(ctx: TenantContext, serverVersionId: string): Promise<Array<{ id: string; kind: string; name: string; schemaHash: string; enabled: boolean }>> {
  return withTenant(ctx, async (db: TenantScopedClient) =>
    db
      .select({ id: schema.mcpManifestItem.id, kind: schema.mcpManifestItem.kind, name: schema.mcpManifestItem.name, schemaHash: schema.mcpManifestItem.schemaHash, enabled: schema.mcpManifestItem.enabled })
      .from(schema.mcpManifestItem)
      .where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, serverVersionId))),
  );
}

/** Phase 3 (BL-34) — the full manifest-item projection for the detail screen's
 * Manifest/Tools/Resources/Prompts tabs (`listManifestItems` above stays untouched —
 * it's the reconciler's own narrower read, not worth widening for a caller with a
 * different need). */
export async function listManifestItemsFull(ctx: TenantContext, serverVersionId: string) {
  return withTenant(ctx, async (db: TenantScopedClient) =>
    db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, serverVersionId))),
  );
}

/** ADR-0014's "reconcileDueServers" selection: `Active` servers whose reconcile
 * interval has elapsed (or have never reconciled at all). */
export async function listServersDueForReconciliation(ctx: TenantContext): Promise<McpServerRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.mcpServer)
      .where(
        and(
          eq(schema.mcpServer.tenantId, ctx.tenantId),
          eq(schema.mcpServer.status, "Active"),
          sql`${schema.mcpServer.currentVersionId} IS NOT NULL`,
          isNull(schema.mcpServer.deletedAt),
          or(isNull(schema.mcpServer.lastReconciledAt), lt(schema.mcpServer.lastReconciledAt, sql`now() - (${schema.mcpServer.reconcileIntervalSeconds} || ' seconds')::interval`)),
        ),
      ),
  ) as Promise<McpServerRow[]>;
}

/** FR-MCP-18's boundary rule: unreachability is a health transition, never a drift
 * event. Writes `reachability`/`lastProbeError` and touches `lastReconciledAt` so the
 * sweep doesn't retry this server again before its own interval elapses. */
export async function recordUnreachable(ctx: TenantContext, serverId: string, error: { code: string; message: string }): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.mcpServer)
      .set({ reachability: "Unreachable", lastProbeError: { ...error, occurredAt: new Date().toISOString() }, lastReconciledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.mcpServer.tenantId, ctx.tenantId), eq(schema.mcpServer.id, serverId)));
  });
}

/** ADR-0014's idempotent "hash unchanged" path — updates only the reconciliation
 * bookkeeping columns, writes no drift row. */
export async function recordReconciledNoChange(ctx: TenantContext, serverId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.mcpServer)
      .set({ reachability: "Reachable", lastProbeError: null, lastReconciledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.mcpServer.tenantId, ctx.tenantId), eq(schema.mcpServer.id, serverId)));
  });
}

export interface DriftEventInsert {
  serverId: string;
  pinnedVersionId: string;
  changeKind: "ItemAdded" | "ItemRemoved" | "SchemaChanged";
  itemKind: "Tool" | "Resource" | "Prompt";
  itemName: string;
  oldSchemaHash: string | null;
  newSchemaHash: string | null;
  dedupeKey: string;
}

/** Inserts drift events with `ON CONFLICT (tenant_id, dedupe_key) WHERE resolution =
 * 'Pending' DO NOTHING` — ADR-0014's idempotency guarantee at the SQL level, not
 * merely application-level deduplication (so it holds even under concurrent
 * reconciler runs for the same server). Also updates the server's reconciliation
 * bookkeeping in the same call, mirroring `recordReconciledNoChange`. */
export async function insertDriftEventsAndMarkReconciled(ctx: TenantContext, serverId: string, events: DriftEventInsert[]): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    let inserted = 0;
    for (const event of events) {
      const result = await db.execute(sql`
        INSERT INTO mcp_drift_event (id, tenant_id, server_id, pinned_version_id, change_kind, item_kind, item_name, old_schema_hash, new_schema_hash, dedupe_key)
        VALUES (${generateId()}, ${ctx.tenantId}, ${event.serverId}, ${event.pinnedVersionId}, ${event.changeKind}, ${event.itemKind}, ${event.itemName}, ${event.oldSchemaHash}, ${event.newSchemaHash}, ${event.dedupeKey})
        ON CONFLICT (tenant_id, dedupe_key) WHERE resolution = 'Pending' DO NOTHING
      `);
      inserted += result.rowCount ?? 0;
    }
    // Target Architecture Blueprint Phase 18 (BL-49, FR-API-02/FR-MCP-18) — the
    // outbound-webhook subscriber's "drift detected" category. This module had NO
    // domain_event producer at all before this phase (confirmed by inspection). One
    // row per RECONCILE TICK, not one per classified change — a webhook subscriber
    // wants "this server drifted," not N deliveries for a single reconcile — and only
    // when at least one row was genuinely NEW (`inserted > 0`), never for a re-run
    // that only re-observed already-pending drift (ADR-0014's own idempotency
    // guarantee: "a re-run against the same live state inserts nothing new" must hold
    // for the webhook signal too, not just the `mcp_drift_event` table). Appended in
    // the same transaction as the drift rows above.
    if (inserted > 0) {
      const first = events[0];
      await db.insert(schema.domainEvent).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        type: "mcp-registry.drift_detected",
        payload: { serverId, pinnedVersionId: first?.pinnedVersionId ?? null, changeCount: inserted },
      });
    }
    await db
      .update(schema.mcpServer)
      .set({ reachability: "Reachable", lastProbeError: null, lastReconciledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.mcpServer.tenantId, ctx.tenantId), eq(schema.mcpServer.id, serverId)));
    return inserted;
  });
}

export interface PendingDriftEventRow {
  id: string;
  serverId: string;
  pinnedVersionId: string;
  changeKind: "ItemAdded" | "ItemRemoved" | "SchemaChanged";
  itemKind: "Tool" | "Resource" | "Prompt";
  itemName: string;
  oldSchemaHash: string | null;
  newSchemaHash: string | null;
  resolution: "Pending" | "Accepted" | "Rejected";
}

export async function listPendingDriftEvents(ctx: TenantContext, serverId: string): Promise<PendingDriftEventRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.mcpDriftEvent)
      .where(and(eq(schema.mcpDriftEvent.tenantId, ctx.tenantId), eq(schema.mcpDriftEvent.serverId, serverId), eq(schema.mcpDriftEvent.resolution, "Pending"))),
  ) as Promise<PendingDriftEventRow[]>;
}

/**
 * ADR-0014 §2.2/§2.3 — accepting drift mints a **new immutable server version** whose
 * manifest matches the live server for the accepted changes; rejecting mints nothing.
 * The old version and its items are never touched — a `SchemaChanged` accept creates a
 * brand-new `mcp_manifest_item` row (`supersedesItemId` pointing at the old one), the
 * old row is left exactly as it was, still callable by anything pinned to the old
 * version (LLD §14.3.5's future pin bridge is what would actually resolve "anything
 * pinned to it" once it exists — the item row's own immutability is what this phase
 * guarantees regardless).
 */
export async function reviewDrift(
  ctx: TenantContext,
  serverId: string,
  decisions: Array<{ driftEventId: string; action: "Accept" | "Reject"; approvalTier?: "Tier1" | "Tier2" | "Tier3"; enabled?: boolean; note?: string; schemaJsonForAccepted?: unknown; descriptionSourceForAccepted?: string }>,
  actorUserId: string,
): Promise<{ newServerVersionId: string | null; accepted: number; rejected: number }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [server] = await db.select().from(schema.mcpServer).where(and(eq(schema.mcpServer.tenantId, ctx.tenantId), eq(schema.mcpServer.id, serverId)));
    if (!server) throw new Error(`mcp_server '${serverId}' not found`);
    const baseVersionId = server.currentVersionId as string;

    const accepted = decisions.filter((d) => d.action === "Accept");
    const rejected = decisions.filter((d) => d.action === "Reject");

    let newServerVersionId: string | null = null;

    if (accepted.length > 0) {
      const baseItems = await db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, baseVersionId)));
      const events = await db
        .select()
        .from(schema.mcpDriftEvent)
        .where(and(eq(schema.mcpDriftEvent.tenantId, ctx.tenantId), inArray(schema.mcpDriftEvent.id, accepted.map((a) => a.driftEventId))));

      const maxVersionResult = await db.execute<{ version: number }>(
        sql`SELECT COALESCE(MAX(version), 0) AS version FROM mcp_server_version WHERE tenant_id = ${ctx.tenantId} AND server_id = ${serverId}`,
      );
      const nextVersion = Number(maxVersionResult.rows[0]?.version ?? 0) + 1;
      newServerVersionId = generateId();

      // Carry forward every existing item unchanged (ADR-0014 §2.2: an `ItemRemoved`
      // event's pinned item stays in the manifest — pinned agents keep their
      // contract, and calls against it will fail at the server, surfaced through the
      // existing circuit breaker rather than this reconciler).
      const carriedItems = baseItems.map((item) => ({
        id: generateId(),
        tenantId: ctx.tenantId,
        serverVersionId: newServerVersionId as string,
        kind: item.kind,
        name: item.name,
        descriptionSource: item.descriptionSource,
        schemaJson: item.schemaJson,
        schemaHash: item.schemaHash,
        approvalTier: item.approvalTier,
        enabled: item.enabled,
        capabilityGroupId: item.capabilityGroupId,
        supersedesItemId: null as string | null,
      }));

      const newItemRows: (typeof carriedItems)[number][] = [];
      for (const decision of accepted) {
        const event = events.find((e) => e.id === decision.driftEventId);
        if (!event) continue;
        if (event.changeKind === "ItemRemoved") continue; // nothing new to add — the removal is a reporting fact only.

        const schemaJson = decision.schemaJsonForAccepted ?? {};
        const supersededItem = event.changeKind === "SchemaChanged" ? baseItems.find((i) => i.kind === event.itemKind && i.name === event.itemName) : undefined;
        newItemRows.push({
          id: generateId(),
          tenantId: ctx.tenantId,
          serverVersionId: newServerVersionId,
          kind: event.itemKind,
          name: event.itemName,
          descriptionSource: decision.descriptionSourceForAccepted ?? "",
          schemaJson: schemaJson as object,
          schemaHash: event.newSchemaHash ?? computeSchemaHash(schemaJson),
          // ADR-0014 §2.2 fail-closed default: a new item (whether genuinely new or
          // the new shape of a schema change) is disabled + Tier3 unless the reviewer
          // explicitly overrides it here.
          approvalTier: decision.approvalTier ?? "Tier3",
          enabled: decision.enabled ?? false,
          capabilityGroupId: null,
          supersedesItemId: supersededItem?.id ?? null,
        });
      }

      // The carried-forward set excludes the OLD shape of anything that just got a
      // new item minted for it — the old row itself still exists (unchanged, in the
      // OLD version), it simply isn't part of the NEW version's manifest.
      const supersededNames = new Set(newItemRows.filter((r) => r.supersedesItemId).map((r) => `${r.kind}:${r.name}`));
      const finalItems = [...carriedItems.filter((i) => !supersededNames.has(`${i.kind}:${i.name}`)), ...newItemRows];

      const manifestHash = computeManifestHash(finalItems.map((i) => ({ kind: i.kind, name: i.name, schemaHash: i.schemaHash })));

      await db.insert(schema.mcpServerVersion).values({
        id: newServerVersionId,
        tenantId: ctx.tenantId,
        serverId,
        version: nextVersion,
        manifestHash,
        itemCount: finalItems.length,
        status: "Approved",
        supersedesVersionId: baseVersionId,
        approvedByUserId: actorUserId,
        approvedAt: new Date(),
        createdByUserId: actorUserId,
      });
      if (finalItems.length > 0) await db.insert(schema.mcpManifestItem).values(finalItems);

      await db.update(schema.mcpServerVersion).set({ status: "Superseded" }).where(and(eq(schema.mcpServerVersion.tenantId, ctx.tenantId), eq(schema.mcpServerVersion.id, baseVersionId)));
      await db.update(schema.mcpServer).set({ currentVersionId: newServerVersionId, updatedAt: new Date() }).where(eq(schema.mcpServer.id, serverId));

      await db
        .update(schema.mcpDriftEvent)
        .set({ resolution: "Accepted", resolvedByUserId: actorUserId, resolvedAt: new Date(), resultingVersionId: newServerVersionId })
        .where(and(eq(schema.mcpDriftEvent.tenantId, ctx.tenantId), inArray(schema.mcpDriftEvent.id, accepted.map((a) => a.driftEventId))));
    }

    for (const decision of rejected) {
      await db
        .update(schema.mcpDriftEvent)
        .set({ resolution: "Rejected", resolvedByUserId: actorUserId, resolvedAt: new Date(), resolutionNote: decision.note ?? null })
        .where(and(eq(schema.mcpDriftEvent.tenantId, ctx.tenantId), eq(schema.mcpDriftEvent.id, decision.driftEventId)));
    }

    return { newServerVersionId, accepted: accepted.length, rejected: rejected.length };
  });
}

export interface WizardManifestItemInput {
  kind: "Tool" | "Resource" | "Prompt";
  name: string;
  descriptionSource: string;
  schemaJson: unknown;
  schemaHash: string;
  ioClass: "Read" | "Write";
  ioClassSource: "AutoHeuristic" | "AdminOverride";
  approvalTier: "Tier1" | "Tier2" | "Tier3";
  approvalTierSource: "BackendTypeDefault" | "AdminOverride";
  enabled: boolean;
  capabilityGroupId: string | null;
  knowledgeIngestionCandidate: boolean;
  toolId: string | null;
}

export interface WizardBindingInput {
  environment: "Sandbox" | "Staging" | "Production";
  endpointUrl: string | null;
  stdioCommand: unknown;
  gatewayAgentId: string | null;
  credentialId: string | null;
  connectorId: string;
  reachability: "Unknown" | "Reachable" | "Unreachable";
}

/**
 * Phase 3 (BL-34) wizard step 9 (enrol) — creates the real `mcp_server` +
 * `mcp_server_version` (v1, `Approved`) + `mcp_manifest_item` rows + one
 * `mcp_environment_binding` per environment, in one `mcp-registry`-owned transaction.
 * The `connector` rows each binding references are created by the caller *before*
 * this function runs (`@nextbot/connectors`, a separate module transaction — same
 * non-atomic-across-module-boundaries precedent `discoverAndSyncTools` already
 * establishes for `connectors` -> `tool-registry`), and passed in via
 * `bindings[].connectorId`.
 *
 * @throws {McpServerNameDuplicateError} `(tenant, name)` collision — re-checked here,
 * not just at step 1, since a name could theoretically collide between step 1 and the
 * terminal enrol call (a second wizard finishing first).
 */
export async function createServerFromWizard(
  ctx: TenantContext,
  input: {
    name: string;
    description: string | null;
    backendType: "Ticketing" | "CRM" | "ERP" | "Billing" | "HRIS" | "KnowledgeBase" | "Custom";
    ownerUserId: string;
    criticality: "Low" | "Medium" | "High" | "BusinessCritical";
    transport: "StreamableHTTP" | "StdioViaGateway";
    authMethod: "OAuth2" | "APIKey" | "BearerToken" | "CustomHeader" | "mTLS" | "None";
    policyJson: unknown;
    items: WizardManifestItemInput[];
    bindings: WizardBindingInput[];
    createdByUserId: string;
  },
): Promise<{ serverId: string; serverVersionId: string; version: number; manifestHash: string; bindingIds: Array<{ environment: string; id: string; connectorId: string; reachability: string }> }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select({ id: schema.mcpServer.id })
      .from(schema.mcpServer)
      .where(and(eq(schema.mcpServer.tenantId, ctx.tenantId), eq(schema.mcpServer.name, input.name)));
    if (existing.length > 0) throw new McpServerNameDuplicateError(input.name);

    const serverId = generateId();
    const versionId = generateId();
    const manifestHash = computeManifestHash(input.items.map((i) => ({ kind: i.kind, name: i.name, schemaHash: i.schemaHash })));

    await db.insert(schema.mcpServer).values({
      id: serverId,
      tenantId: ctx.tenantId,
      name: input.name,
      description: input.description,
      // Single-endpoint columns kept in sync with the canonical (first) binding for
      // backward compatibility with Phase 0's reconciler, which still reads
      // `mcp_server.endpointUrl`/`transport` directly (see `reconciler.ts`).
      endpointUrl: input.bindings[0]?.endpointUrl ?? "",
      transport: input.transport,
      credentialId: input.bindings[0]?.credentialId ?? null,
      backendType: input.backendType,
      ownerUserId: input.ownerUserId,
      criticality: input.criticality,
      createdByUserId: input.createdByUserId,
    });

    await db.insert(schema.mcpServerVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      serverId,
      version: 1,
      transport: input.transport,
      authMethod: input.authMethod,
      policyJson: input.policyJson as object,
      manifestHash,
      itemCount: input.items.length,
      status: "Approved",
      approvedByUserId: input.createdByUserId,
      approvedAt: new Date(),
      createdByUserId: input.createdByUserId,
    });

    if (input.items.length > 0) {
      await db.insert(schema.mcpManifestItem).values(
        input.items.map((item) => ({
          id: generateId(),
          tenantId: ctx.tenantId,
          serverVersionId: versionId,
          kind: item.kind,
          name: item.name,
          descriptionSource: item.descriptionSource,
          schemaJson: item.schemaJson as object,
          schemaHash: item.schemaHash,
          ioClass: item.ioClass,
          ioClassSource: item.ioClassSource,
          approvalTier: item.approvalTier,
          approvalTierSource: item.approvalTierSource,
          enabled: item.enabled,
          capabilityGroupId: item.capabilityGroupId,
          knowledgeIngestionCandidate: item.knowledgeIngestionCandidate,
          toolId: item.toolId,
        })),
      );
    }

    const bindingIds: Array<{ environment: string; id: string; connectorId: string; reachability: string }> = [];
    for (const binding of input.bindings) {
      const bindingId = generateId();
      await db.insert(schema.mcpEnvironmentBinding).values({
        id: bindingId,
        tenantId: ctx.tenantId,
        serverVersionId: versionId,
        environment: binding.environment,
        endpointUrl: binding.endpointUrl,
        stdioCommand: binding.stdioCommand as object | null,
        gatewayAgentId: binding.gatewayAgentId,
        credentialId: binding.credentialId,
        connectorId: binding.connectorId,
        reachability: binding.reachability,
      });
      bindingIds.push({ environment: binding.environment, id: bindingId, connectorId: binding.connectorId, reachability: binding.reachability });
    }

    await db.update(schema.mcpServer).set({ currentVersionId: versionId }).where(eq(schema.mcpServer.id, serverId));

    return { serverId, serverVersionId: versionId, version: 1, manifestHash, bindingIds };
  });
}

/** Links a materialised `tool` row back to the manifest item it was enrolled from
 * (Tool-kind items only) — a small follow-up write after `createServerFromWizard`
 * since the `tool` row doesn't exist until `@nextbot/tool-registry`'s
 * `upsertToolFromDiscovery` runs (a separate module transaction). */
export async function linkManifestItemToTool(ctx: TenantContext, serverVersionId: string, kind: "Tool", name: string, toolId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.mcpManifestItem)
      .set({ toolId })
      .where(
        and(
          eq(schema.mcpManifestItem.tenantId, ctx.tenantId),
          eq(schema.mcpManifestItem.serverVersionId, serverVersionId),
          eq(schema.mcpManifestItem.kind, kind),
          eq(schema.mcpManifestItem.name, name),
        ),
      );
  });
}

/** Environment bindings for a given server version — the detail screen's
 * "Environments" tab and the wizard's dry-run step (which needs the Sandbox
 * binding's connector/credential). */
export async function listBindingsForVersion(ctx: TenantContext, serverVersionId: string) {
  return withTenant(ctx, async (db: TenantScopedClient) =>
    db.select().from(schema.mcpEnvironmentBinding).where(and(eq(schema.mcpEnvironmentBinding.tenantId, ctx.tenantId), eq(schema.mcpEnvironmentBinding.serverVersionId, serverVersionId))),
  );
}
