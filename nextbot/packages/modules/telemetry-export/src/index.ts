// PUBLIC API for "@nextbot/telemetry-export" (Target Architecture Blueprint Phase 18,
// BL-49, FR-ADM-10). Everything else in this module is private.

export { handleGetOtelExportConfig, handleUpdateOtelExportConfig, handleGetSiemExportConfig, handleUpdateSiemExportConfig } from "./http/admin-routes.js";
export { exportSiemBatchForTenant, exportSiemBatchAcrossAllTenants } from "./application/siem-export-service.js";
export { getEffectiveOtelExportEndpoint } from "./application/export-config-service.js";
export { exportOtelMetricsForTenant, exportOtelMetricsAcrossAllTenants } from "./application/otel-metrics-export-service.js";
export type { OtelExportConfigRow } from "./infrastructure/otel-export-config-repository.js";
export type { SiemExportConfigRow } from "./infrastructure/siem-export-config-repository.js";
