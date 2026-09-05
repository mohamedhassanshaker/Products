import { Type as T } from '@sinclair/typebox';
import {
  AgentRuntimeKey,
  AvatarProviderKey,
  CitationFormatSchema,
  ResidencyMode,
  ReasoningSchema,
  SkillRefSchema,
  SttProviderKey,
  TransportProviderKey,
  TtsProviderKey,
} from '@liveavatar/contracts';

/**
 * A field-by-field **optional** mirror of `AgentConfigSchema` (LLD §6.1),
 * used only for Gate A structural checks on a **draft** (FR-CONFIG-3: a
 * draft persists even when incomplete). The canonical schema requires every
 * layer's provider, so a brand-new tenant's all-unset config could never
 * pass it — but it must still round-trip through Gate A/B so the live
 * preview (FR-CONFIG-4) can report exactly which layers are incomplete
 * (Gate B's `CONFIG_INCOMPLETE`) instead of a blanket parse failure.
 *
 * Every leaf keeps its real type/format/range constraint — a *present*
 * value that's wrong (e.g. `stt.language: "not-a-tag"`) is still rejected
 * here, only *absence* is tolerated. Not exported to `packages/contracts`:
 * this is a Nest-validator-only convenience, not part of the cross-language
 * contract (the Python mirror, from Phase 4, only ever sees a fully-resolved
 * **published** config).
 */
const CredentialRef = T.String({ minLength: 1, maxLength: 256 });
const Bcp47 = T.String({ pattern: '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$' });

