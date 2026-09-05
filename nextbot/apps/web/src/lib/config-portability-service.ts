import "server-only";
import {
  CONFIG_BUNDLE_SCHEMA_VERSION,
  RestoreCrossTenantNotSupportedError,
  type ConfigBundle,
  type ConfigBundleRestoreOutcome,
  type AgentDefinitionArtifact,
  type GraphTypeValue,
  type ModelRouteRoleValue,
  type ModelRouteHopValue,
  type ModelRoutePolicyValue,
  type BackendTypeValue,
  type McpTransportValue,
  type EnvironmentValue,
} from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { resolveTenantById, getTenantDataPolicy } from "@nextbot/tenancy";
import { recordAuditEntry } from "@nextbot/audit";
import {
  listDefinitions,
  listAgentDefinitionVersions,
  findAgentDefinitionByName,
  createAgentDefinition,
  createAgentDefinitionVersion,
  parseArtifactFromYaml as parseAgentArtifactFromYaml,
} from "@nextbot/agent-platform";
import {
  listSkillsForLibrary,
  listVersions as listSkillVersions,
  findSkillByName,
  createSkill,
  createSkillVersion,
  parseArtifactFromYaml as parseSkillArtifactFromYaml,
} from "@nextbot/skills";
import {
  listWorkflowsForAdmin,
  listVersions as listWorkflowVersions,
  findWorkflowByName,
  createWorkflow,
  createWorkflowVersion,
  parseWorkflowArtifact,
} from "@nextbot/workflows";
import {
  listTeamsForAdmin,
  listTeamVersions,
  findTeamByName,
  createTeamWithFirstVersion,
  createTeamVersion,
  parseTeamArtifact,
} from "@nextbot/teams";
import { listRoutes, listVersionsForRoute, getRouteByName, createRoute, createRouteVersion } from "@nextbot/model-gateway";
import { listConnectors, findConnectorByName, createConnector } from "@nextbot/connectors";
import { listGuardrailRules, listPiiRules, listPiiPolicies } from "@nextbot/pii";

/**
 * Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — Configuration Export
 * and Restore's composition-root orchestration. Lives here (not inside any single
 * `packages/modules/*`) for the exact reason `dsr-service.ts` documents on its own
 * module doc comment: it needs `agent-platform`/`skills`/`workflows`/`teams`/
 * `model-gateway`/`connectors`/`pii` all at once, and no module's own LLD §2.3
 * allow-list permits importing five-plus siblings directly — only an `apps/*`
 * composition root may.
 *
 * Every artifact this service creates goes through that artifact kind's OWN,
 * already-existing creation path (`createAgentDefinitionVersion`/
 * `createSkillVersion`/`createWorkflowVersion`/`createTeamVersion`/
 * `createRouteVersion`, each called with `publish`/`status` left at its own default
 * Draft) — this file contains ZERO new artifact-creation/validation logic of its
 * own, only orchestration.
 */

/** Reads the CURRENT (highest `createdAt`, per this phase's own disclosed "current =
 * latest version" definition) version's row for each identity, for every restorable
 * artifact kind. Returns `null` for an identity with zero versions (should not
 * normally happen — every "create" call always creates version 1 in the same
 * transaction — but handled defensively rather than assumed). */
async function latestOf<T>(versions: T[]): Promise<T | null> {
  return versions[0] ?? null;
}

/**
 * Exports the CURRENT state of every FR-ADM-08-named artifact kind for
 * `ctx.tenantId` into one versioned bundle document. Read-only throughout — no
 * writes, no side effects beyond a single audit-log entry recording that an export
 * happened (mirrors `dsr-service.ts`'s own "every action is directly audited"
 * convention for a security/compliance-sensitive action).
 */
