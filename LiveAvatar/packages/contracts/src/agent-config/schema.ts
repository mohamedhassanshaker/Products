import { Type as T, type Static } from '@sinclair/typebox';
import './formats';
import {
  AgentRuntimeKey,
  AvatarProviderKey,
  ResidencyMode,
  SttProviderKey,
  TransportProviderKey,
  TtsProviderKey,
} from './schema-keys';
import { KnowledgeSchema, ReasoningSchema, SkillRefSchema } from './reasoning-graph.schema';
import { DynamicsSchema } from './dynamics.schema';

/**
 * Canonical Agent Builder / deployment-config YAML schema (spec FR-CONFIG-2,
 * LLD §6.1). This is the single source of truth for the shape both the Nest
 * validator (`deployment-config` module) and — from Phase 4 onward — the
 * Python agent's Pydantic mirror must agree on. Changing a field here without
 * a matching Pydantic + fixture-corpus update is an architecture defect
 * (ADR-001 §"drift control").
 *
 * Phase 9 (BL-035, `docs/v2/BACKLOG.md`): the flat `llm: {primary, fallback,
 * retry}` block is replaced by `reasoning: { graph, entry_node_id,
 * background_entry_node_ids, turn_budget_ms }` (`reasoning-graph.schema.ts`)
 * — a minimal single-LLM-node agent's graph node carries the exact same
 * provider/model/fallback/retry shape the old `llm` block had (R-G1).
 */

export {
  AgentRuntimeKey,
  AvatarProviderKey,
  LlmProviderKey,
  ResidencyMode,
  SttProviderKey,
  TransportProviderKey,
  TtsProviderKey,
} from './schema-keys';
export * from './reasoning-graph.schema';
export * from './dynamics.schema';

/** Secret-store reference — never a raw secret value (FR-PROVIDER-7). */
const CredentialRef = T.String({ minLength: 1, maxLength: 256 });
/** BCP-47 language tag, e.g. `en-US` (CONFIG_LANGUAGE_INVALID). */
const Bcp47 = T.String({ pattern: '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$' });

/**
 * The full canonical config object (LLD §6.1). `additionalProperties: false`
 * on the root is what produces `CONFIG_YAML_UNKNOWN_KEY` for any stray top
 * -level key — this is deliberate: unknown keys are a save-time hard error,
 * not a silently-ignored typo.
 */
export const AgentConfigSchema = T.Object(
  {
    version: T.Literal(1),
    deployment: T.Object({
      tenant_id: T.String({ format: 'uuid' }), // server-owned; ignored on write if mismatched
      name: T.String({ minLength: 1, maxLength: 80 }),
    }),
    transport: T.Object({
      provider: TransportProviderKey,
      credential_ref: T.Optional(CredentialRef),
      room_namespace: T.String({ pattern: '^[a-z][a-z0-9-]{1,47}$' }), // server-owned, = tenant.slug
    }),
    stt: T.Object({
      provider: SttProviderKey,
      credential_ref: T.Optional(CredentialRef),
      language: T.String({ ...Bcp47, default: 'en-US' }),
      model: T.Optional(T.String({ maxLength: 128 })),
    }),
    reasoning: ReasoningSchema,
    tts: T.Object({
      provider: TtsProviderKey,
      credential_ref: T.Optional(CredentialRef),
      voice_id: T.String({ minLength: 1, maxLength: 128 }), // required
    }),
    avatar: T.Object({
      provider: AvatarProviderKey,
      credential_ref: T.Optional(CredentialRef),
      avatar_id: T.String({ minLength: 1, maxLength: 128 }), // required
    }),
    agent: T.Object({
      runtime: AgentRuntimeKey,
      system_prompt: T.String({ maxLength: 32768 }), // bytes re-checked separately (UTF-16 vs bytes)
      tools: T.Array(
        T.Object({
          name: T.String({ minLength: 1, maxLength: 80 }),
          api_ref: T.String({ minLength: 1, maxLength: 64 }),
          enabled: T.Boolean({ default: true }),
        }),
        { default: [] },
      ),
      memory: T.Object({
        enabled: T.Boolean({ default: true }),
        window_turns: T.Integer({ minimum: 0, maximum: 64, default: 16 }),
      }),
    }),
    /**
     * Phase 12b (BL-045/047) — replaces the old `agent.rag.{enabled,index_ref}`
     * flag+free-text pair (removed this phase; superseded entirely by
     * `RetrieveNode.source_refs` + this pipeline config, see the plan doc's
     * Phase 12b "Decisions made this phase" #3 and "Cleanup" scope item).
     */
    knowledge: KnowledgeSchema,
    /**
     * Phase 13 (BL-049/050/051) — the agent-level "attached" skill list,
     * the top-level analog of `agent.tools[]` (R-S1/R-S7's base-prompt
     * cost). See `reasoning-graph.schema.ts`'s `SkillRefSchema` doc
     * comment for the `version: number | "latest"` resolution split.
     */
    skills: T.Array(SkillRefSchema, { default: [] }),
    privacy: T.Object({
      send_to_remote_llm: ResidencyMode,
      retain_transcripts_days: T.Integer({ minimum: 1, maximum: 730, default: 90 }),
      recordings_enabled: T.Boolean({ default: false }),
    }),
    alerts: T.Object({
      degraded_mode_message: T.String({ minLength: 1, maxLength: 500 }),
    }),
    /**
     * Phase 16 (BL-062) — barge-in/endpointing/verbosity/no-input/call-limit
     * config surface. Optional, unlike every other top-level block here —
     * see `dynamics.schema.ts`'s own doc comment for why.
     */
    dynamics: T.Optional(DynamicsSchema),
  },
  { additionalProperties: false },
);

/** Inferred canonical config type — mirrored by the Python agent from Phase 4. */
export type AgentConfig = Static<typeof AgentConfigSchema>;