export const DraftAgentConfigSchema = T.Object({
  version: T.Optional(T.Literal(1)),
  deployment: T.Optional(
    T.Object({
      // Not format-checked here: this field is server-owned and always
      // overwritten from the tenant row before persistence (SaveConfigUseCase),
      // and no `uuid` format checker is registered with TypeBox in this
      // process — an unregistered `format` keyword fails `Value.Check`
      // outright rather than being ignored, so asserting it here would wrongly
      // reject an otherwise-valid document.
      tenant_id: T.Optional(T.String()),
      name: T.Optional(T.String({ minLength: 1, maxLength: 80 })),
    }),
  ),
  transport: T.Optional(
    T.Object({
      provider: T.Optional(TransportProviderKey),
      credential_ref: T.Optional(CredentialRef),
      room_namespace: T.Optional(T.String({ pattern: '^[a-z][a-z0-9-]{1,47}$' })),
    }),
  ),
  stt: T.Optional(
    T.Object({
      provider: T.Optional(SttProviderKey),
      credential_ref: T.Optional(CredentialRef),
      language: T.Optional(Bcp47),
      model: T.Optional(T.String({ maxLength: 128 })),
    }),
  ),
  // Phase 9 (BL-035): unlike the old scalar `llm` block (whose sub-fields
  // were individually optional to support a dropdown-by-dropdown "nothing
  // selected yet" draft state), `reasoning.graph` has no such partial state
  // to model — `emptyAgentConfig` always ships a complete default
  // single-LLM-node graph (R-G1), so a *present* `reasoning` block is
  // always fully schema-checked; only its total *absence* (a config saved
  // before this phase existed, none in this checkout — see the plan doc's
  // migration note) is tolerated here.
  reasoning: T.Optional(ReasoningSchema),
  tts: T.Optional(
    T.Object({
      provider: T.Optional(TtsProviderKey),
      credential_ref: T.Optional(CredentialRef),
      voice_id: T.Optional(T.String({ minLength: 1, maxLength: 128 })),
    }),
  ),
  avatar: T.Optional(
    T.Object({
      provider: T.Optional(AvatarProviderKey),
      credential_ref: T.Optional(CredentialRef),
      avatar_id: T.Optional(T.String({ minLength: 1, maxLength: 128 })),
    }),
  ),
  agent: T.Optional(
    T.Object({
      runtime: T.Optional(AgentRuntimeKey),
      system_prompt: T.Optional(T.String({ maxLength: 32768 })),
      tools: T.Optional(
        T.Array(
          T.Object({
            name: T.String({ minLength: 1, maxLength: 80 }),
            api_ref: T.String({ minLength: 1, maxLength: 64 }),
            enabled: T.Optional(T.Boolean()),
          }),
        ),
      ),
      memory: T.Optional(
        T.Object({
          enabled: T.Optional(T.Boolean()),
          window_turns: T.Optional(T.Integer({ minimum: 0, maximum: 64 })),
        }),
      ),
    }),
  ),
  // Phase 12b (BL-045/047) — `knowledge.pipeline`, all-optional draft mirror
  // (replaces the removed `agent.rag` block). Unlike `reasoning` (whose
  // *presence* is always fully schema-checked once a graph exists at all —
  // see that field's comment above), `knowledge.pipeline`'s six stages have
  // no such "all or nothing" shape requirement, so every leaf is optional
  // here, same as every other draft-mirrored block in this file.
  knowledge: T.Optional(
    T.Object({
      pipeline: T.Optional(
        T.Object({
          rewrite: T.Optional(
            T.Object({
              enabled: T.Optional(T.Boolean()),
              context_turns: T.Optional(T.Integer({ minimum: 1, maximum: 10 })),
              budget_ms: T.Optional(T.Integer({ minimum: 0, maximum: 10000 })),
            }),
          ),
          hybrid_search: T.Optional(
            T.Object({
              vector_weight: T.Optional(T.Number({ minimum: 0, maximum: 1 })),
              keyword_weight: T.Optional(T.Number({ minimum: 0, maximum: 1 })),
              candidates: T.Optional(T.Integer({ minimum: 1, maximum: 100 })),
              budget_ms: T.Optional(T.Integer({ minimum: 0, maximum: 10000 })),
            }),
          ),
          metadata_filter: T.Optional(
            T.Object({
              enabled: T.Optional(T.Boolean()),
              condition: T.Optional(
                T.Object({
                  field: T.String({ minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_]+$' }),
                  op: T.Union([T.Literal('eq'), T.Literal('neq'), T.Literal('contains')]),
                  value: T.String({ minLength: 1, maxLength: 500 }),
                }),
              ),
              budget_ms: T.Optional(T.Integer({ minimum: 0, maximum: 10000 })),
            }),
          ),
          rerank: T.Optional(
            T.Object({
              enabled: T.Optional(T.Literal(false)),
              keep_top: T.Optional(T.Integer({ minimum: 1, maximum: 50 })),
            }),
          ),
          threshold: T.Optional(
            T.Object({
              min_score: T.Optional(T.Number({ minimum: 0, maximum: 1 })),
              budget_ms: T.Optional(T.Integer({ minimum: 0, maximum: 10000 })),
            }),
          ),
          inject: T.Optional(
            T.Object({
              token_cap: T.Optional(T.Integer({ minimum: 1, maximum: 8000 })),
              citation_format: T.Optional(CitationFormatSchema),
              budget_ms: T.Optional(T.Integer({ minimum: 0, maximum: 10000 })),
            }),
          ),
        }),
      ),
    }),
  ),
  // Phase 13 (BL-049/050/051) — the agent-level "attached" skill list.
  // `SkillRefSchema` itself has no optional leaves to loosen (both `id`/
  // `version` are always required on a present entry — a half-specified
  // skill ref has no meaningful "incomplete" shape the way, say, a
  // not-yet-selected provider does), so the array is optional but each
  // present entry is fully schema-checked, same treatment `agent.tools[]`
  // already gets in this file.
  skills: T.Optional(T.Array(SkillRefSchema)),
  privacy: T.Optional(
    T.Object({
      send_to_remote_llm: T.Optional(ResidencyMode),
      retain_transcripts_days: T.Optional(T.Integer({ minimum: 1, maximum: 730 })),
      recordings_enabled: T.Optional(T.Boolean()),
    }),
  ),
  alerts: T.Optional(
    T.Object({
      degraded_mode_message: T.Optional(T.String({ minLength: 1, maxLength: 500 })),
    }),
  ),
  // Phase 16 (BL-062) — already optional in the canonical schema too (see
  // `dynamics.schema.ts`'s doc comment for why), so this mirror is optional
  // at both the block level and every leaf, same double-optional treatment
  // `privacy`/`alerts` above already get for a draft.
  dynamics: T.Optional(
    T.Object({
      barge_in: T.Optional(
        T.Object({
          enabled: T.Optional(T.Boolean()),
          sensitivity: T.Optional(T.Union([T.Literal('low'), T.Literal('medium'), T.Literal('high')])),
        }),
      ),
      endpointing_silence_ms: T.Optional(T.Integer({ minimum: 100, maximum: 5000 })),
      verbosity: T.Optional(T.Union([T.Literal('concise'), T.Literal('balanced'), T.Literal('detailed')])),
      no_input: T.Optional(
        T.Object({
          timeout_ms: T.Optional(T.Integer({ minimum: 1000, maximum: 60000 })),
          max_reprompts: T.Optional(T.Integer({ minimum: 0, maximum: 5 })),
        }),
      ),
      call_limits: T.Optional(
        T.Object({
          max_turn_tokens: T.Optional(T.Integer({ minimum: 1, maximum: 8000 })),
          max_turn_seconds: T.Optional(T.Integer({ minimum: 1, maximum: 120 })),
        }),
      ),
    }),
  ),
});

/** Top-level keys the schema recognizes — anything else is `CONFIG_YAML_UNKNOWN_KEY`. */
export const AGENT_CONFIG_TOP_LEVEL_KEYS = [
  'version',
  'deployment',
  'transport',
  'stt',
  'reasoning',
  'tts',
  'avatar',
  'agent',
  'knowledge',
  'skills',
  'privacy',
  'alerts',
  'dynamics',
] as const;
