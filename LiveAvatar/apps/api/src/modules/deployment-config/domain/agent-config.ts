import { parse as parseYamlDoc, stringify as stringifyYamlDoc, YAMLParseError } from 'yaml';
import type { AgentConfig, CitationFormat, GraphNode, Reasoning } from '@liveavatar/contracts';

/**
 * Loosely-typed working representation of a config while it may still be
 * incomplete (draft) — every branch is optional. Narrowed to `AgentConfig`
 * only once Gate B confirms every required layer is present (FR-CONFIG-3
 * publish path).
 */
export type PartialAgentConfig = {
  version?: number;
  deployment?: { tenant_id?: string; name?: string };
  transport?: { provider?: string; credential_ref?: string; room_namespace?: string };
  stt?: { provider?: string; credential_ref?: string; language?: string; model?: string };
  /** Phase 9 (BL-035) — replaces the old flat `llm:` block (`ARCHITECTURE_NOTES.md` §1). */
  reasoning?: Reasoning;
  tts?: { provider?: string; credential_ref?: string; voice_id?: string };
  avatar?: { provider?: string; credential_ref?: string; avatar_id?: string };
  agent?: {
    runtime?: string;
    system_prompt?: string;
    tools?: { name: string; api_ref: string; enabled?: boolean }[];
    memory?: { enabled?: boolean; window_turns?: number };
  };
  /** Phase 12b (BL-045/047) — replaces the removed `agent.rag` flag+free-text pair. */
  knowledge?: {
    pipeline?: {
      rewrite?: { enabled?: boolean; context_turns?: number; budget_ms?: number };
      hybrid_search?: { vector_weight?: number; keyword_weight?: number; candidates?: number; budget_ms?: number };
      metadata_filter?: {
        enabled?: boolean;
        condition?: { field: string; op: 'eq' | 'neq' | 'contains'; value: string };
        budget_ms?: number;
      };
      rerank?: { enabled?: false; keep_top?: number };
      threshold?: { min_score?: number; budget_ms?: number };
      inject?: { token_cap?: number; citation_format?: CitationFormat; budget_ms?: number };
    };
  };
  /** Phase 13 (BL-049/050/051) — the agent-level "attached" skill list (top-level analog of `agent.tools[]`). */
  skills?: { id: string; version: number | 'latest' }[];
  privacy?: { send_to_remote_llm?: string; retain_transcripts_days?: number; recordings_enabled?: boolean };
  alerts?: { degraded_mode_message?: string };
  /** Phase 16 (BL-062) — optional even once published (see `dynamics.schema.ts`'s doc comment for why). */
  dynamics?: {
    barge_in?: { enabled?: boolean; sensitivity?: 'low' | 'medium' | 'high' };
    endpointing_silence_ms?: number;
    verbosity?: 'concise' | 'balanced' | 'detailed';
    no_input?: { timeout_ms?: number; max_reprompts?: number };
    call_limits?: { max_turn_tokens?: number; max_turn_seconds?: number };
  };
};

/**
 * Parses YAML text into a plain JS value using the strict, safe schema
 * (no custom tags — ADR-001 "no unsafe loader"). Distinct from
 * `YAMLParseError` so the use case can map it to `CONFIG_YAML_PARSE` with
 * the parser's own reason text in the message (spec FR-CONFIG-2).
 * @param yamlText - Raw YAML document
 */
export function parseAgentConfigYaml(yamlText: string): unknown {
  try {
    return parseYamlDoc(yamlText, { strict: true }) ?? {};
  } catch (err) {
    const reason = err instanceof YAMLParseError ? err.message : 'invalid document';
    throw new AgentConfigParseError(reason);
  }
}

/** Thrown when YAML text cannot be parsed at all (`CONFIG_YAML_PARSE`). */
export class AgentConfigParseError extends Error {
  constructor(public readonly reason: string) {
    super(`YAML could not be parsed: ${reason}.`);
  }
}

/**
 * Canonical serialization used both for the redacted preview (FR-CONFIG-4)
 * and for the value persisted on publish (LLD §8.2 "regenerated canonically
 * from the structured form so hand-edited YAML is normalized"). Only ever
 * receives an already-validated structured object — it cannot itself
 * introduce a secret since the object's leaves are schema-constrained to
 * `credential_ref` fields, never raw secret values.
 * @param config - Structured config to serialize
 */
