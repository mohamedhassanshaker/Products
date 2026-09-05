import { and, desc, eq, gte } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { listTools } from "@nextbot/mcp-client";
import { findConnectorById, listConnectors, updateConnectorStatus } from "../infrastructure/connector-repository.js";
import type { ConnectorStatusValue } from "../infrastructure/types.js";
import { getCredentialForDecrypt } from "../infrastructure/credential-repository.js";
import { listActiveTenantContexts } from "@nextbot/tenancy";

/**
 * Phase 18 (BL-11, FR-MCP-08) — the MCP health-checker probe: `apps/worker`'s
 * scheduled job calls `probeConnectorHealth` for every connector, recording one
 * `connector_health_check` row per probe. Reuses the exact same `listTools` call
 * `discoverTools` (Phase 4) already makes — a probe is deliberately "can we still
 * list this server's tools within a reasonable time," not a bespoke ping protocol
 * MCP doesn't define.
 */
let provider: KmsEnvelopeSecretsProvider | undefined;
function getProvider(): KmsEnvelopeSecretsProvider {
  if (!provider) provider = new KmsEnvelopeSecretsProvider();
  return provider;
}

export interface HealthProbeResult {
  ok: boolean;
  latencyMs: number | null;
  errorMessage: string | null;
}

/** Probes one connector and records the result. Never throws — a probe failure is
 * itself the signal being recorded, not an exceptional condition for the caller. */
export async function probeConnectorHealth(ctx: TenantContext, connectorId: string): Promise<HealthProbeResult> {
  const connector = await findConnectorById(ctx, connectorId);
  if (!connector) return { ok: false, latencyMs: null, errorMessage: "connector not found" };

  const headers: Record<string, string> = {};
  if (connector.credentialId) {
    const encrypted = await getCredentialForDecrypt(ctx, connector.credentialId);
    if (encrypted) {
      const plaintext = await getProvider().get(encrypted.ciphertext, encrypted.dekRef, {
        tenantId: ctx.tenantId,
        kind: "connector-credential",
        id: connector.credentialId,
      });
      headers.authorization = `Bearer ${plaintext}`;
    }
  }

  const startedAt = Date.now();
  let result: HealthProbeResult;
  try {
    await listTools({ endpointUrl: connector.endpointUrl ?? "", headers });
    result = { ok: true, latencyMs: Date.now() - startedAt, errorMessage: null };
  } catch (err) {
    result = { ok: false, latencyMs: Date.now() - startedAt, errorMessage: err instanceof Error ? err.message : String(err) };
  }

  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.connectorHealthCheck).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      connectorId,
      ok: result.ok,
      latencyMs: result.latencyMs,
      errorMessage: result.errorMessage,
    });
  });

  // FR-MCP-01/FR-MCP-08 (B.3.1): the health subsystem is the *only* writer of
  // `connector.status` — a failing probe (including credential/auth failure,
  // surfaced here as a thrown `listTools` call) means `Offline`; a succeeding
  // probe that is nonetheless above this connector's own configured
  // latency/error-rate thresholds means `Degraded` (amber); otherwise `Connected`.
  // Without this, every connector stays at its DB-default `Offline` forever and
  // `permission-resolver.ts` hard-denies every tool call against it.
  const status = await computeConnectorStatus(ctx, connector, result);
  await updateConnectorStatus(ctx, connectorId, status);

  return result;
}

/** Derives the `Connected`/`Degraded`/`Offline` status this probe result implies,
 * folding in the connector's own configured latency/error-rate thresholds and its
 * recent error rate (not just this single probe) so one transient blip doesn't
 * flap a connector between Connected and Offline. */
async function computeConnectorStatus(
  ctx: TenantContext,
  connector: { id: string; latencyThresholdMs: number; errorRateThresholdPct: string },
  result: HealthProbeResult,
): Promise<ConnectorStatusValue> {
  if (!result.ok) return "Offline";

  const latencyThresholdMs = Number(connector.latencyThresholdMs);
  const errorRateThresholdPct = Number(connector.errorRateThresholdPct);

  if (result.latencyMs !== null && Number.isFinite(latencyThresholdMs) && result.latencyMs > latencyThresholdMs) {
    return "Degraded";
  }

  // Recent error rate over a short window (1 hour) — this connector may have
  // just succeeded, but if it's been flapping recently that's still "Degraded",
  // not a clean "Connected".
  const summary = await getConnectorHealthSummary(ctx, connector.id, 1);
  if (Number.isFinite(errorRateThresholdPct) && summary.errorRatePct > errorRateThresholdPct) {
    return "Degraded";
  }

  return "Connected";
}

/** Probes every connector for one tenant (skips connectors with no transport
 * endpoint — e.g. stdio-via-gateway connectors not yet reachable from this probe). */
export async function probeAllConnectorsForTenant(ctx: TenantContext): Promise<{ probed: number }> {
  const connectors = await listConnectors(ctx);
  let probed = 0;
  for (const connector of connectors) {
    if (connector.transport !== "StreamableHTTP") continue;
    await probeConnectorHealth(ctx, connector.id);
    probed += 1;
  }
  return { probed };
}

/** Probes every connector across every active tenant — what `apps/worker`'s
 * scheduled health-check job calls, mirroring the idle-sweeper/audit-sync
 * across-all-tenants convention. */
export async function probeAllConnectorsAcrossAllTenants(): Promise<{ tenantsChecked: number; probed: number }> {
  const tenants = await listActiveTenantContexts();
  let probed = 0;
  for (const ctx of tenants) {
    const result = await probeAllConnectorsForTenant(ctx);
    probed += result.probed;
  }
  return { tenantsChecked: tenants.length, probed };
}

export interface ConnectorHealthSummary {
  connectorId: string;
  callVolume: number;
  errorRatePct: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  sparkline: Array<{ checkedAt: Date; ok: boolean; latencyMs: number | null }>;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? null;
}

/** B.3A.4's tool-level (here: connector-level — the probe is per-connector, not
 * per-tool, since MCP has no per-tool ping) health table row: p50/p95/p99 latency +
 * error-rate + call-volume sparkline over the last `windowHours`. */
export async function getConnectorHealthSummary(
  ctx: TenantContext,
  connectorId: string,
  windowHours = 24,
): Promise<ConnectorHealthSummary> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const rows = await withTenant(ctx, async (db: TenantScopedClient) => {
    return db
      .select()
      .from(schema.connectorHealthCheck)
      .where(
        and(
          eq(schema.connectorHealthCheck.tenantId, ctx.tenantId),
          eq(schema.connectorHealthCheck.connectorId, connectorId),
          gte(schema.connectorHealthCheck.checkedAt, since),
        ),
      )
      .orderBy(desc(schema.connectorHealthCheck.checkedAt))
      .limit(200);
  });

  const latencies = rows.map((r) => r.latencyMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const errorCount = rows.filter((r) => !r.ok).length;

  return {
    connectorId,
    callVolume: rows.length,
    errorRatePct: rows.length === 0 ? 0 : Math.round((errorCount / rows.length) * 10000) / 100,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    sparkline: rows.slice(0, 50).reverse().map((r) => ({ checkedAt: r.checkedAt, ok: r.ok, latencyMs: r.latencyMs })),
  };
}
