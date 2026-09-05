import type { ProviderStackSnapshot, ResidencySnapshot, SessionRecord, SessionStatus } from './session';

/** Session persistence (FR-TRANSPORT-4). */
export interface SessionRepositoryPort {
  create(input: {
    id: string;
    tenantId: string;
    roomName: string;
    providerStack: ProviderStackSnapshot;
    residencySnapshot: ResidencySnapshot;
    displayName: string;
    tabKey: string | null;
    maxDurationSeconds: number;
  }): Promise<SessionRecord>;

  /** Id-only lookup (public/internal callers do not know the tenant ahead of time). */
  findById(id: string): Promise<SessionRecord | null>;

  /** `Session.roomName` is globally unique (LLD §4.1), used by the LiveKit webhook. */
  findByRoomName(roomName: string): Promise<SessionRecord | null>;

  /** FR-AUTH-4 tab-key idempotency: the caller's previous unjoined session, if any. */
  findPendingByTabKey(tenantId: string, tabKey: string): Promise<SessionRecord | null>;

  /**
   * Applies a status transition. Returns `null` when the session no longer
   * exists; the caller (application layer) is responsible for treating an
   * illegal transition (per `nextStatus`) as an idempotent no-op rather than
   * calling this at all.
   */
  applyStatus(
    id: string,
    patch: { status: SessionStatus; joinedAt?: Date; endedAt?: Date; errorCode?: string | null },
  ): Promise<SessionRecord | null>;

  /** Stores the one-way hash of a freshly minted post-call summary token (FR-CALL-4). */
  setSummaryToken(id: string, tokenHash: string, expiresAt: Date): Promise<void>;

  /**
   * Writes the agent-generated post-call summary (FR-CALL-4). The agent is
   * the only writer of this field (HLD §7.3) — reached via
   * `POST /internal/sessions/{id}/summary`.
   */
  setSummary(id: string, status: 'ready' | 'unavailable', text: string | null): Promise<void>;

  /** `pending` sessions started before `olderThan` — the 15-minute abandonment sweep. */
  listAbandonable(olderThan: Date): Promise<SessionRecord[]>;

  /**
   * `active` sessions that have actually joined (`joinedAt` set) — the
   * candidate pool for LLD §8.8's "`active` past `max_duration` → `ended`"
   * sweep half. Each row carries its own `maxDurationSeconds`, so the
   * per-session expiry comparison is done by the use case, not here.
   */
  listActiveJoined(): Promise<SessionRecord[]>;
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

/**
 * Read-only residency-policy snapshot source (FR-PRIV-2). Reads the
 * `data_residency_policy` table directly rather than importing a `residency`
 * module (which doesn't exist until Phase 7/BL-024) — the same shared-table
 * read pattern `providers/infrastructure/prisma-published-config-lookup.ts`
 * already established in Phase 2.
 */
export interface ResidencySnapshotReaderPort {
  read(tenantId: string): Promise<ResidencySnapshot>;
}

export const RESIDENCY_SNAPSHOT_READER = Symbol('RESIDENCY_SNAPSHOT_READER');
