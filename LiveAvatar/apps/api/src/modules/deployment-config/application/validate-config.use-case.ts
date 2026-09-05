import { Inject, Injectable } from '@nestjs/common';
import { Value } from '@sinclair/typebox/value';
import {
  codeForConfigPath,
  containsSecretKey,
  messageForCode,
  type AppErrorCode,
  type ConfigErrorDto,
  type CriticalPathReportDto,
  type ResolvedLayerDto,
} from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import {
  PROVIDER_CREDENTIAL_REPOSITORY,
  PROVIDER_DEFINITION_REPOSITORY,
  type ProviderCredentialRepositoryPort,
  type ProviderDefinitionRepositoryPort,
} from '../../providers';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../../tools';
import { computeIsStale, KNOWLEDGE_SOURCE_REPOSITORY, type KnowledgeSourceRepositoryPort } from '../../knowledge';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../../skills';
import { HITL_GATE_REPOSITORY, REVIEWER_GROUP_REPOSITORY, type HitlGateRepositoryPort, type ReviewerGroupRepositoryPort } from '../../hitl';
import { runCombinationRules, type ValidationContext } from '../domain/combination-rules';
import { computeCriticalPath } from '../domain/critical-path';
import { AGENT_CONFIG_TOP_LEVEL_KEYS, DraftAgentConfigSchema } from '../domain/draft-schema';
import { AgentConfigParseError, findLlmNodes, parseAgentConfigYaml, stringifyAgentConfig, type PartialAgentConfig } from '../domain/agent-config';
import { validateGraphRules } from '../domain/graph-rules';
import { validateGraphStructure } from '../domain/graph-structure';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../domain/ports';
import type { ConfigError } from '../domain/errors';

/** Result of running both validation gates (LLD §8.2). */
export interface GateResult {
  errors: ConfigError[];
  /** `true` only when Gate A produced zero errors (i.e. the document is well-formed). */
  schemaValid: boolean;
  config: PartialAgentConfig;
}

/**
 * Shared validation engine behind `POST /config/validate` and `PUT /config`
 * (FR-PROVIDER-5: "same rules, no drift"). Two ordered gates:
 *
 * Gate A (schema, `400`-shaped codes even though `/validate` always returns
 * `200`): YAML parse → top-level unknown-key scan → secret-key scan →
 * TypeBox structural check against the **draft** (all-optional) schema.
 * Gate B (combinations, `422`-shaped codes): catalog/credential/residency
 * rules, run only after Gate A passes.
 */
@Injectable()
export class ValidateConfigUseCase {
  constructor(
    @Inject(PROVIDER_DEFINITION_REPOSITORY) private readonly definitions: ProviderDefinitionRepositoryPort,
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly tools: ToolDefinitionRepositoryPort,
    @Inject(KNOWLEDGE_SOURCE_REPOSITORY) private readonly knowledgeSources: KnowledgeSourceRepositoryPort,
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly hitlGates: HitlGateRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly deploymentConfigs: DeploymentConfigRepositoryPort,
  ) {}

  /**
   * Parses/normalizes the input into a `PartialAgentConfig`, throwing a
   * `400`-class `AppError` for the two "never persisted" failure modes
   * (unparseable YAML, secret material present) that neither draft nor
   * published saves may store (LLD §5.5 "Draft saves persist through 422
   * ... but not through 400").
   * @param input - Either raw YAML text or an already-structured object
   */
  parseInput(input: { yaml_text?: string; config?: unknown }): unknown {
    if (input.yaml_text !== undefined) {
      try {
        return parseAgentConfigYaml(input.yaml_text);
      } catch (err) {
        if (err instanceof AgentConfigParseError) {
          throw AppError.badRequest('CONFIG_YAML_PARSE', { reason: err.reason });
        }
        throw err;
      }
    }
    return input.config ?? {};
  }

  /**
   * Runs Gate A (schema) only, throwing on the two never-persist codes and
   * returning the collected field errors otherwise.
   * @param raw - Parsed YAML/structured value (untrusted shape)
   */
  runSchemaGate(raw: unknown): GateResult {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw AppError.badRequest('CONFIG_YAML_PARSE', { reason: 'document must be a mapping' });
    }
    const obj = raw as Record<string, unknown>;

    const unknownKeys = Object.keys(obj).filter(
      (k) => !(AGENT_CONFIG_TOP_LEVEL_KEYS as readonly string[]).includes(k),
    );
    if (unknownKeys.length > 0) {
      throw AppError.badRequest('CONFIG_YAML_UNKNOWN_KEY', { fields: { keys: unknownKeys.join(', ') } });
    }

