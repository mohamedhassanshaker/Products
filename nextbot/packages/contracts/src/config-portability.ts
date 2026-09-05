import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";

/**
 * Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — Configuration Export
 * and Restore. The bundle is a single versioned JSON document; validation here is
 * deliberately loose on each artifact's own authored content (`artifactYaml`,
 * `chainJson`/`policyJson`) — the REAL validation of that content happens when
 * `apps/web/src/lib/config-portability-service.ts#restoreConfigBundle` calls each
 * artifact kind's own existing `createXVersion`/`createX` function, which is the
 * SAME validator every ordinary authoring path already runs through (the whole point
 * of "restore re-enters the gate, never bypasses it"). This schema only needs to
 * gate the bundle's own structural shape (schema version, which tenant it belongs to,
 * what it claims to contain) so a malformed/foreign JSON blob is rejected before ANY
 * module-level create call ever runs.
 */
export const CONFIG_BUNDLE_SCHEMA_VERSION = 1;

/** One versioned-artifact entry (agent definition / skill / workflow / team) — the
 * identity's own name/description plus its CURRENT (latest-by-version) version's
 * exact, byte-faithful authored YAML. */
export const ConfigBundleYamlArtifactSchema = Type.Object({
  sourceId: Type.String(),
  name: Type.String({ minLength: 1 }),
  description: Type.Union([Type.String(), Type.Null()]),
  version: Type.Union([Type.String(), Type.Integer()]),
  artifactYaml: Type.String(),
});
export type ConfigBundleYamlArtifact = Static<typeof ConfigBundleYamlArtifactSchema>;

/** Agent definitions carry two extra fields no other kind does: the free-text
 * semver-shaped version label is caller-supplied (not auto-incremented) and a
 * version pins a `modelRouteKey`, both needed to re-create it faithfully. */
export const ConfigBundleAgentDefinitionArtifactSchema = Type.Composite([
  ConfigBundleYamlArtifactSchema,
  Type.Object({ modelRouteKey: Type.String(), graphType: Type.Optional(Type.String()) }),
]);
export type ConfigBundleAgentDefinitionArtifact = Static<typeof ConfigBundleAgentDefinitionArtifactSchema>;

/** `model_route` is the 5th versioned-artifact kind (per this phase's own
 * investigation) but is NOT YAML-based — its authored content is
 * `chainJson`/`policyJson`, and its promotion ladder is Draft/Published only. */
export const ConfigBundleModelRouteArtifactSchema = Type.Object({
  sourceId: Type.String(),
  name: Type.String({ minLength: 1 }),
  description: Type.Union([Type.String(), Type.Null()]),
  role: Type.String(),
  version: Type.Integer(),
  chainJson: Type.Unknown(),
  policyJson: Type.Unknown(),
});
export type ConfigBundleModelRouteArtifact = Static<typeof ConfigBundleModelRouteArtifactSchema>;

/** Connector definition fields ONLY — deliberately excludes `credentialId` and any
 * secret material. This is a hard security requirement (FR-ADM-08's own connector
 * boundary): a connector's vaulted credential must never appear anywhere in an
 * export bundle, proven by this phase's own adversarial test that inspects the
 * actual serialized bundle. */
export const ConfigBundleConnectorArtifactSchema = Type.Object({
  sourceId: Type.String(),
  name: Type.String({ minLength: 1 }),
  description: Type.Union([Type.String(), Type.Null()]),
  backendType: Type.String(),
  templateKey: Type.Union([Type.String(), Type.Null()]),
  transport: Type.String(),
  endpointUrl: Type.Union([Type.String(), Type.Null()]),
  stdioCommand: Type.Unknown(),
  authMethod: Type.String(),
  environment: Type.String(),
  trustLevel: Type.String(),
  healthIntervalSeconds: Type.Integer(),
  latencyThresholdMs: Type.Integer(),
  errorRateThresholdPct: Type.String(),
});
export type ConfigBundleConnectorArtifact = Static<typeof ConfigBundleConnectorArtifactSchema>;

/** Reference-only snapshot of tenant policy config (FR-ADM-08's "policy" bucket) —
 * included in every export for audit/review visibility, but deliberately NOT
 * auto-restored this phase (disclosed in
 * `docs/plans/cross-channel-identity-config-portability-plan.md`): `pii_policy`'s
 * existing write path is an upsert (a real in-place overwrite of live policy),
 * and `tenant_data_policy` is a PK-on-tenant singleton — neither is compatible with
 * "restore never overwrites in place" without a materially larger redesign. */
