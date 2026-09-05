import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { getCredentialForDecrypt } from "../infrastructure/credential-repository.js";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import type { ConnectorHealthSummary } from "./health-check.js";

/**
 * Phase 18 (BL-11, FR-MCP-08) — B.3A.4's alert configuration (thresholds +
 * destinations: email/Slack/in-app). A Slack destination is a vaulted credential
 * reference (`destination_credential_id`), never a plaintext webhook URL column —
 * the security review for this phase treats it exactly like any other connector
 * credential.
 */
export type AlertMetric = "LatencyMs" | "ErrorRatePct" | "OfflineMinutes";
export type AlertDestinationKind = "Email" | "Slack" | "InApp";

export interface ConnectorAlertRuleRow {
  id: string;
  connectorId: string;
  metric: AlertMetric;
  thresholdValue: number;
  destinationKind: AlertDestinationKind;
  destinationEmail: string | null;
  destinationCredentialId: string | null;
  enabled: boolean;
}

export interface CreateAlertRuleInput {
  connectorId: string;
  metric: AlertMetric;
  thresholdValue: number;
  destinationKind: AlertDestinationKind;
  destinationEmail?: string;
  destinationCredentialId?: string;
  enabled: boolean;
}

export async function listAlertRulesForConnector(ctx: TenantContext, connectorId: string): Promise<ConnectorAlertRuleRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.connectorAlertRule)
      .where(and(eq(schema.connectorAlertRule.tenantId, ctx.tenantId), eq(schema.connectorAlertRule.connectorId, connectorId)));
    return rows.map(toRow);
  });
}

export async function createAlertRule(ctx: TenantContext, input: CreateAlertRuleInput): Promise<ConnectorAlertRuleRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.connectorAlertRule).values({
      id,
      tenantId: ctx.tenantId,
      connectorId: input.connectorId,
      metric: input.metric,
      thresholdValue: String(input.thresholdValue),
      destinationKind: input.destinationKind,
      destinationEmail: input.destinationEmail ?? null,
      destinationCredentialId: input.destinationCredentialId ?? null,
      enabled: input.enabled,
    });
    return {
      id,
      connectorId: input.connectorId,
      metric: input.metric,
      thresholdValue: input.thresholdValue,
      destinationKind: input.destinationKind,
      destinationEmail: input.destinationEmail ?? null,
      destinationCredentialId: input.destinationCredentialId ?? null,
      enabled: input.enabled,
    };
  });
}

function toRow(row: typeof schema.connectorAlertRule.$inferSelect): ConnectorAlertRuleRow {
  return {
    id: row.id,
    connectorId: row.connectorId,
    metric: row.metric,
    thresholdValue: Number(row.thresholdValue),
    destinationKind: row.destinationKind,
    destinationEmail: row.destinationEmail,
    destinationCredentialId: row.destinationCredentialId,
    enabled: row.enabled,
  };
}

/** Sends one alert to its configured destination. `Email`/`Slack` delivery has no
 * real transactional-email/Slack SDK integration anywhere in this codebase yet
 * (same "no provider adopted, stub behind the real interface" precedent Phase 2's
 * MFA SMS/email channels set) — `InApp` is the one destination genuinely
 * persisted/visible today (the operator console reads `lastTriggeredAt` off the
 * rule itself). Email/Slack calls are logged server-side with the resolved
 * destination, standing in for the real send until a provider is selected — this
 * is flagged explicitly, not silently presented as fully wired. */
async function dispatchAlert(ctx: TenantContext, rule: ConnectorAlertRuleRow, message: string): Promise<void> {
  switch (rule.destinationKind) {
    case "InApp":
      // The rule row itself (`lastTriggeredAt`) is the in-app signal; the MCP
      // Health admin surface reads it directly — no separate notification store.
      return;
    case "Email":
      console.log(`NextBot connector alert (email to ${rule.destinationEmail}): ${message}`);
      return;
    case "Slack": {
      if (!rule.destinationCredentialId) return;
      // Resolves the vaulted webhook URL exactly like any other connector
      // credential — never read as plaintext config.
      const encrypted = await getCredentialForDecrypt(ctx, rule.destinationCredentialId);
      if (!encrypted) return;
      const provider = new KmsEnvelopeSecretsProvider();
      await provider.get(encrypted.ciphertext, encrypted.dekRef, {
        tenantId: ctx.tenantId,
        kind: "connector-credential",
        id: rule.destinationCredentialId,
      });
      console.log(`NextBot connector alert (slack): ${message}`);
      return;
    }
  }
}

/** Evaluates every enabled alert rule for a connector against its current health
 * summary and dispatches any that cross their threshold, marking
 * `last_triggered_at`. Returns how many rules fired, for the caller's own logging. */
export async function evaluateAlertsForConnector(
  ctx: TenantContext,
  connectorId: string,
  summary: ConnectorHealthSummary,
  offlineMinutes: number,
): Promise<{ triggered: number }> {
  const rules = await listAlertRulesForConnector(ctx, connectorId);
  let triggered = 0;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value =
      rule.metric === "LatencyMs" ? (summary.p95LatencyMs ?? 0) : rule.metric === "ErrorRatePct" ? summary.errorRatePct : offlineMinutes;
    if (value < rule.thresholdValue) continue;

    await dispatchAlert(ctx, rule, `Connector ${connectorId} exceeded ${rule.metric} threshold: ${value} >= ${rule.thresholdValue}`);
    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db
        .update(schema.connectorAlertRule)
        .set({ lastTriggeredAt: new Date() })
        .where(and(eq(schema.connectorAlertRule.tenantId, ctx.tenantId), eq(schema.connectorAlertRule.id, rule.id)));
    });
    triggered += 1;
  }
  return { triggered };
}
