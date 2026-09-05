import type { TenantContext } from "@nextbot/db";
import type { UpsertOtelExportConfigRequest, UpsertSiemExportConfigRequest } from "@nextbot/contracts";
import { getOtelExportSettings, updateOtelExportSettings, getSiemExportSettings, updateSiemExportSettings } from "../application/export-config-service.js";

export async function handleGetOtelExportConfig(ctx: TenantContext) {
  return getOtelExportSettings(ctx);
}

export async function handleUpdateOtelExportConfig(ctx: TenantContext, input: UpsertOtelExportConfigRequest) {
  return updateOtelExportSettings(ctx, input);
}

export async function handleGetSiemExportConfig(ctx: TenantContext) {
  return getSiemExportSettings(ctx);
}

export async function handleUpdateSiemExportConfig(ctx: TenantContext, input: UpsertSiemExportConfigRequest) {
  return updateSiemExportSettings(ctx, input);
}