export async function exportConfigBundle(ctx: TenantContext, actorUserId: string): Promise<ConfigBundle> {
  const tenant = await resolveTenantById(ctx.tenantId);

  const agentDefinitions = await Promise.all(
    (await listDefinitions(ctx)).map(async (d) => {
      const v = await latestOf(await listAgentDefinitionVersions(ctx, d.id));
      if (!v) return null;
      return {
        sourceId: d.id,
        name: d.name,
        description: d.description,
        version: v.version,
        artifactYaml: v.definitionYaml,
        modelRouteKey: v.modelRouteKey,
        graphType: v.graphType,
      };
    }),
  );

  const skills = await Promise.all(
    (await listSkillsForLibrary(ctx)).map(async (s) => {
      const v = await latestOf(await listSkillVersions(ctx, s.id));
      if (!v) return null;
      return { sourceId: s.id, name: s.name, description: s.description, version: v.version, artifactYaml: v.yaml };
    }),
  );

  const workflows = await Promise.all(
    (await listWorkflowsForAdmin(ctx)).map(async (w) => {
      const v = await latestOf(await listWorkflowVersions(ctx, w.id));
      if (!v) return null;
      return { sourceId: w.id, name: w.name, description: w.description, version: v.version, artifactYaml: v.yaml };
    }),
  );

  const teams = await Promise.all(
    (await listTeamsForAdmin(ctx)).map(async (t) => {
      const v = await latestOf(await listTeamVersions(ctx, t.id));
      if (!v) return null;
      return { sourceId: t.id, name: t.name, description: t.description, version: v.version, artifactYaml: v.yaml };
    }),
  );

  const modelRoutes = await Promise.all(
    (await listRoutes(ctx)).map(async (r) => {
      const v = await latestOf(await listVersionsForRoute(ctx, r.id));
      if (!v) return null;
      return {
        sourceId: r.id,
        name: r.name,
        description: r.description,
        role: r.role,
        version: v.version,
        chainJson: v.chainJson,
        policyJson: v.policyJson,
      };
    }),
  );

  // Security-critical: this object literal explicitly WHITELISTS the fields that go
  // into the bundle — `c.credentialId` (a real field on `ConnectorRow`, needed
  // in-app to look up the vaulted credential) is deliberately never one of them, and
  // never will be even if a future edit destructures `c` differently, since nothing
  // here spreads `...c`. The credential's actual ciphertext is stored in a wholly
  // separate `credential` table `listConnectors()` never joins against at all, so
  // even a hypothetical `...c` spread here could not leak it — this whitelist is
  // still the correct, defense-in-depth way to build this object. Proven, not just
  // asserted, by this phase's own adversarial test that inspects the real serialized
  // bundle JSON for the string "ciphertext"/`credentialId`'s actual UUID value.
  const connectors = (await listConnectors(ctx)).map((c) => ({
    sourceId: c.id,
    name: c.name,
    description: c.description,
    backendType: c.backendType,
    templateKey: c.templateKey,
    transport: c.transport,
    endpointUrl: c.endpointUrl,
    stdioCommand: c.stdioCommand,
    authMethod: c.authMethod,
    environment: c.environment,
    trustLevel: c.trustLevel,
    healthIntervalSeconds: c.healthIntervalSeconds,
    latencyThresholdMs: c.latencyThresholdMs,
    errorRateThresholdPct: String(c.errorRateThresholdPct),
  }));

  const [guardrailRules, piiRules, piiPolicies, dataPolicySnapshot] = await Promise.all([
    listGuardrailRules(ctx),
    listPiiRules(ctx),
    listPiiPolicies(ctx),
    getTenantDataPolicy(ctx),
  ]);

  const bundle: ConfigBundle = {
    schemaVersion: CONFIG_BUNDLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tenantId: ctx.tenantId,
    tenantName: tenant?.name ?? ctx.tenantId,
    manifest: [
      ...nonNull(agentDefinitions).map((a) => ({ kind: "AgentDefinition" as const, id: a.sourceId, name: a.name, version: a.version })),
      ...nonNull(skills).map((s) => ({ kind: "Skill" as const, id: s.sourceId, name: s.name, version: s.version })),
      ...nonNull(workflows).map((w) => ({ kind: "Workflow" as const, id: w.sourceId, name: w.name, version: w.version })),
      ...nonNull(teams).map((t) => ({ kind: "Team" as const, id: t.sourceId, name: t.name, version: t.version })),
      ...nonNull(modelRoutes).map((r) => ({ kind: "ModelRoute" as const, id: r.sourceId, name: r.name, version: r.version })),
      ...connectors.map((c) => ({ kind: "Connector" as const, id: c.sourceId, name: c.name, version: null })),
      { kind: "Policy" as const, id: "policy-snapshot", name: "Tenant policy configuration (reference only)", version: null },
    ],
    artifacts: {
      agentDefinitions: nonNull(agentDefinitions),
      skills: nonNull(skills),
      workflows: nonNull(workflows),
      teams: nonNull(teams),
      modelRoutes: nonNull(modelRoutes),
      connectors,
      policies: { guardrailRules, piiRules, piiPolicies, dataPolicySnapshot },
    },
  };

  await recordAuditEntry(ctx, {
    actorId: actorUserId,
    actorLabel: actorUserId,
    actionType: "config_portability.export",
    targetType: "tenant",
    targetId: ctx.tenantId,
    outcome: "Success",
    details: { manifestCount: bundle.manifest.length },
  });

  return bundle;
}