export const ConfigBundlePolicySnapshotSchema = Type.Object({
  guardrailRules: Type.Array(Type.Unknown()),
  piiRules: Type.Array(Type.Unknown()),
  piiPolicies: Type.Array(Type.Unknown()),
  dataPolicySnapshot: Type.Union([Type.Unknown(), Type.Null()]),
});
export type ConfigBundlePolicySnapshot = Static<typeof ConfigBundlePolicySnapshotSchema>;

/** One line of the bundle's own manifest — lets an admin review what's inside a
 * bundle before restoring it (never a silent black-box restore). */
export const ConfigBundleManifestEntrySchema = Type.Object({
  kind: Type.Union([
    Type.Literal("AgentDefinition"),
    Type.Literal("Skill"),
    Type.Literal("Workflow"),
    Type.Literal("Team"),
    Type.Literal("ModelRoute"),
    Type.Literal("Connector"),
    Type.Literal("Policy"),
  ]),
  id: Type.String(),
  name: Type.String(),
  version: Type.Union([Type.String(), Type.Integer(), Type.Null()]),
});
export type ConfigBundleManifestEntry = Static<typeof ConfigBundleManifestEntrySchema>;

export const ConfigBundleSchema = Type.Object({
  schemaVersion: Type.Literal(CONFIG_BUNDLE_SCHEMA_VERSION),
  exportedAt: Type.String(),
  tenantId: Type.String({ format: "uuid" }),
  tenantName: Type.String(),
  manifest: Type.Array(ConfigBundleManifestEntrySchema),
  artifacts: Type.Object({
    agentDefinitions: Type.Array(ConfigBundleAgentDefinitionArtifactSchema),
    skills: Type.Array(ConfigBundleYamlArtifactSchema),
    workflows: Type.Array(ConfigBundleYamlArtifactSchema),
    teams: Type.Array(ConfigBundleYamlArtifactSchema),
    modelRoutes: Type.Array(ConfigBundleModelRouteArtifactSchema),
    connectors: Type.Array(ConfigBundleConnectorArtifactSchema),
    policies: ConfigBundlePolicySnapshotSchema,
  }),
});
export type ConfigBundle = Static<typeof ConfigBundleSchema>;

/** `POST /api/v1/admin/config-portability/restore` request body. `mode: "preview"`
 * performs no writes at all (a pure read-only dry run); `mode: "confirm"` performs
 * the actual restore. Both share the identical bundle-validation/plan-computation
 * logic — `confirm` just also executes it. */
export const RestoreConfigBundleRequestSchema = Type.Object({
  bundle: ConfigBundleSchema,
  mode: Type.Union([Type.Literal("preview"), Type.Literal("confirm")]),
});
export type RestoreConfigBundleRequest = Static<typeof RestoreConfigBundleRequestSchema>;

/** One artifact's restore outcome — `action` is always one of these four; `reason`
 * is populated for `skipped`/`failed` so the admin sees WHY, never a silent no-op. */
export const ConfigBundleRestoreOutcomeSchema = Type.Object({
  kind: Type.String(),
  name: Type.String(),
  action: Type.Union([
    Type.Literal("createdNewIdentity"),
    Type.Literal("createdNewDraftVersion"),
    Type.Literal("skipped"),
    Type.Literal("failed"),
  ]),
  reason: Type.Optional(Type.String()),
  newIdentityId: Type.Optional(Type.String()),
  newVersionId: Type.Optional(Type.String()),
});
export type ConfigBundleRestoreOutcome = Static<typeof ConfigBundleRestoreOutcomeSchema>;

/**
 * A real, deliberate decision (not left ambiguous, per this phase's own dispatch
 * brief): restoring a bundle into a DIFFERENT tenant than the one it was exported
 * from is explicitly rejected, never attempted. Every restorable artifact kind
 * resolves tenant-scoped-by-name references (skill/knowledge pins, model-route hop
 * provider/catalog ids, team member definition pins) that are only meaningful within
 * the exporting tenant's own id space — restoring cross-tenant would either fail
 * those resolutions outright or, worse, silently resolve onto a different tenant's
 * unrelated same-named resource.
 */
export class RestoreCrossTenantNotSupportedError extends DomainError {
  readonly code = "RESTORE_CROSS_TENANT_NOT_SUPPORTED";
  readonly httpStatus = 422;
  constructor() {
    super("A configuration bundle can only be restored into the same tenant it was exported from.");
  }
}