    // FR-PROVIDER-7 / FR-CONFIG-2 — secrets are rejected before anything else
    // is persisted, regardless of where in the structure they appear.
    if (containsSecretKey(obj)) {
      throw AppError.badRequest('CONFIG_SECRET_IN_YAML');
    }

    const cleaned = Value.Clean(DraftAgentConfigSchema, obj);
    const converted = Value.Convert(DraftAgentConfigSchema, cleaned);
    const errors: ConfigError[] = [];
    if (!Value.Check(DraftAgentConfigSchema, converted)) {
      for (const err of Value.Errors(DraftAgentConfigSchema, converted)) {
        const code: AppErrorCode = codeForConfigPath(err.path, 'CONFIG_YAML_PARSE');
        errors.push({ code, field: err.path, message: messageForCode(code) });
      }
    }

    // system_prompt is re-checked in bytes — TypeBox's maxLength counts
    // UTF-16 code units, which under-counts the real wire size for any
    // multi-byte character (LLD §6.1 note).
    const prompt = (converted as PartialAgentConfig).agent?.system_prompt;
    if (prompt && Buffer.byteLength(prompt, 'utf8') > 32768) {
      errors.push({ code: 'CONFIG_PROMPT_TOO_LARGE', field: '/agent/system_prompt', message: messageForCode('CONFIG_PROMPT_TOO_LARGE') });
    }
    // Phase 9 (BL-035): backoff_ms.length === max_attempts and
    // model-required-when-provider-chosen are now enforced per `llm`-type
    // graph node by the schema/TypeBox layer itself (`RetryPolicySchema`,
    // `LlmNodeSchema.model` is a required sibling of `provider`), not this
    // use-case's own manual checks — a graph node is either fully valid or
    // the whole `reasoning` block fails Gate A structurally (see
    // `draft-schema.ts`'s comment on why partial-node state isn't
    // supported). `CONFIG_RETRY_INVALID`/`CONFIG_MODEL_REQUIRED` therefore
    // now surface as generic `CONFIG_YAML_PARSE`-coded TypeBox errors when
    // they occur inside a graph node, not as the specific codes below.
    const graphErrors = validateGraphStructure((converted as PartialAgentConfig).reasoning);
    errors.push(...graphErrors);

    // Phase 11 (BL-042/043) — V-2 (loop guards) / V-4 (no cycles outside
    // Loop) are both Gate A structural checks per `ARCHITECTURE_NOTES.md`
    // §7's table, so they block **save** (draft or published) the same way
    // `graphErrors` above does, not just publish. Phase 12b adds V-10
    // (retrieval stage budgets), the same Gate A structural class — needs
    // `knowledge.pipeline` alongside `reasoning`, both already on `converted`.
    const graphRuleErrors = validateGraphRules(
      (converted as PartialAgentConfig).reasoning,
      (converted as PartialAgentConfig).knowledge?.pipeline,
    );
    errors.push(...graphRuleErrors);

    // The canonical schema (§6.1) requires voice_id/avatar_id whenever that
    // layer's object is present at all (i.e. its provider was chosen) — the
    // draft schema only enforces the *format* of a present value, so
    // "provider chosen, required sibling field left empty" needs this
    // explicit presence check to produce the spec's exact 400 codes.
    const parsed = converted as PartialAgentConfig;
    if (parsed.tts?.provider && !parsed.tts.voice_id) {
      errors.push({ code: 'CONFIG_VOICE_REQUIRED', field: '/tts/voice_id', message: messageForCode('CONFIG_VOICE_REQUIRED') });
    }
    if (parsed.avatar?.provider && !parsed.avatar.avatar_id) {
      errors.push({ code: 'CONFIG_AVATAR_ID_REQUIRED', field: '/avatar/avatar_id', message: messageForCode('CONFIG_AVATAR_ID_REQUIRED') });
    }