export function stringifyAgentConfig(config: AgentConfig | PartialAgentConfig): string {
  return stringifyYamlDoc(config, { indent: 2 });
}

/**
 * Builds the placeholder config for a brand-new tenant (FR-CONFIG-1's "New
 * tenant shows all dropdowns on placeholder Select…" state) — every
 * selectable field absent, defaults filled in for the few fields that have
 * one in the canonical schema (language, retry policy, memory window).
 * @param tenantId - Owning tenant
 * @param tenantSlug - Used as `room_namespace` (server-owned, FR-CONFIG-2)
 * @param tenantName - Used as `deployment.name` default
 */
export function emptyAgentConfig(tenantId: string, tenantSlug: string, tenantName: string): PartialAgentConfig {
  return {
    version: 1,
    deployment: { tenant_id: tenantId, name: tenantName },
    transport: { provider: 'livekit', room_namespace: tenantSlug },
    stt: { language: 'en-US' },
    // No `reasoning` block yet — mirrors the pre-Phase-9 placeholder exactly
    // (the old `llm` block had no `primary` set either, only a defaulted
    // `retry`): a brand-new tenant has chosen no LLM provider, so there is
    // no valid single-LLM-node graph to default to yet. `completenessRule`
    // reports this as an incomplete `reasoning.llm` layer, same as it
    // reported `llm.primary` before this phase.
    agent: {
      system_prompt: '',
      tools: [],
      memory: { enabled: true, window_turns: 16 },
    },
    // Phase 12b (BL-045/047) — seeded explicitly, same "placeholder always
    // ships every required top-level block's defaults" convention `memory`/
    // `alerts` already follow (no TypeBox-level `default: {}` on `knowledge`
    // itself — see the plan doc's "Decisions made this phase" for why this
    // mirrors that existing precedent rather than relying on auto-defaulting
    // a wholly-absent key).
    knowledge: {
      pipeline: {
        rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
        hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
        metadata_filter: { enabled: false, budget_ms: 20 },
        rerank: { enabled: false },
        threshold: { min_score: 0.5, budget_ms: 10 },
        inject: { token_cap: 1200, citation_format: 'numbered', budget_ms: 30 },
      },
    },
    // Phase 13 (BL-049/050/051) — seeded explicitly, same "placeholder
    // always ships every required top-level block's defaults" convention
    // `agent.tools`/`knowledge` already follow.
    skills: [],
    privacy: { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: false },
    alerts: { degraded_mode_message: "I'm having trouble reaching the language service. Please wait a moment and try again." },
  };
}

/**
 * Every `llm`-type node in `reasoning.graph` — the Phase 9 replacement for
 * reading `config.llm.primary`/`config.llm.fallback` directly. Used by
 * `combination-rules.ts` (provider/credential/residency checks) and
 * `SaveConfigUseCase` (denormalized provider columns).
 * @param reasoning - `config.reasoning`, possibly absent (brand-new tenant)
 */
export function findLlmNodes(reasoning: Reasoning | undefined): Extract<GraphNode, { type: 'llm' }>[] {
  if (!reasoning?.graph) {
    return [];
  }
  return reasoning.graph.filter((n): n is Extract<GraphNode, { type: 'llm' }> => n.type === 'llm');
}

/**
 * Builds a minimal, valid single-LLM-node graph (R-G1's default shape) —
 * used by fixtures/tests and any future "reset to default" UI action, not
 * by `emptyAgentConfig` (a brand-new tenant has no provider chosen yet, see
 * above).
 * @param leg - Primary (and optional fallback) LLM provider/model
 */
export function buildSingleLlmNodeGraph(leg: {
  provider: string;
  credential_ref?: string;
  model: string;
  fallback?: { provider: string; credential_ref?: string; model: string };
}): Reasoning {
  return {
    entry_node_id: 'llm-1',
    background_entry_node_ids: [],
    turn_budget_ms: 3000,
    graph: [
      {
        id: 'llm-1',
        type: 'llm',
        name: 'Answer',
        lane: 'foreground',
        on_error: { action: 'degrade' },
        on_deadline: { action: 'degrade' },
        provider: leg.provider,
        credential_ref: leg.credential_ref,
        model: leg.model,
        fallback: leg.fallback,
        retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
        next_node_id: null,
      },
    ],
  } as Reasoning;
}
