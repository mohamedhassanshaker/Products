/**
 * Pure, framework-free hybrid-search/reranking/relevance-floor math (migration plan Phase 5) —
 * ported verbatim from `legacy/api/src/ai/domain/hybrid-rerank.ts`. No I/O, no framework import here
 * — `RetrievalService` (the only caller) owns every network call (embedding,
 * `VectorStorePort.searchChunks`/`scrollChunks`); this file only combines/reorders/filters data it is
 * handed.
 *
 * The "reranking" and "hybrid search" halves are implemented as one integrated re-scoring step: a
 * candidate's final score is a weighted fusion of its dense (cosine) similarity and a lexical
 * (keyword-overlap) similarity, and candidates are re-sorted by that fused score — genuine
 * post-retrieval reordering using a more precise-for-exact-terms, locally-computed signal that
 * Qdrant's own dense-only `query` never sees.
 */

/** A candidate chunk being fused/reranked — the minimal shape `RetrievalService` needs to supply. */
export interface RerankCandidate {
  /** Point id — used only to de-duplicate/merge dense-search and lexical-scroll candidate sets
   * before this module ever sees them; opaque here. */
  id: string;
  /** Dense cosine similarity, `[0,1]` in practice for normalized embeddings (from Qdrant's own
   * `score` when the candidate came from `searchChunks`, or a locally computed
   * {@link cosineSimilarity} when it was only found via the lexical scroll pool). */
  denseScore: number;
  /** The chunk's own text — scored lexically against the query terms below. */
  text: string;
  /** Opaque payload carried through untouched so the caller can still build its own output shape
   * from whichever candidate survives filtering. */
  payload: Record<string, unknown>;
}

export interface RerankedResult {
  denseScore: number;
  lexicalScore: number;
  /** The fused score reranking sorted by and the relevance floor is compared against. */
  fusedScore: number;
  text: string;
  payload: Record<string, unknown>;
}

/** Cosine similarity between two equal-length vectors. Returns `0` for a zero-magnitude vector
 * (rather than `NaN`/dividing by zero) — a defensive guard, since a genuinely all-zero embedding
 * should never rank above anything, not crash the reranker. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Lowercases, strips punctuation, and splits `text` into non-empty word tokens. A minimal English
 * stopword list is dropped so the lexical channel rewards genuinely distinctive shared terms rather
 * than being dominated by near-universal function words. */
export function tokenize(text: string): string[] {
  const stopwords = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'to', 'and', 'or', 'is', 'are', 'for', 'with', 'that',
    'this', 'it', 'as', 'by', 'be', 'was', 'were', 'at', 'from', 'into', 'their', 'its',
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !stopwords.has(token));
}

/**
 * Normalized keyword-overlap score in `[0,1]` between `queryTerms` (already tokenized once per call
 * by `RetrievalService`, not re-tokenized per candidate) and `text`.
 *
 * Blends two signals evenly: what *fraction* of the distinct query terms appear anywhere in the text
 * (coverage — rewards a chunk matching more of a multi-term query), and a term-frequency bonus capped
 * at 1 match per term (so one query term repeated 50 times in a chunk cannot alone dominate the
 * score) — deliberately simple (not real BM25's IDF/length-normalization), a bounded in-process
 * scorer, not a real index.
 */
export function lexicalScore(queryTerms: string[], text: string): number {
  if (queryTerms.length === 0) return 0;
  const textTerms = tokenize(text);
  if (textTerms.length === 0) return 0;

  const textTermCounts = new Map<string, number>();
  for (const term of textTerms) {
    textTermCounts.set(term, (textTermCounts.get(term) ?? 0) + 1);
  }

  const uniqueQueryTerms = new Set(queryTerms);
  let matchedTerms = 0;
  let frequencyBonus = 0;
  for (const term of uniqueQueryTerms) {
    const count = textTermCounts.get(term) ?? 0;
    if (count > 0) {
      matchedTerms += 1;
      // Diminishing-returns bonus per repeated occurrence, capped well below 1 full extra match.
      frequencyBonus += Math.min(0.5, (count - 1) * 0.1);
    }
  }
  if (matchedTerms === 0) return 0;

  const coverage = matchedTerms / uniqueQueryTerms.size;
  const normalizedFrequencyBonus = Math.min(1, frequencyBonus / uniqueQueryTerms.size);
  // 80% coverage / 20% frequency-bonus split — coverage (matching more distinct query terms) is the
  // dominant signal; the frequency bonus only nudges the score among candidates with equal coverage.
  return Math.min(1, coverage * 0.8 + normalizedFrequencyBonus * 0.2);
}

/** Weighted fusion of the dense and lexical channels — `lexicalWeight` in `[0,1]`, dense gets the
 * remainder. Both inputs are expected already-clamped to `[0,1]`; this function does not re-clamp. */
export function fuseScore(denseScore: number, lexicalScoreValue: number, lexicalWeight: number): number {
  return (1 - lexicalWeight) * denseScore + lexicalWeight * lexicalScoreValue;
}

export interface RerankOptions {
  /** Raw query text — tokenized once here, not by the caller, so every candidate shares the exact
   * same term set. */
  queryText: string;
  lexicalWeight: number;
  relevanceFloor: number;
  topK: number;
}

/**
 * The one entry point `RetrievalService` calls: fuses each candidate's dense + lexical score, sorts
 * descending by the fused score (the "reranking" half), drops anything at or below `relevanceFloor`
 * (the "relevance floor" half), and returns at most `topK` results.
 *
 * Candidates are expected already de-duplicated by id (merging is the caller's job — this module has
 * no concept of a point id beyond what {@link RerankCandidate} carries, and does not need one).
 */
export function rerankFuseAndFilter(candidates: RerankCandidate[], options: RerankOptions): RerankedResult[] {
  const queryTerms = tokenize(options.queryText);

  const scored = candidates.map((candidate) => {
    const lex = lexicalScore(queryTerms, candidate.text);
    const fused = fuseScore(candidate.denseScore, lex, options.lexicalWeight);
    return { denseScore: candidate.denseScore, lexicalScore: lex, fusedScore: fused, text: candidate.text, payload: candidate.payload };
  });

  return scored
    .filter((result) => result.fusedScore > options.relevanceFloor)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, options.topK);
}
