/** `Session.status` (FR-TRANSPORT-4). */
export type SessionStatus = 'pending' | 'active' | 'ended' | 'failed' | 'abandoned' | 'degraded';

/** Denormalized provider-stack snapshot taken at session start. */
export interface ProviderStackSnapshot {
  transport: string | null;
  stt: string | null;
  llm: string | null;
  llmFallback: string | null;
  tts: string | null;
  avatar: string | null;
}

/** Residency snapshot taken at session start (FR-PRIV-2 — never a live read mid-session). */
export interface ResidencySnapshot {
  sendToRemoteLlm: 'prompt_text_only' | 'prompt_and_transcript' | 'none';
  retainTranscriptsDays: number;
  recordingsEnabled: boolean;
}

/** `Session.summaryStatus` (FR-CALL-4). */
export type SummaryStatus = 'none' | 'pending' | 'ready' | 'unavailable';

/** Session aggregate as the application layer sees it. */
export interface SessionRecord {
  id: string;
  tenantId: string;
  roomName: string;
  status: SessionStatus;
  errorCode: string | null;
  providerStack: ProviderStackSnapshot;
  residencySnapshot: ResidencySnapshot;
  displayName: string | null;
  tabKey: string | null;
  maxDurationSeconds: number;
  startedAt: Date;
  joinedAt: Date | null;
  endedAt: Date | null;
  summaryTokenHash: string | null;
  summaryTokenExpiresAt: Date | null;
  /** FR-CALL-4 — the agent's generated post-call summary (only writer: the agent). */
  summaryText: string | null;
  summaryStatus: SummaryStatus;
  /** FR-PRIV-3 — set true once the daily retention job has hard-deleted transcript text. */
  transcriptPurged: boolean;
  /** FR-SESS-2 — v1 default false; the recording pipeline itself is a P2 non-goal (BL-031). */
  recordingPresent: boolean;
}
