/** BullMQ queue name for the provider health probe job (LLD §8.7/§8.8). */
export const PROVIDER_PROBE_QUEUE = 'provider-probe';

/** Repeat interval for the provider-probe job — 2 minutes (LLD §8.7). */
export const PROVIDER_PROBE_INTERVAL_MS = 2 * 60 * 1000;

/** BullMQ queue name for the session-abandonment sweep (LLD §8.8, FR-AUTH-4). */
export const SESSION_SWEEPER_QUEUE = 'session-sweeper';

/** Repeat interval for the session-sweeper job — 1 minute (LLD §8.8). */
export const SESSION_SWEEPER_INTERVAL_MS = 60 * 1000;

/** BullMQ queue name for the daily transcript retention purge (LLD §8.8, FR-PRIV-3). */
export const TRANSCRIPT_PURGE_QUEUE = 'transcript-purge';

/** Repeat interval for the transcript-purge job — 24 hours (LLD §8.8, "daily"). */
export const TRANSCRIPT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * BullMQ queue name for RAG ingestion (Phase 12a, BL-044/046) — re-exported
 * from the `knowledge` module's barrel (owned there, not here) so this file
 * stays the one place every queue name is importable from without creating
 * a `knowledge` -> `jobs` dependency edge (`JobsModule` depends on domain
 * modules, never the reverse; see `knowledge/domain/ports.ts`'s doc comment
 * on this constant for the full rationale). Unlike the three queues above,
 * this one is not a repeating/self-scheduled job: it is triggered on demand
 * by `KnowledgeIngestQueuePort.enqueue(...)` whenever a source is created or
 * a re-index is confirmed, so no interval constant exists for it and
 * `JobsModule.onModuleInit` must not self-schedule it.
 */
export { KNOWLEDGE_INGEST_QUEUE } from '../../knowledge';

/**
 * BullMQ queue name for the HITL SLA sweep (Phase 14, BL-053) —
 * server-side defense-in-depth for a gate's `slaSeconds` deadline, alongside
 * (not instead of) the Python interpreter's own locally-tracked deadline
 * (`ARCHITECTURE_NOTES.md` §6.2 point 3). Self-scheduled like
 * `SESSION_SWEEPER_QUEUE`/`TRANSCRIPT_PURGE_QUEUE` above — owned directly
 * here since, unlike `KNOWLEDGE_INGEST_QUEUE`/`HITL_DEFERRED_FOLLOWUP_QUEUE`,
 * nothing outside `JobsModule` ever enqueues onto it.
 */
export const HITL_SLA_SWEEP_QUEUE = 'hitl-sla-sweep';

/** Repeat interval for the HITL SLA sweep — 15 seconds (tight enough that a gate's own `slaSeconds`, minimum 1s, is never left pending for long after expiring). */
export const HITL_SLA_SWEEP_INTERVAL_MS = 15 * 1000;

/**
 * BullMQ queue name for the deferred-approval out-of-band tool execution
 * (Phase 14, BL-056) — re-exported from the `hitl` module's barrel (owned
 * there, not here), same "producer lives with its domain module" precedent
 * `KNOWLEDGE_INGEST_QUEUE` already sets. Not self-scheduled — jobs arrive
 * only via `HitlDeferredFollowupQueuePort.enqueue(...)` when a `deferred`
 * gate's decision resolves to `approved`/`edited_approved`.
 */
export { HITL_DEFERRED_FOLLOWUP_QUEUE } from '../../hitl';
