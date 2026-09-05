import { Type, type Static } from "@sinclair/typebox";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — tenant-scoped,
 * opt-in OpenTelemetry trace/metric export and audit-log SIEM streaming.
 */

export const UpsertOtelExportConfigRequestSchema = Type.Object(
  {
    otlpEndpointUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type UpsertOtelExportConfigRequest = Static<typeof UpsertOtelExportConfigRequestSchema>;

export const UpsertSiemExportConfigRequestSchema = Type.Object(
  {
    endpointUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type UpsertSiemExportConfigRequest = Static<typeof UpsertSiemExportConfigRequestSchema>;
