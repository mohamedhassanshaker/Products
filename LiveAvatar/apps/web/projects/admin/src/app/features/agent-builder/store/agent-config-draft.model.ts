import type { Dynamics, Reasoning } from '@liveavatar/contracts';

/**
 * Client-side mirror of the API's `PartialAgentConfig` (every branch
 * optional while the draft may be incomplete — spec FR-CONFIG-1's "New
 * tenant shows all dropdowns on placeholder Select…" state). Not exported
 * from `packages/contracts`: the wire contract only ever carries `yaml_text`
 * or the fully-strict structured `config` (FR-CONFIG-3); this shape exists
 * purely to give the Angular form/store something concrete to bind to while
 * editing (LLD §9.1 `AgentBuilderStore`).
 *
 * Phase 9 (BL-035): the flat `llm:` block is gone from the wire contract,
 * replaced by `reasoning: ReasoningSchema` (a node graph). This page no
 * longer edits it directly — the full editing surface lives in the
 * Reasoning tab (`features/reasoning/`, its own route+store, same reason
 * Tools got its own feature in Phase 8: ESLint feature-isolation forbids
 * this feature reaching into that one). `reasoning` is kept here, typed
 * against the real contract, only so this page can show a read-only
 * "N nodes" summary link, mirroring how `agent.tools` is kept here for the
 * "N tools enabled" link.
 */
export interface AgentConfigDraft {
  version?: number;
  deployment?: { tenant_id?: string; name?: string };
  transport?: { provider?: string; credential_ref?: string; room_namespace?: string };
  stt?: { provider?: string; credential_ref?: string; language?: string; model?: string };
  reasoning?: Reasoning;
  tts?: { provider?: string; credential_ref?: string; voice_id?: string };
  avatar?: { provider?: string; credential_ref?: string; avatar_id?: string };
  agent?: {
    runtime?: string;
    system_prompt?: string;
    tools?: { name: string; api_ref: string; enabled?: boolean }[];
    memory?: { enabled?: boolean; window_turns?: number };
    rag?: { enabled?: boolean; index_ref?: string };
  };
  privacy?: { send_to_remote_llm?: string; retain_transcripts_days?: number; recordings_enabled?: boolean };
  alerts?: { degraded_mode_message?: string };
  /**
   * Phase 16 (BL-062) — optional at the wire level (a config that predates
   * this phase, or that an admin has never opened the Dynamics tab on, may
   * have no `dynamics` key at all — see `dynamics.schema.ts`'s doc comment).
   * `DynamicsTabComponent` shows `DYNAMICS_DEFAULTS` (this file) when this is
   * `undefined` and writes a fully-populated object back on the first field
   * edit, rather than persisting a partial one.
   */
  dynamics?: Dynamics;
}

/**
 * Schema-default `dynamics` values (mirrors each field's `default:` in
 * `packages/contracts/src/agent-config/dynamics.schema.ts` exactly — kept
 * here, not imported, because TypeBox's `default:` option is a JSON Schema
 * annotation the client never reads back out of the schema object itself).
 */
export function defaultDynamics(): Dynamics {
  return {
    barge_in: { enabled: true, sensitivity: 'medium' },
    endpointing_silence_ms: 700,
    verbosity: 'balanced',
    no_input: { timeout_ms: 8000, max_reprompts: 2 },
    call_limits: { max_turn_tokens: 200, max_turn_seconds: 20 },
  };
}

/** Empty draft — every dropdown/field unset (new-tenant placeholder state). */
export function emptyDraft(): AgentConfigDraft {
  return {
    version: 1,
    transport: { provider: 'livekit' },
    agent: { tools: [] },
  };
}