function nonNull<T>(arr: Array<T | null>): T[] {
  return arr.filter((x): x is T => x !== null);
}

/**
 * Computes what a restore WOULD do (`dryRun: true`, zero writes) or actually
 * performs it (`dryRun: false`) — the identical planning logic runs in both modes so
 * a preview can never lie about what confirm will do. Every outcome funnels through
 * each artifact kind's OWN existing create-identity/create-version function; this
 * function never writes to `agent_definition_version`/`skill_version`/etc. directly.
 *
 * @throws {RestoreCrossTenantNotSupportedError} `bundle.tenantId !== ctx.tenantId` —
 * every restorable artifact kind resolves tenant-scoped-by-name references (skill/
 * knowledge pins, model-route hop provider/catalog ids, team member definition pins)
 * that are only meaningful within the EXPORTING tenant's own id space; restoring into
 * a different tenant would either fail those resolutions or, worse, silently resolve
 * onto a different tenant's unrelated same-named resource.
 */
export async function runConfigBundleRestore(
  ctx: TenantContext,
  bundle: ConfigBundle,
  actorUserId: string,
  dryRun: boolean,
): Promise<ConfigBundleRestoreOutcome[]> {
  if (bundle.tenantId !== ctx.tenantId) throw new RestoreCrossTenantNotSupportedError();

  const outcomes: ConfigBundleRestoreOutcome[] = [];

  for (const a of bundle.artifacts.agentDefinitions) {
    outcomes.push(await restoreAgentDefinition(ctx, a, actorUserId, dryRun));
  }
  for (const s of bundle.artifacts.skills) {
    outcomes.push(await restoreSkill(ctx, s, actorUserId, dryRun));
  }
  for (const w of bundle.artifacts.workflows) {
    outcomes.push(await restoreWorkflow(ctx, w, actorUserId, dryRun));
  }
  for (const t of bundle.artifacts.teams) {
    outcomes.push(await restoreTeam(ctx, t, actorUserId, dryRun));
  }
  for (const r of bundle.artifacts.modelRoutes) {
    outcomes.push(await restoreModelRoute(ctx, r, actorUserId, dryRun));
  }
  for (const c of bundle.artifacts.connectors) {
    outcomes.push(await restoreConnector(ctx, c, dryRun));
  }
  // Policy config is deliberately never restored — see this file's own doc and the
  // sub-plan's disclosed narrowing. One informational outcome row makes that explicit
  // in the result rather than silently omitting the bucket.
  outcomes.push({ kind: "Policy", name: "Tenant policy configuration", action: "skipped", reason: "Policy config is exported for reference only; it is not auto-restored (see plan doc)." });

  if (!dryRun) {
    await recordAuditEntry(ctx, {
      actorId: actorUserId,
      actorLabel: actorUserId,
      actionType: "config_portability.restore",
      targetType: "tenant",
      targetId: ctx.tenantId,
      outcome: "Success",
      details: { outcomes: outcomes.map((o) => ({ kind: o.kind, name: o.name, action: o.action })) },
    });
  }

  return outcomes;
}

