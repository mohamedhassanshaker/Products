import type { TenantContext } from "@nextbot/db";
import { getCollectionOrThrow } from "../infrastructure/collection-repository.js";
import { listCoverageGapsForCollection } from "../infrastructure/retrieval-event-repository.js";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the Coverage
 * sub-requirement: "a coverage report surfaces production questions that retrieved
 * nothing above a relevance threshold, feeding the content backlog from real
 * demand (parallels the existing FR-RP-03 gap-analysis pattern)."
 *
 * Reads directly from `retrieval_event` — real, already-written rows from every
 * live retrieval the bounded retrieval agent has performed since Phase 10 (win or
 * refuse alike); this phase adds no new write path, only this read/report surface.
 */
export interface CoverageReportQuery {
  /** Defaults to 30 days — a coverage report is about RECENT production demand, not
   *  the collection's entire lifetime history. */
  sinceDays?: number;
  limit?: number;
}

export interface CoverageReportItem {
  queryTextHash: string;
  sampleQueryTextMasked: string | null;
  occurrences: number;
  refusedCount: number;
  maxTopScore: number | null;
  lastSeenAt: string;
}

export interface CoverageReportResult {
  collectionId: string;
  minRelevanceScore: number;
  sinceDate: string;
  items: CoverageReportItem[];
}

const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function getCoverageReport(ctx: TenantContext, collectionId: string, query: CoverageReportQuery = {}): Promise<CoverageReportResult> {
  const collection = await getCollectionOrThrow(ctx, collectionId);
  const sinceDays = query.sinceDays && query.sinceDays > 0 ? query.sinceDays : DEFAULT_SINCE_DAYS;
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const gaps = await listCoverageGapsForCollection(ctx, collectionId, collection.minRelevanceScore, sinceDate);

  return {
    collectionId,
    minRelevanceScore: collection.minRelevanceScore,
    sinceDate: sinceDate.toISOString(),
    items: gaps.slice(0, limit).map((g) => ({
      queryTextHash: g.queryTextHash,
      sampleQueryTextMasked: g.sampleQueryTextMasked,
      occurrences: g.occurrences,
      refusedCount: g.refusedCount,
      maxTopScore: g.maxTopScore,
      // `listCoverageGapsForCollection`'s `max(created_at)` is a raw, driver-level
      // `db.execute()` result — unlike a named-column `select()`, the node-postgres
      // driver does not always return this as a parsed `Date` instance (confirmed
      // against a real Postgres instance while implementing this), so this
      // normalizes explicitly rather than assuming the shape.
      lastSeenAt: new Date(g.lastSeenAt).toISOString(),
    })),
  };
}
