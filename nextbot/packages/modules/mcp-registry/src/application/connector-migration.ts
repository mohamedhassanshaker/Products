import { and, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { listActiveTenantContexts } from "@nextbot/tenancy";
import { computeManifestHash } from "../domain/manifest-hash.js";

/**
 * Phase 3 (BL-34, LLD §14.3.1) — the existing-connector migration. For every distinct
 * `connector.name` not yet wrapped by an `mcp_environment_binding`, synthesizes one
 * `mcp_server` + `mcp_server_version` (v1, `Approved`, manifest computed from the
 * connector's *already-discovered* `tool`/`tool_schema_version` rows — LLD §14.3.1's
 * exact instruction) + one `mcp_environment_binding` per connector row sharing that
 * name.
 *
 * **No `connector` row is ever deleted, renamed, or otherwise mutated** (this
 * function only ever INSERTs into `mcp_server`/`mcp_server_version`/
 * `mcp_manifest_item`/`mcp_environment_binding`), and **no `tool.connector_id` is ever
 * repointed** — a manifest item's `tool_id` links to the *existing* tool row as-is.
 *
 * Idempotent by construction: a connector already owned by some `mcp_environment_
 * binding` (from an earlier run of this function, or from a server enrolled directly
 * through the wizard) is skipped — re-running this backfill against an
 * already-migrated tenant inserts nothing.
 *
 * **Trigger point, disclosed**: `mcp_server.owner_user_id`/`created_by_user_id` are
 * NOT NULL — a real acting user, not a fabricated "system" identity (this codebase
 * has no such convention; every other write's `created_by`/`actor` column is the real
 * session user, per FR-ADM-03). Rather than invent one, this runs as an
 * admin-triggered action (`POST /api/v1/admin/mcp/servers/migrate-connectors`,
 * attributed to the calling admin), not an unattended `apps/worker` scheduled job —
 * unlike the reconciler/health-check sweeps, which write no such NOT NULL "who did
 * this" column and so have no analogous blocker.
 *
 * Deliberately implemented in TypeScript rather than a raw-SQL data migration: the
 * manifest hash's canonicalization (`computeManifestHash`/recursive key sorting) is
 * real application logic already implemented and tested in `domain/manifest-hash.ts`
 * — re-deriving it in SQL would risk a second, subtly different hashing
 * implementation, exactly what ADR-0014 §2.1 warns against ("canonicalization matters
 * and is part of the decision"). Reusing the same function the reconciler calls is
 * what guarantees a migrated server's manifest hash means the same thing the
 * reconciler will later compare it against.
 */
export interface ConnectorMigrationResult {
  serversCreated: number;
  bindingsCreated: number;
  connectorsSkippedAlreadyBound: number;
}

export async function migrateExistingConnectorsForTenant(ctx: TenantContext, actorUserId: string): Promise<ConnectorMigrationResult> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const connectors = await db
      .select()
      .from(schema.connector)
      .where(and(eq(schema.connector.tenantId, ctx.tenantId), isNull(schema.connector.deletedAt)));

    const boundConnectorIds = new Set(
      (
        await db
          .select({ connectorId: schema.mcpEnvironmentBinding.connectorId })
          .from(schema.mcpEnvironmentBinding)
          .where(eq(schema.mcpEnvironmentBinding.tenantId, ctx.tenantId))
      ).map((r) => r.connectorId),
    );

    const unbound = connectors.filter((c) => !boundConnectorIds.has(c.id));
    const byName = new Map<string, typeof unbound>();
    for (const connector of unbound) {
      const group = byName.get(connector.name) ?? [];
      group.push(connector);
      byName.set(connector.name, group);
    }

    let serversCreated = 0;
    let bindingsCreated = 0;

    for (const [name, group] of byName) {
      // A server of this name might already exist (created directly through the
      // wizard, or by an earlier partial run of this backfill) — skip rather than
      // collide with `mcp_server`'s `(tenant_id, name)` uniqueness.
      const existingServer = await db.select({ id: schema.mcpServer.id }).from(schema.mcpServer).where(and(eq(schema.mcpServer.tenantId, ctx.tenantId), eq(schema.mcpServer.name, name)));
      if (existingServer.length > 0) continue;

      // Prefer the Sandbox connector as canonical for the version's single
      // transport/auth-method columns (a real sandbox binding is the safest default
      // to probe going forward); fall back to whichever environment exists.
      // `group` is only ever created with a first push (see the loop above), so it's
      // never empty — the `continue` is unreachable in practice, just a defensive
      // guard TypeScript's control-flow analysis needs.
      const canonical = group.find((c) => c.environment === "Sandbox") ?? group[0];
      if (!canonical) continue;

      const canonicalTools = await db
        .select()
        .from(schema.tool)
        .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.connectorId, canonical.id)));

      const itemsWithHash: Array<{ toolId: string; name: string; descriptionSource: string; schemaJson: unknown; schemaHash: string; ioClass: "Read" | "Write"; approvalTier: "Tier1" | "Tier2" | "Tier3"; enabled: boolean; capabilityGroupId: string | null }> = [];
      for (const tool of canonicalTools) {
        if (!tool.currentSchemaVersionId) continue;
        const [version] = await db
          .select()
          .from(schema.toolSchemaVersion)
          .where(and(eq(schema.toolSchemaVersion.tenantId, ctx.tenantId), eq(schema.toolSchemaVersion.id, tool.currentSchemaVersionId)));
        if (!version) continue;
        itemsWithHash.push({
          toolId: tool.id,
          name: tool.name,
          descriptionSource: tool.descriptionSource,
          schemaJson: version.inputSchema,
          schemaHash: version.schemaHash,
          ioClass: tool.rwClass,
          approvalTier: tool.approvalTier,
          enabled: tool.status === "Active" && tool.visibleToAgent,
          capabilityGroupId: tool.capabilityGroupId,
        });
      }

      const manifestHash = computeManifestHash(itemsWithHash.map((i) => ({ kind: "Tool", name: i.name, schemaHash: i.schemaHash })));

      const serverId = generateId();
      const versionId = generateId();

      await db.insert(schema.mcpServer).values({
        id: serverId,
        tenantId: ctx.tenantId,
        name,
        description: canonical.description,
        endpointUrl: canonical.endpointUrl ?? "",
        transport: canonical.transport,
        credentialId: canonical.credentialId,
        backendType: canonical.backendType,
        ownerUserId: actorUserId,
        currentVersionId: null,
        createdByUserId: actorUserId,
      });

      await db.insert(schema.mcpServerVersion).values({
        id: versionId,
        tenantId: ctx.tenantId,
        serverId,
        version: 1,
        transport: canonical.transport,
        authMethod: canonical.authMethod,
        manifestHash,
        itemCount: itemsWithHash.length,
        status: "Approved",
        approvedByUserId: actorUserId,
        approvedAt: new Date(),
        createdByUserId: actorUserId,
      });

      if (itemsWithHash.length > 0) {
        await db.insert(schema.mcpManifestItem).values(
          itemsWithHash.map((item) => ({
            id: generateId(),
            tenantId: ctx.tenantId,
            serverVersionId: versionId,
            kind: "Tool" as const,
            name: item.name,
            descriptionSource: item.descriptionSource,
            schemaJson: item.schemaJson as object,
            schemaHash: item.schemaHash,
            ioClass: item.ioClass,
            ioClassSource: "AutoHeuristic" as const,
            approvalTier: item.approvalTier,
            approvalTierSource: "BackendTypeDefault" as const,
            enabled: item.enabled,
            capabilityGroupId: item.capabilityGroupId,
            // The tool row already exists (created by the pre-existing v1
            // discover-and-sync flow) — this migration links to it, never
            // re-creates or re-points it.
            toolId: item.toolId,
          })),
        );
      }

      for (const connector of group) {
        await db.insert(schema.mcpEnvironmentBinding).values({
          id: generateId(),
          tenantId: ctx.tenantId,
          serverVersionId: versionId,
          environment: connector.environment,
          endpointUrl: connector.endpointUrl,
          stdioCommand: connector.stdioCommand as object | null,
          gatewayAgentId: connector.gatewayAgentId,
          credentialId: connector.credentialId,
          connectorId: connector.id,
          reachability: connector.status === "Connected" ? "Reachable" : "Unknown",
        });
        bindingsCreated++;
      }

      await db.update(schema.mcpServer).set({ currentVersionId: versionId }).where(eq(schema.mcpServer.id, serverId));
      serversCreated++;
    }

    return { serversCreated, bindingsCreated, connectorsSkippedAlreadyBound: connectors.length - unbound.length };
  });
}

/** `apps/worker`'s scheduled-job entry point (mirrors `reconcileDueServersAcrossAllTenants`'s
 * per-tenant-transaction convention exactly). */
export async function migrateExistingConnectorsAcrossAllTenants(actorUserId: string): Promise<{ tenantsChecked: number; results: ConnectorMigrationResult[] }> {
  const tenants = await listActiveTenantContexts();
  const results: ConnectorMigrationResult[] = [];
  for (const tenantCtx of tenants) {
    results.push(await migrateExistingConnectorsForTenant(tenantCtx, actorUserId));
  }
  return { tenantsChecked: tenants.length, results };
}
