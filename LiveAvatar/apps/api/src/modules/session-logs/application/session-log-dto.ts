import type { HopCycleDto, SessionDetailDto, SessionListItemDto, TranscriptItemDto } from '@liveavatar/contracts';
import type { HopRow, ProviderStackSnapshot, UtteranceRow } from '../../sessions';
import type { SessionDetailRow, SessionSummaryRow } from '../domain/ports';

/** Maps the denormalized snapshot to its wire shape (shared list/detail). */
function toProviderStackDto(stack: ProviderStackSnapshot) {
  return {
    transport: stack.transport,
    stt: stack.stt,
    llm: stack.llm,
    llm_fallback: stack.llmFallback,
    tts: stack.tts,
    avatar: stack.avatar,
  };
}

/** @param row - Read-side session summary row */
export function toSessionListItemDto(row: SessionSummaryRow): SessionListItemDto {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    tenant_slug: row.tenantSlug,
    started_at: row.startedAt.toISOString(),
    duration_ms: row.endedAt ? row.endedAt.getTime() - row.startedAt.getTime() : null,
    status: row.status,
    provider_stack: toProviderStackDto(row.providerStack),
    error_code: row.errorCode,
    transcript_purged: row.transcriptPurged,
  };
}

/**
 * @param row - Read-side session detail row
 * @param participantIdentities - Derived deterministically from the session
 * id (LiveKit itself doesn't persist a separate participants table — see
 * `GetSessionUseCase`'s docstring for why these two identities are correct).
 */
export function toSessionDetailDto(row: SessionDetailRow, participantIdentities: string[]): SessionDetailDto {
  return {
    ...toSessionListItemDto(row),
    room_name: row.roomName,
    participant_identities: participantIdentities,
    recording_present: row.recordingPresent,
    residency_snapshot: {
      send_to_remote_llm: row.residencySnapshot.sendToRemoteLlm,
      retain_transcripts_days: row.residencySnapshot.retainTranscriptsDays,
      recordings_enabled: row.residencySnapshot.recordingsEnabled,
    },
    summary_status: row.summaryStatus,
  };
}

/** @param row - Read-side utterance row */
export function toTranscriptItemDto(row: UtteranceRow): TranscriptItemDto {
  return {
    seq: row.seq,
    role: row.role,
    text: row.text,
    started_at: row.startedAt.toISOString(),
    ended_at: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

/**
 * Groups flat hop rows into per-utterance cycles (FR-SESS-3). A hop that
 * never fired for a given utterance (e.g. TTS skipped, avatar not
 * configured) is simply absent from the cycle object — never zero-filled,
 * exactly as the spec requires.
 * @param rows - Every `LatencyHop` row for a session, any order
 */
export function toHopCycles(rows: HopRow[]): HopCycleDto[] {
  const bySeq = new Map<number, HopCycleDto>();
  for (const row of rows) {
    const cycle = bySeq.get(row.utteranceSeq) ?? { utterance_seq: row.utteranceSeq, nodes: [] };
    if (row.hop === 'node') {
      // Phase 9 (BL-039): many node rows can exist per utterance — collect
      // into `nodes[]` rather than overwriting a single keyed field, unlike
      // every other hop kind (at most one row per utterance).
      cycle.nodes.push({
        node_id: row.nodeId,
        node_type: row.nodeType ?? undefined,
        lane: row.lane ?? undefined,
        total_ms: row.totalMs ?? undefined,
        provider_key: row.providerKey ?? undefined,
        used_fallback: row.usedFallback,
        first_token_ms: row.firstTokenMs ?? undefined,
        error_code: row.errorCode ?? undefined,
      });
    } else {
      cycle[row.hop] = {
        first_partial_ms: row.firstPartialMs ?? undefined,
        first_token_ms: row.firstTokenMs ?? undefined,
        first_audio_ms: row.firstAudioMs ?? undefined,
        first_frame_ms: row.firstFrameMs ?? undefined,
        total_ms: row.totalMs ?? undefined,
        provider_key: row.providerKey ?? undefined,
        used_fallback: row.usedFallback,
        error_code: row.errorCode ?? undefined,
      };
    }
    bySeq.set(row.utteranceSeq, cycle);
  }
  return [...bySeq.values()].sort((a, b) => a.utterance_seq - b.utterance_seq);
}
