import type { ProviderStackSnapshot, ResidencySnapshot, SessionStatus, SummaryStatus } from '../../sessions';

/** One `GET /sessions` list row as the application layer sees it (FR-SESS-1). */
export interface SessionSummaryRow {
  id: string;
  tenantId: string;
  tenantSlug: string;
  startedAt: Date;
  endedAt: Date | null;
  status: SessionStatus;
  providerStack: ProviderStackSnapshot;
  errorCode: string | null;
  transcriptPurged: boolean;
}

/** `GET /sessions/{id}` detail row, extending the list row (FR-SESS-2). */
export interface SessionDetailRow extends SessionSummaryRow {
  roomName: string;
  residencySnapshot: ResidencySnapshot;
  recordingPresent: boolean;
  summaryStatus: SummaryStatus;
  displayName: string | null;
}

/**
 * Read-only session search/lookup for the admin Session Logs screen
 * (FR-SESS-1/2). Deliberately separate from `SessionRepositoryPort`
 * (`sessions` module owns the write-path lifecycle only) — the same
 * write/read split the telemetry ports docstring already established for
 * utterances/hops/alerts.
 */
export interface SessionSearchRepositoryPort {
  search(input: {
    /** `null` = no tenant filter (operator, no `tenant_id` given). `[]` = guaranteed-empty result. */
    tenantIds: string[] | null;
    sessionIds?: string[];
    from?: Date;
    to?: Date;
    status?: SessionStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: SessionSummaryRow[]; total: number }>;

  /** `null` when the session does not exist at all (never filtered by tenant — the use case checks access). */
  findDetail(id: string): Promise<SessionDetailRow | null>;
}

export const SESSION_SEARCH_REPOSITORY = Symbol('SESSION_SEARCH_REPOSITORY');
