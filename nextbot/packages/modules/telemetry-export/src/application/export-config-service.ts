import type { TenantContext } from "@nextbot/db";
import { WebhookTargetUrlInvalidError } from "@nextbot/contracts";
import { isWellFormedHttpsUrl } from "../domain/url-validation.js";
import { getOtelExportConfig, upsertOtelExportConfig, type OtelExportConfigRow } from "../infrastructure/otel-export-config-repository.js";
import { getSiemExportConfig, upsertSiemExportConfig, type SiemExportConfigRow } from "../infrastructure/siem-export-config-repository.js";

/**
 * Config CRUD for both opt-in export mechanisms (FR-ADM-10). Reuses
 * `WebhookTargetUrlInvalidError` for the identical "not a well-formed https:// URL"
 * validation failure — the same shape of error for the same shape of input, rather
 * than inventing a parallel `OtelEndpointInvalidError`/`SiemEndpointInvalidError` pair
 * that would mean the exact same thing.
 */

export async function getOtelExportSettings(ctx: TenantContext): Promise<OtelExportConfigRow | null> {
  return getOtelExportConfig(ctx);
}

/** `orchestration`'s own span-emission call site's read: the tenant's configured OTLP
 * endpoint if (and only if) export is enabled, else `null` — a single per-call lookup
 * a caller can cache for the lifetime of one turn/agent-run rather than re-querying
 * per child span (see `@nextbot/orchestration`'s `agent-run-tracing.ts`). */
export async function getEffectiveOtelExportEndpoint(ctx: TenantContext): Promise<string | null> {
  const config = await getOtelExportConfig(ctx);
  return config?.enabled ? config.otlpEndpointUrl : null;
}

export async function updateOtelExportSettings(ctx: TenantContext, input: { otlpEndpointUrl: string; enabled: boolean }): Promise<OtelExportConfigRow> {
  if (!isWellFormedHttpsUrl(input.otlpEndpointUrl)) throw new WebhookTargetUrlInvalidError("otlpEndpointUrl");
  return upsertOtelExportConfig(ctx, input);
}

export async function getSiemExportSettings(ctx: TenantContext): Promise<SiemExportConfigRow | null> {
  return getSiemExportConfig(ctx);
}

export async function updateSiemExportSettings(ctx: TenantContext, input: { endpointUrl: string; enabled: boolean }): Promise<SiemExportConfigRow> {
  if (!isWellFormedHttpsUrl(input.endpointUrl)) throw new WebhookTargetUrlInvalidError("endpointUrl");
  return upsertSiemExportConfig(ctx, input);
}
