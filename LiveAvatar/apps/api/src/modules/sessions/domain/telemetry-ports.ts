/**
 * Write-path ports for the agent-facing `/internal` telemetry routes
 * (LLD §5.9: utterances/hops/alerts). Owned by `sessions` for this phase
 * (BL-013..017) since it is the only consumer — a dedicated `session-logs`/
 * `dashboard`/`alerts` module may take over the *read* side in Phase 7
 * (BL-020/BL-021/BL-023) once those screens exist; this write path can be
 * re-exported to whichever module needs it then without changing callers.
 */

/** One `TranscriptUtterance` row (FR-CALL-3, FR-SESS-1). */
export interface UtteranceInput {
  seq: number;
  role: 'user' | 'assistant';
  text: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

/** One ordered `TranscriptUtterance` row as read back (FR-SESS-2, FR-CALL-4). */
export interface UtteranceRow {
  seq: number;
  role: 'user' | 'assistant';
  text: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

/** `TranscriptUtterance` persistence — batch upsert on `(session_id, seq)`. */
export interface UtteranceRepositoryPort {
  upsertMany(sessionId: string, tenantId: string, items: UtteranceInput[]): Promise<void>;

  /**
   * Ordered transcript for a session (Screen 5 detail, Screen 11 post-call).
   * Never called when `Session.transcriptPurged` is true — callers must check
   * that flag first (FR-PRIV-3).
   */
  listBySession(sessionId: string): Promise<UtteranceRow[]>;

  /**
   * Full-text search over non-purged transcript text (FR-SESS-1's `q`),
   * scoped to a tenant when given, across all tenants (operator) otherwise.
   * @returns distinct session ids matching `q`
   */
  searchSessionIds(q: string, tenantId?: string): Promise<string[]>;

  /**
   * Hard-deletes transcript text for every session whose tenant's
   * `retain_transcripts_days` has elapsed since `Session.startedAt`
   * (FR-PRIV-3). Idempotent — a session already purged is skipped.
   * @returns number of sessions purged in this run
   */
  purgeExpired(): Promise<number>;
}

export const UTTERANCE_REPOSITORY = Symbol('UTTERANCE_REPOSITORY');

/** One `LatencyHop` row (NFR-1). Phase 9 (BL-039) adds the `node` hop kind + node-trace fields. */
export interface HopInput {
  utteranceSeq: number;
  hop: 'stt' | 'llm' | 'tts' | 'avatar' | 'e2e' | 'node';
  firstPartialMs?: number;
  firstTokenMs?: number;
  firstAudioMs?: number;
  firstFrameMs?: number;
  totalMs?: number;
  providerKey?: string;
  usedFallback?: boolean;
  errorCode?: string;
  /** Always populated by the repository (`''` for non-node hops) — see `PrismaHopRepository`'s docstring. */
  nodeId?: string;
  nodeType?: string;
  lane?: string;
}

/** One `LatencyHop` row as read back, grouped per utterance cycle (FR-SESS-3). */
export interface HopRow {
  utteranceSeq: number;
  hop: 'stt' | 'llm' | 'tts' | 'avatar' | 'e2e' | 'node';
  firstPartialMs: number | null;
  firstTokenMs: number | null;
  firstAudioMs: number | null;
  firstFrameMs: number | null;
  totalMs: number | null;
  providerKey: string | null;
  usedFallback: boolean;
  errorCode: string | null;
  nodeId: string;
  nodeType: string | null;
  lane: string | null;
}

/** `LatencyHop` persistence — batch upsert on `(session_id, utterance_seq, hop, node_id)`. */
export interface HopRepositoryPort {
  upsertMany(sessionId: string, tenantId: string, items: HopInput[]): Promise<void>;

  /** Every hop row for a session, ordered by utterance sequence (FR-SESS-3). */
  listBySession(sessionId: string): Promise<HopRow[]>;

  /**
   * Last-`range` failover counts across a tenant (FR-ALERT-2): primary
   * failures (every attempt that triggered failover logic), fallback
   * successes (`used_fallback=true`, no error), and degraded invocations
   * (both primary and fallback exhausted, `error_code` set). Derived from
   * `hop='llm'` rows rather than a separate counter table — the LLD does not
   * define one, and every fact needed is already recorded on `LatencyHop` by
   * `agent/orchestration/failover.py` (LLD §8.4).
   */
  countLlmFailoverStats(
    tenantId: string,
    since: Date,
  ): Promise<{ primaryFailures: number; fallbackSuccesses: number; degradedInvocations: number }>;
}

export const HOP_REPOSITORY = Symbol('HOP_REPOSITORY');

/** `AlertEvent.type` (FR-ALERT-1..3). */
export type AlertKind = 'llm_failover' | 'provider_unreachable' | 'session_failed' | 'gpu_unhealthy' | 'handoff_requested';

/** One `AlertEvent` row as read back (Screen 7). */
export interface AlertEventRow {
  id: string;
  type: AlertKind;
  message: string;
  createdAt: Date;
}

/** `AlertEvent` persistence (FR-ALERT-*). */
export interface AlertRepositoryPort {
  create(input: { tenantId: string; type: AlertKind; message: string }): Promise<void>;

  /** Last-`range` in-app alert list (FR-ALERT-4), newest first. */
  list(input: {
    tenantId?: string;
    type?: AlertKind;
    from: Date;
    to: Date;
    page: number;
    pageSize: number;
  }): Promise<{ items: AlertEventRow[]; total: number }>;
}

export const ALERT_REPOSITORY = Symbol('ALERT_REPOSITORY');

/** `Feedback` persistence (FR-CALL-4). One row per session (unique `session_id`). */
export interface FeedbackRepositoryPort {
  /** @returns `'created'` normally, `'duplicate'` when feedback already exists for this session */
  create(input: {
    sessionId: string;
    tenantId: string;
    rating: number;
    comment: string | null;
  }): Promise<'created' | 'duplicate'>;

  existsForSession(sessionId: string): Promise<boolean>;
}

export const FEEDBACK_REPOSITORY = Symbol('FEEDBACK_REPOSITORY');
