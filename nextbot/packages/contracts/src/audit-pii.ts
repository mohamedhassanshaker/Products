import { Type, type Static } from "@sinclair/typebox";

/** Phase 17 (BL-10) — request contracts for the Audit Log Viewer, PII/guardrail
 * authoring, retention/residency settings, and DSR tool admin surfaces (B.8.2,
 * B.8.4, FR-SEC-04, FR-ADM-06). */

export const PiiEntityTypeSchema = Type.Union([
  Type.Literal("NationalId"),
  Type.Literal("CreditCard"),
  Type.Literal("IBAN"),
  Type.Literal("Phone"),
  Type.Literal("Email"),
  Type.Literal("Passport"),
  Type.Literal("DateOfBirth"),
  Type.Literal("Custom"),
]);

export const PiiContextSchema = Type.Union([
  Type.Literal("Transcript"),
  Type.Literal("ToolCallPayload"),
  Type.Literal("A2APayload"),
  Type.Literal("Export"),
  Type.Literal("HumanAgentView"),
]);

export const ConnectorTrustLevelSchema = Type.Union([
  Type.Literal("Trusted"),
  Type.Literal("SemiTrusted"),
  Type.Literal("Untrusted"),
]);

export const PiiMaskActionSchema = Type.Union([
  Type.Literal("Show"),
  Type.Literal("PartialMask"),
  Type.Literal("FullMask"),
  Type.Literal("Redact"),
]);

export const CreatePiiRuleRequestSchema = Type.Object({
  entityType: PiiEntityTypeSchema,
  label: Type.String({ minLength: 1, maxLength: 200 }),
  pattern: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  enabled: Type.Boolean(),
});
export type CreatePiiRuleRequest = Static<typeof CreatePiiRuleRequestSchema>;

export const SetPiiPolicyRequestSchema = Type.Object({
  entityType: PiiEntityTypeSchema,
  context: PiiContextSchema,
  trustLevel: ConnectorTrustLevelSchema,
  action: PiiMaskActionSchema,
});
export type SetPiiPolicyRequest = Static<typeof SetPiiPolicyRequestSchema>;

export const CreateGuardrailRuleRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  ordinal: Type.Integer({ minimum: 0 }),
  conditions: Type.Object({ toolName: Type.Optional(Type.String()) }),
  effect: Type.Union([Type.Literal("BlockToolCall"), Type.Literal("EscalateToHuman")]),
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
  enabled: Type.Boolean(),
});
export type CreateGuardrailRuleRequest = Static<typeof CreateGuardrailRuleRequestSchema>;

export const CreateDsrRequestSchema = Type.Object({
  requestType: Type.Union([Type.Literal("Search"), Type.Literal("Export"), Type.Literal("Delete")]),
  customerIdentifier: Type.String({ minLength: 1, maxLength: 500 }),
});
export type CreateDsrRequest = Static<typeof CreateDsrRequestSchema>;

export const UpdateTenantDataPolicyRequestSchema = Type.Object({
  retentionTranscriptsDays: Type.Optional(Type.Integer()),
  retentionTranscriptsIndefinite: Type.Optional(Type.Boolean()),
  retentionToolPayloadsDays: Type.Optional(Type.Integer()),
  retentionToolPayloadsIndefinite: Type.Optional(Type.Boolean()),
  retentionToolMetadataDays: Type.Optional(Type.Integer()),
  retentionToolMetadataIndefinite: Type.Optional(Type.Boolean()),
  retentionPiiDays: Type.Optional(Type.Integer()),
  retentionPiiIndefinite: Type.Optional(Type.Boolean()),
  residencyRegion: Type.Optional(Type.Union([Type.Literal("UAE"), Type.Literal("EU"), Type.Literal("US")])),
  allowOutOfRegionInference: Type.Optional(Type.Boolean()),
});
export type UpdateTenantDataPolicyRequest = Static<typeof UpdateTenantDataPolicyRequestSchema>;

export const CreateConnectorAlertRuleRequestSchema = Type.Object({
  connectorId: Type.String({ minLength: 1 }),
  metric: Type.Union([Type.Literal("LatencyMs"), Type.Literal("ErrorRatePct"), Type.Literal("OfflineMinutes")]),
  thresholdValue: Type.Number(),
  destinationKind: Type.Union([Type.Literal("Email"), Type.Literal("Slack"), Type.Literal("InApp")]),
  destinationEmail: Type.Optional(Type.String({ format: "email" })),
  destinationCredentialId: Type.Optional(Type.String({ minLength: 1 })),
  enabled: Type.Boolean(),
});
export type CreateConnectorAlertRuleRequest = Static<typeof CreateConnectorAlertRuleRequestSchema>;
