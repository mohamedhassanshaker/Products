import { Inject, Injectable } from '@nestjs/common';
import type { AgentRuntimeConfigDto, RetrievalPipelineConfig } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../../deployment-config';
import { PROVIDER_CREDENTIAL_REPOSITORY, type ProviderCredentialRepositoryPort } from '../../providers';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../../tools';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../../skills';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';

/**
 * `GET /internal/sessions/{id}/runtime-config` (LLD §5.9/§6.3) — the one
 * response the Python agent's `AgentRuntimeConfig` Pydantic model parses.
 * Secrets are never in this response: only `endpoint_url` (resolved here)
 * and `credential_ref` (already present in the stored config) travel over
 * the wire; the agent resolves the actual secret value from its own
 * `SECRETS_DIR` mount via `credential_ref` (LLD §7.4).
 *
 * The residency snapshot returned is the one taken **at session start**
 * (`Session.residencySnapshot`), never a live re-read of
 * `DataResidencyPolicy` — this is what makes FR-PRIV-2's "a mid-session
 * policy change cannot widen an in-flight session" hold on the agent side
 * too, not only in the control plane.
 */
@Injectable()
export class GetRuntimeConfigUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly toolDefinitions: ToolDefinitionRepositoryPort,
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
  ) {}

  /**
   * @param sessionId - Target session
   * @throws AppError SESSION_NOT_FOUND when the session id is unknown
   * @throws AppError CONFIG_INCOMPLETE when the tenant's config is missing/unpublished
   *   (should not happen for a session that was ever issued a token, but a
   *   session can outlive a config that was since un-published by a fresh
   *   draft-only save — defensive, not the primary gate)
   */
  async execute(sessionId: string): Promise<AgentRuntimeConfigDto> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }

    const config = await this.configs.findByTenantId(session.tenantId);
    if (!config) {
      throw new AppError('CONFIG_INCOMPLETE', 422);
    }

    const structured = config.structured;
    const creds = await this.credentials.list(session.tenantId, {});

    // QA fix (phase4-agent-python D-2): resolve every *enabled* configured
    // tool's `api_ref` against the real `ToolDefinition` table so the agent
    // receives enough to actually call it (url/method/credential_ref), not
    // just the bare reference `agent.tools[]` itself carries.
    const enabledApiRefs = (structured.agent?.tools ?? [])
      .filter((t) => t.enabled !== false)
      .map((t) => t.api_ref);
    const toolDefinitionRecords = enabledApiRefs.length
      ? await this.toolDefinitions.listEnabledByApiRefs(session.tenantId, enabledApiRefs)
      : [];
    const toolDefinitions = toolDefinitionRecords.map((record) => ({
      api_ref: record.apiRef,
      name: record.name,
      description: record.description ?? undefined,
      method: record.method,
      url: record.url,
      credential_ref: record.credentialRef ?? undefined,
      args_schema: record.argsSchema,
    }));

    // Phase 13 (BL-049/050/051, `ARCHITECTURE_NOTES.md` §5.3) — resolves
    // every `"latest"` skill reference to a concrete published version
    // number **once, here, at session-start read time** (mirrors how
    // `llm_by_node`/`agent.tools[]` are already resolved once per session,
    // not re-read mid-call). Two things get resolved:
    //  1. The top-level `skills[]` attach list -> `skill_summaries` (the
    //     ~15-token description blurb R-S1 allows into the base prompt).
    //  2. Any `skill`-type graph node's own `version` field, rewritten
    //     in-place on the returned `reasoning.graph` so the interpreter
    //     never sees the literal string `"latest"`.
    // A ref that fails to resolve (skill deleted/unpublished since the
    // config was last saved) is silently omitted — same defensive
    // "since-deleted/disabled reference is omitted, not a hard failure"
    // precedent `tool_definitions` below already follows; V-12 already
    // prevents this at publish time, this is defense in depth only.
    const skillSummaries: { id: string; version: number; name: string; description: string }[] = [];
    for (const ref of structured.skills ?? []) {
      const resolved = await this.skills.findPublishedVersion(session.tenantId, ref.id, ref.version);
      if (resolved) {
        skillSummaries.push({ id: ref.id, version: resolved.versionNumber, name: resolved.name, description: resolved.description });
      }
    }
    const resolvedSkillNodeVersions = new Map<string, number>();
    for (const node of structured.reasoning?.graph ?? []) {
      if (node.type !== 'skill') {
        continue;
      }
      const resolved = await this.skills.findPublishedVersion(session.tenantId, node.skill_id, node.version);
      if (resolved) {
        resolvedSkillNodeVersions.set(node.id, resolved.versionNumber);
      }
    }
    const resolvedReasoning = structured.reasoning
      ? {
          ...structured.reasoning,
          graph: structured.reasoning.graph.map((node) =>
            node.type === 'skill' && resolvedSkillNodeVersions.has(node.id)
              ? { ...node, version: resolvedSkillNodeVersions.get(node.id) as number }
              : node,
          ),
        }
      : structured.reasoning;

    // Phase 9 (BL-035): every `llm`-type `reasoning.graph[]` node's
    // primary/fallback leg needs its endpoint resolved too, not just a
    // single top-level `llm.primary`/`llm.fallback` pair.
    const llmNodeLegs = (structured.reasoning?.graph ?? [])
      .filter((n): n is Extract<typeof n, { type: 'llm' }> => n.type === 'llm')
      .flatMap((n) => [n, n.fallback].filter((leg): leg is NonNullable<typeof leg> => Boolean(leg)));

    const endpoints: Record<string, string> = {};
    const legs: { provider?: string; credential_ref?: string }[] = [
      structured.transport ?? {},
      structured.stt ?? {},
      ...llmNodeLegs,
      structured.tts ?? {},
      structured.avatar ?? {},
    ];
    for (const leg of legs) {
      if (!leg.provider) {
        continue;
      }
      const match = leg.credential_ref
        ? creds.find((c) => c.providerKey === leg.provider && c.credentialRef === leg.credential_ref)
        : creds.find((c) => c.providerKey === leg.provider);
      if (match) {
        endpoints[leg.provider] = match.endpointUrl;
      }
    }

    return {
      version: 1,
      deployment: { tenant_id: session.tenantId, name: structured.deployment?.name ?? '' },
      transport: {
        provider: 'livekit',
        credential_ref: structured.transport?.credential_ref,
        room_namespace: structured.transport?.room_namespace ?? '',
      },
      stt: {
        provider: structured.stt?.provider as 'deepgram' | 'faster-whisper',
        credential_ref: structured.stt?.credential_ref,
        language: structured.stt?.language ?? 'en-US',
        model: structured.stt?.model,
      },
      // Phase 9 (BL-035): a published config's `reasoning` block is always
      // schema-complete (Gate B's completeness rule) — passed through
      // as-is rather than hand-reconstructed field by field, the way the
      // pre-Phase-9 `llm` block used to be. Phase 13 (BL-049/050/051):
      // `resolvedReasoning` is the same object with any `skill`-type
      // node's `"latest"` version already resolved to a concrete number
      // (see above) — never the raw `structured.reasoning` once a Skill
      // node is present.
      reasoning: resolvedReasoning as NonNullable<typeof structured.reasoning>,
      tts: {
        provider: structured.tts?.provider as 'fish-speech' | 'elevenlabs',
        credential_ref: structured.tts?.credential_ref,
        voice_id: structured.tts?.voice_id ?? '',
      },
      avatar: {
        provider: structured.avatar?.provider as 'bithuman' | 'alibaba-liveavatar',
        credential_ref: structured.avatar?.credential_ref,
        avatar_id: structured.avatar?.avatar_id ?? '',
      },
      agent: {
        runtime: (structured.agent?.runtime as 'langgraph' | 'pydantic-ai') ?? 'langgraph',
        system_prompt: structured.agent?.system_prompt ?? '',
        tools: (structured.agent?.tools ?? []).map((t) => ({
          name: t.name,
          api_ref: t.api_ref,
          enabled: t.enabled ?? true,
        })),
        memory: {
          enabled: structured.agent?.memory?.enabled ?? true,
          window_turns: structured.agent?.memory?.window_turns ?? 16,
        },
      },
      // Phase 12b (BL-045/047) — replaces the removed `agent.rag` flag+ref
      // pair. A published config's `knowledge.pipeline` is always
      // schema-complete once any layer is (same "pass through, don't
      // hand-reconstruct" precedent `reasoning` above already follows) —
      // defaulted here only for a config saved before this phase existed
      // (none in this checkout, defensive per this file's own convention).
      knowledge: {
        pipeline: (structured.knowledge?.pipeline as unknown as RetrievalPipelineConfig | undefined) ?? {
          rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
          hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
          metadata_filter: { enabled: false, budget_ms: 20 },
          rerank: { enabled: false },
          threshold: { min_score: 0.5, budget_ms: 10 },
          inject: { token_cap: 1200, citation_format: 'numbered', budget_ms: 30 },
        },
      },
      privacy: {
        // Session-start snapshot, not a live policy read (FR-PRIV-2).
        send_to_remote_llm: session.residencySnapshot.sendToRemoteLlm,
        retain_transcripts_days: session.residencySnapshot.retainTranscriptsDays,
        recordings_enabled: session.residencySnapshot.recordingsEnabled,
      },
      alerts: {
        degraded_mode_message: structured.alerts?.degraded_mode_message ?? '',
      },
      // Phase 13 (BL-049/050/051) — the raw, unresolved attach list (passed
      // through as-is, same "reference list stays a reference list"
      // treatment `agent.tools` gets above); `skill_summaries` below is the
      // resolved, progressive-disclosure-safe enrichment the Python side
      // actually reads to build its effective base prompt.
      skills: structured.skills ?? [],
      session_id: sessionId,
      room_name: session.roomName,
      endpoints,
      tool_definitions: toolDefinitions,
      skill_summaries: skillSummaries,
    } as AgentRuntimeConfigDto;
  }
}
