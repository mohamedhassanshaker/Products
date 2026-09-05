import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient, type StdioCommand } from "@nextbot/db";
import type {
  BackendTypeValue,
  ConnectorAuthMethodValue,
  ConnectorStatusValue,
  McpTransportValue,
} from "./types.js";
import type { EnvironmentValue } from "@nextbot/contracts";

export interface ConnectorRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  backendType: BackendTypeValue;
  templateKey: string | null;
  transport: McpTransportValue;
  endpointUrl: string | null;
  authMethod: ConnectorAuthMethodValue;
  credentialId: string | null;
  environment: EnvironmentValue;
  status: ConnectorStatusValue;
  circuitState: "Closed" | "Open" | "HalfOpen";
  lastDiscoveredAt: Date | null;
  healthIntervalSeconds: number;
  latencyThresholdMs: number;
  /** Drizzle's `numeric` column type maps to `string` at the driver level (to avoid
   * silent float-precision loss) — callers that need the numeric value (e.g.
   * `health-check.ts`'s status computation) convert with `Number(...)` themselves. */
  errorRateThresholdPct: string;
  /** Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — added to this
   * interface's declared shape (every `select()` call in this file already returned
   * these columns at runtime; they just weren't declared here yet, the same class of
   * gap `@nextbot/conversations`' `ConversationRow` had before this same phase). Config
   * export needs `stdioCommand`/`trustLevel` to faithfully recreate a
   * `StdioViaGateway`-transport connector and to preserve its trust-level
   * classification. */
  stdioCommand: StdioCommand | null;
  trustLevel: "Trusted" | "SemiTrusted" | "Untrusted";
}

export async function findConnectorByName(
  ctx: TenantContext,
  environment: EnvironmentValue,
  name: string,
): Promise<ConnectorRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.connector)
      .where(
        and(
          eq(schema.connector.tenantId, ctx.tenantId),
          eq(schema.connector.environment, environment),
          eq(schema.connector.name, name),
        ),
      );
    return rows[0] ?? (null as ConnectorRow | null);
  });
}

export async function findConnectorById(ctx: TenantContext, id: string): Promise<ConnectorRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.connector)
      .where(and(eq(schema.connector.tenantId, ctx.tenantId), eq(schema.connector.id, id)));
    return rows[0] ?? (null as ConnectorRow | null);
  });
}

export async function listConnectors(ctx: TenantContext): Promise<ConnectorRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    return db.select().from(schema.connector).where(eq(schema.connector.tenantId, ctx.tenantId));
  });
}

export async function insertConnector(
  ctx: TenantContext,
  input: {
    name: string;
    description?: string;
    backendType: BackendTypeValue;
    templateKey?: string;
    transport: McpTransportValue;
    endpointUrl?: string;
    authMethod: ConnectorAuthMethodValue;
    credentialId: string | null;
    environment: EnvironmentValue;
  },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.connector).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      description: input.description ?? null,
      backendType: input.backendType,
      templateKey: input.templateKey ?? null,
      transport: input.transport,
      endpointUrl: input.endpointUrl ?? null,
      authMethod: input.authMethod,
      credentialId: input.credentialId,
      environment: input.environment,
    });
  });
  return id;
}

export async function markDiscovered(ctx: TenantContext, connectorId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.connector)
      .set({ lastDiscoveredAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.connector.tenantId, ctx.tenantId), eq(schema.connector.id, connectorId)));
  });
}

/**
 * Updates a connector's computed `status` (LLD §3.5 / FR-MCP-01: "computed by the
 * health subsystem only; no API path sets it"). This is the *only* writer of this
 * column — called from the health-check probe (`health-check.ts`) after each probe
 * result, and once synchronously at connector-creation time so a brand-new
 * connector doesn't sit hard-denied in the default `Offline` state for up to a
 * full health-check interval before its first probe runs.
 */
export async function updateConnectorStatus(
  ctx: TenantContext,
  connectorId: string,
  status: ConnectorStatusValue,
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.connector)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.connector.tenantId, ctx.tenantId), eq(schema.connector.id, connectorId)));
  });
}