    return { errors, schemaValid: errors.length === 0, config: converted as PartialAgentConfig };
  }

  /**
   * Runs Gate B against an already schema-valid config, loading the catalog
   * and this tenant's credentials once.
   * @param tenantId - Owning tenant
   * @param config - Schema-valid partial config
   */
  async runCombinationGate(tenantId: string, config: PartialAgentConfig): Promise<ConfigError[]> {
    const [defs, creds, toolDefs, knowledgeSourceRecords, publishedSkillRecords, hitlGateRecords, reviewerGroupRecords] = await Promise.all([
      this.definitions.list({}),
      this.credentials.list(tenantId, {}),
      this.tools.listByTenant(tenantId),
      this.knowledgeSources.findMany(tenantId),
      this.skills.listPublishedByTenant(tenantId),
      this.hitlGates.listByTenant(tenantId),
      this.reviewerGroups.listByTenant(tenantId),
    ]);
    const catalog = new Map(defs.map((d) => [d.key, d]));
    const credentialsByProviderKey = new Map<string, typeof creds>();
    for (const cred of creds) {
      const list = credentialsByProviderKey.get(cred.providerKey) ?? [];
      list.push(cred);
      credentialsByProviderKey.set(cred.providerKey, list);
    }
    // Existence check only (not "enabled") — CONFIG_TOOL_UNKNOWN is about
    // whether the `api_ref` resolves to a real tenant ToolDefinition row at
    // all, per FR-AGENT-2's "Unknown api_ref at publish" rule. Phase 4
    // (BL-013..017) wires this against the real table; no admin UI creates
    // `ToolDefinition` rows yet (open item, see the plan doc), so in
    // practice every tenant's known-ref set is empty until that surface
    // exists — this repository read is what makes the check correct the
    // moment it does.
    const knownToolRefs = new Set(toolDefs.map((t) => t.apiRef));
    // Phase 12b (BL-045/047) — V-9's per-Retrieve-node-reference staleness
    // warning needs this tenant's own `KnowledgeSource` staleness snapshot;
    // `computeIsStale` is the same derived (never stored) signal the
    // Sources sub-tab's own staleness badge already uses (12a).
    const knowledgeSources = knowledgeSourceRecords.map((s) => ({ id: s.id, name: s.name, isStale: computeIsStale(s) }));
    // Phase 13 (BL-049/050/051) — V-12's existence check + V-11's
    // skills-term description cost both need this tenant's own published
    // skill set, resolved once per validate/save call (same "load once,
    // pass through `ValidationContext`" convention every other Gate B
    // dependency here already follows).
    const publishedSkills = new Map(
      publishedSkillRecords.map((s) => [s.id, { name: s.name, description: s.description, hitlGateId: s.hitlGateId }]),
    );
    const toolDescriptionsByApiRef = new Map(
      toolDefs.map((t) => [t.apiRef, { description: t.description, argsSchema: t.argsSchema }]),
    );
    // Phase 14 (BL-057) — V-6/V-7's own dependencies, loaded once per
    // validate/save call alongside everything else here (same convention).
    const consequentialToolApiRefs = new Set(toolDefs.filter((t) => t.consequential).map((t) => t.apiRef));
    const toolAutonomousAckByApiRef = new Map(toolDefs.map((t) => [t.apiRef, t.autonomousUseAckText]));
    const toolGateIdByApiRef = new Map(
      hitlGateRecords.filter((g) => g.attachmentKind === 'tool').map((g) => [g.attachmentRef, g.id]),
    );
    const reviewerGroupsById = new Map(reviewerGroupRecords.map((g) => [g.id, g]));
    const hitlGatesById = new Map(
      hitlGateRecords.map((g) => {
        const group = reviewerGroupsById.get(g.reviewerGroupId);
        const hasReviewerCoverage = Boolean(group && group.members.length > 0 && (g.notifyChannels.length > 0 || group.notificationChannels.length > 0));
        return [g.id, { gateType: g.gateType, hasReviewerCoverage }];
      }),
    );
    // Phase 15 (BL-058, V-3) — every distinct `target_tenant_id` a
    // `subagent`-type node in this config references, resolved by reading
    // that tenant's own `DeploymentConfig` directly (this codebase has no
    // separate "Agent" entity — a tenant *is* the agent 1:1, see
    // `SubAgentNodeSchema`'s doc comment). One hop only: this config's own
    // node is hop 1, so checking whether the *target's* config itself
    // contains a `subagent` node (hop 2) is exactly R-G6's ≤2 boundary —
    // no need to recurse further.
    const subAgentTargetTenantIds = new Set(
      (config.reasoning?.graph ?? [])
        .filter((n): n is Extract<typeof n, { type: 'subagent' }> => n.type === 'subagent')
        .map((n) => n.target_tenant_id),
    );
    const subAgentTargetsById = new Map<string, { published: boolean; hasSubAgentNode: boolean }>();
    for (const targetTenantId of subAgentTargetTenantIds) {
      const targetConfig = await this.deploymentConfigs.findByTenantId(targetTenantId);
      const published = targetConfig?.status === 'published';
      const hasSubAgentNode = published
        ? (targetConfig?.structured.reasoning?.graph ?? []).some((n) => n.type === 'subagent')
        : false;
      subAgentTargetsById.set(targetTenantId, { published, hasSubAgentNode });
    }

    const ctx: ValidationContext = {
      config,
      catalog,
      credentialsByProviderKey,
      knownToolRefs,
      toolDescriptionsByApiRef,
      knowledgeSources,
      publishedSkills,
      consequentialToolApiRefs,
      toolAutonomousAckByApiRef,
      toolGateIdByApiRef,
      hitlGatesById,
      tenantId,
      subAgentTargetsById,
    };
    return runCombinationRules(ctx);
  }

  /**
   * Full validate flow (`POST /config/validate`, FR-CONFIG-3/4) — always
   * resolves (never throws for a malformed-but-reportable document; parse
   * failures on `yaml_text` alone still throw so callers surface `400`
   * exactly where the spec requires it for that one input mode).
   *
   * Authorization (FR-TENANT-5/FR-CONFIG-1): the same tenant-access check
   * `GetConfigUseCase`/`SaveConfigUseCase` perform — an unknown tenant id or
   * an admin not assigned to this tenant both surface as `404
   * TENANT_NOT_FOUND` (matching the "don't reveal existence" rule), rather
   * than silently resolving another tenant's credential/hosting metadata.
   * @param actor - Authenticated admin making the request
   * @param tenantId - Owning tenant
   * @param input - Raw YAML or structured body
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    input: { yaml_text?: string; config?: unknown },
  ): Promise<{
    valid: boolean;
    errors: ConfigErrorDto[];
    resolved: Record<string, ResolvedLayerDto>;
    redacted_yaml: string;
    critical_path: CriticalPathReportDto | null;
  }> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }

    const raw = this.parseInput(input);
    const gateA = this.runSchemaGate(raw);
    const gateB = gateA.schemaValid ? await this.runCombinationGate(tenantId, gateA.config) : [];
    const errors = [...gateA.errors, ...gateB];

    const defs = await this.definitions.list({});
    const catalog = new Map(defs.map((d) => [d.key, d]));
    const creds = await this.credentials.list(tenantId, {});
    const hasCredential = (key?: string) => Boolean(key) && creds.some((c) => c.providerKey === key && c.credentialRef);

    const [primaryLlmNode] = findLlmNodes(gateA.config.reasoning);
    const resolved: Record<string, ResolvedLayerDto> = {
      transport: this.resolveLayer(gateA.config.transport?.provider, catalog, hasCredential),
      stt: this.resolveLayer(gateA.config.stt?.provider, catalog, hasCredential),
      llm: this.resolveLayer(primaryLlmNode?.provider, catalog, hasCredential),
      llm_fallback: this.resolveLayer(primaryLlmNode?.fallback?.provider, catalog, hasCredential),
      tts: this.resolveLayer(gateA.config.tts?.provider, catalog, hasCredential),
      avatar: this.resolveLayer(gateA.config.avatar?.provider, catalog, hasCredential),
    };

    // Phase 10 (BL-040) — critical-path/turn-budget data for the builder's
    // turn budget panel. Only computed once Gate A's own schema check has
    // passed (`gateA.schemaValid`) — same discipline Gate B itself follows
    // (a structurally-invalid graph has nothing meaningful to enumerate;
    // `graph-structure.ts`'s referential-integrity errors already cover
    // that case in `errors` above).
    const critical_path: CriticalPathReportDto | null =
      gateA.schemaValid && gateA.config.reasoning ? computeCriticalPath(gateA.config.reasoning) : null;

    return {
      // Phase 12b (BL-045/047) — a `severity: 'warning'` error (V-9 today)
      // is surfaced in `errors` (so it renders inline, per UX_SCOPE.md) but
      // must not flip `valid` to `false` — `canPublish` in the builder store
      // is wired directly off this flag (`validateResult()?.valid === true`).
      valid: errors.every((e) => e.severity === 'warning'),
      errors,
      resolved,
      redacted_yaml: stringifyAgentConfig(gateA.config),
      critical_path,
    };
  }

  private resolveLayer(
    key: string | undefined,
    catalog: Map<string, { hosting: string; featureGaps: string | null }>,
    hasCredential: (key?: string) => boolean,
  ): ResolvedLayerDto {
    if (!key) {
      return { provider: null, hosting: null, has_secret: false, feature_gaps: null };
    }
    const def = catalog.get(key);
    return {
      provider: key,
      hosting: def?.hosting ?? null,
      has_secret: hasCredential(key),
      feature_gaps: def?.featureGaps ?? null,
    };
  }
}