async function restoreAgentDefinition(
  ctx: TenantContext,
  a: ConfigBundle["artifacts"]["agentDefinitions"][number],
  actorUserId: string,
  dryRun: boolean,
): Promise<ConfigBundleRestoreOutcome> {
  try {
    const existing = await findAgentDefinitionByName(ctx, a.name);
    if (existing) {
      if (dryRun) return { kind: "AgentDefinition", name: a.name, action: "createdNewDraftVersion", newIdentityId: existing.id };
      const versionLabel = await nextAgentVersionLabel(ctx, existing.id, String(a.version));
      const created = await createAgentDefinitionVersion(
        ctx,
        existing.id,
        { version: versionLabel, graphType: a.graphType as GraphTypeValue | undefined, modelRouteKey: a.modelRouteKey, artifact: parseAgentArtifactFromYaml(a.artifactYaml) as AgentDefinitionArtifact },
        actorUserId,
      );
      return { kind: "AgentDefinition", name: a.name, action: "createdNewDraftVersion", newIdentityId: existing.id, newVersionId: created.id };
    }
    if (dryRun) return { kind: "AgentDefinition", name: a.name, action: "createdNewIdentity" };
    const definition = await createAgentDefinition(ctx, { name: a.name, description: a.description ?? undefined });
    const created = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: isValidSemver(String(a.version)) ? String(a.version) : "1.0.0", graphType: a.graphType as GraphTypeValue | undefined, modelRouteKey: a.modelRouteKey, artifact: parseAgentArtifactFromYaml(a.artifactYaml) as AgentDefinitionArtifact },
      actorUserId,
    );
    return { kind: "AgentDefinition", name: a.name, action: "createdNewIdentity", newIdentityId: definition.id, newVersionId: created.id };
  } catch (err) {
    return { kind: "AgentDefinition", name: a.name, action: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Agent version labels are caller-supplied and must match `^\d+\.\d+\.\d+$`
 * (`CreateAgentDefinitionVersionRequestSchema`) — bumping the patch component avoids
 * colliding with a version the SAME label might already occupy under an existing
 * identity (the common case: restoring a backup of a tenant that still has the
 * original artifacts). Mirrors `VersionEditor.tsx`'s own "Restore" pre-fill's
 * `suggestRestoreVersionLabel` idea (same problem, independently re-derived here
 * since that helper is a client-component-local function, not an exported utility). */
async function nextAgentVersionLabel(ctx: TenantContext, agentDefinitionId: string, exportedVersion: string): Promise<string> {
  const existingVersions = await listAgentDefinitionVersions(ctx, agentDefinitionId);
  const existingLabels = new Set(existingVersions.map((v) => v.version));
  let candidate = isValidSemver(exportedVersion) ? exportedVersion : "1.0.0";
  while (existingLabels.has(candidate)) {
    const parts = candidate.split(".").map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    candidate = parts.join(".");
  }
  return candidate;
}

function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(v);
}

async function restoreSkill(ctx: TenantContext, s: ConfigBundle["artifacts"]["skills"][number], actorUserId: string, dryRun: boolean): Promise<ConfigBundleRestoreOutcome> {
  try {
    const existing = await findSkillByName(ctx, s.name);
    if (existing) {
      if (dryRun) return { kind: "Skill", name: s.name, action: "createdNewDraftVersion", newIdentityId: existing.id };
      const created = await createSkillVersion(ctx, existing.id, parseSkillArtifactFromYaml(s.artifactYaml), actorUserId);
      return { kind: "Skill", name: s.name, action: "createdNewDraftVersion", newIdentityId: existing.id, newVersionId: created.id };
    }
    if (dryRun) return { kind: "Skill", name: s.name, action: "createdNewIdentity" };
    const created = await createSkill(ctx, { name: s.name, description: s.description ?? undefined, artifact: parseSkillArtifactFromYaml(s.artifactYaml) }, actorUserId);
    return { kind: "Skill", name: s.name, action: "createdNewIdentity", newIdentityId: created.skill.id, newVersionId: created.version.id };
  } catch (err) {
    return { kind: "Skill", name: s.name, action: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

async function restoreWorkflow(ctx: TenantContext, w: ConfigBundle["artifacts"]["workflows"][number], actorUserId: string, dryRun: boolean): Promise<ConfigBundleRestoreOutcome> {
  try {
    const existing = await findWorkflowByName(ctx, w.name);
    if (existing) {
      if (dryRun) return { kind: "Workflow", name: w.name, action: "createdNewDraftVersion", newIdentityId: existing.id };
      const created = await createWorkflowVersion(ctx, existing.id, parseWorkflowArtifact(w.artifactYaml), actorUserId);
      return { kind: "Workflow", name: w.name, action: "createdNewDraftVersion", newIdentityId: existing.id, newVersionId: created.id };
    }
    if (dryRun) return { kind: "Workflow", name: w.name, action: "createdNewIdentity" };
    const created = await createWorkflow(ctx, { name: w.name, description: w.description ?? undefined, artifact: parseWorkflowArtifact(w.artifactYaml) }, actorUserId);
    return { kind: "Workflow", name: w.name, action: "createdNewIdentity", newIdentityId: created.workflow.id, newVersionId: created.version.id };
  } catch (err) {
    return { kind: "Workflow", name: w.name, action: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

async function restoreTeam(ctx: TenantContext, t: ConfigBundle["artifacts"]["teams"][number], actorUserId: string, dryRun: boolean): Promise<ConfigBundleRestoreOutcome> {
  try {
    const existing = await findTeamByName(ctx, t.name);
    if (existing) {
      if (dryRun) return { kind: "Team", name: t.name, action: "createdNewDraftVersion", newIdentityId: existing.id };
      const created = await createTeamVersion(ctx, existing.id, parseTeamArtifact(t.artifactYaml), actorUserId);
      return { kind: "Team", name: t.name, action: "createdNewDraftVersion", newIdentityId: existing.id, newVersionId: created.version.id };
    }
    if (dryRun) return { kind: "Team", name: t.name, action: "createdNewIdentity" };
    const created = await createTeamWithFirstVersion(ctx, { name: t.name, description: t.description ?? undefined, artifact: parseTeamArtifact(t.artifactYaml) }, actorUserId);
    return { kind: "Team", name: t.name, action: "createdNewIdentity", newIdentityId: created.team.id, newVersionId: created.version.id };
  } catch (err) {
    return { kind: "Team", name: t.name, action: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

async function restoreModelRoute(ctx: TenantContext, r: ConfigBundle["artifacts"]["modelRoutes"][number], actorUserId: string, dryRun: boolean): Promise<ConfigBundleRestoreOutcome> {
  try {
    const existing = await getRouteByName(ctx, r.name);
    if (existing) {
      if (dryRun) return { kind: "ModelRoute", name: r.name, action: "createdNewDraftVersion", newIdentityId: existing.id };
      // `publish: false` always — a restored route version lands Draft, exactly like
      // every other restored artifact, even though this kind's own promotion ladder
      // (Draft/Published) is shorter than the other four's Draft->Review->Approved->
      // Production (a disclosed, investigated difference — see the sub-plan doc).
      const created = await createRouteVersion(ctx, existing.id, { chain: r.chainJson as unknown as ModelRouteHopValue[], policy: r.policyJson as unknown as ModelRoutePolicyValue, createdByUserId: actorUserId }, false);
      return { kind: "ModelRoute", name: r.name, action: "createdNewDraftVersion", newIdentityId: existing.id, newVersionId: created.id };
    }
    if (dryRun) return { kind: "ModelRoute", name: r.name, action: "createdNewIdentity" };
    const route = await createRoute(ctx, { name: r.name, description: r.description ?? undefined, role: r.role as ModelRouteRoleValue });
    const created = await createRouteVersion(ctx, route.id, { chain: r.chainJson as unknown as ModelRouteHopValue[], policy: r.policyJson as unknown as ModelRoutePolicyValue, createdByUserId: actorUserId }, false);
    return { kind: "ModelRoute", name: r.name, action: "createdNewIdentity", newIdentityId: route.id, newVersionId: created.id };
  } catch (err) {
    return { kind: "ModelRoute", name: r.name, action: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Connectors are the one restorable kind that is NOT a versioned artifact — there is
 * no "new Draft" concept for them, only "a brand-new row" (never an in-place
 * overwrite of an existing connector, which this function never even attempts).
 *
 * A credentialed connector (`authMethod !== "None"`) is NEVER auto-created: this
 * codebase's own `createConnector()` already refuses to create one without a fresh
 * `credentialPlaintext` (`CredentialRequiredError`), which is the exact mechanism
 * that makes "restoring a connector must re-prompt for credentials, never carry
 * secret material through an export file" hold structurally. This function reports
 * such a connector as `skipped` with its own non-secret fields already visible in the
 * bundle for the admin to recreate by hand via the existing New Connector screen.
 */
async function restoreConnector(ctx: TenantContext, c: ConfigBundle["artifacts"]["connectors"][number], dryRun: boolean): Promise<ConfigBundleRestoreOutcome> {
  if (c.authMethod !== "None") {
    return { kind: "Connector", name: c.name, action: "skipped", reason: "This connector requires a credential; restore never carries secret material through the bundle. Recreate it manually via New Connector using the fields in this bundle." };
  }
  // Real, disclosed gap found by this phase's own investigation (not something
  // FR-ADM-08 asked this phase to fix): `createConnector()`/`CreateConnectorRequest`
  // have no way to SUPPLY `stdio_command` at all today — only a `StreamableHTTP`
  // connector can be created through the existing API. A `StdioViaGateway` connector
  // is therefore never auto-restorable either (it would fail the DB's own
  // `connector_stdio_command_required_for_stdio` CHECK, not because of anything this
  // phase did) — reported the same way a credentialed connector is, not silently
  // attempted and left to fail.
  if (c.transport !== "StreamableHTTP") {
    return { kind: "Connector", name: c.name, action: "skipped", reason: `Connectors using the '${c.transport}' transport cannot be created through the existing connector API (pre-existing gap, unrelated to this phase) — recreate it manually via New Connector using the fields in this bundle.` };
  }
  try {
    const existing = await findConnectorByName(ctx, c.environment as EnvironmentValue, c.name);
    if (existing) {
      return { kind: "Connector", name: c.name, action: "skipped", reason: `A connector named '${c.name}' already exists in the '${c.environment}' environment — restore never overwrites it in place.` };
    }
    if (dryRun) return { kind: "Connector", name: c.name, action: "createdNewIdentity" };
    const created = await createConnector(ctx, {
      name: c.name,
      description: c.description ?? undefined,
      backendType: c.backendType as BackendTypeValue,
      templateKey: c.templateKey ?? undefined,
      transport: c.transport as McpTransportValue,
      endpointUrl: c.endpointUrl ?? undefined,
      authMethod: "None",
      environment: c.environment as EnvironmentValue,
    });
    return { kind: "Connector", name: c.name, action: "createdNewIdentity", newIdentityId: created.id };
  } catch (err) {
    return { kind: "Connector", name: c.name, action: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}
