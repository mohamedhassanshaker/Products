# AI & RAG Architecture in ExamLand

This document explains how ExamLand's AI features actually work end-to-end — embeddings, the
vector store, retrieval-augmented generation (RAG), and every LLM-driven pipeline — and then lays
out concrete ways each piece could be made better. It reflects the current implementation in
`nodejs_backend/src`, not the original spec's aspirational description.

---

## 1. The building blocks

Three primitives sit underneath every AI feature in this app:

### 1.1 Embeddings — `src/infra/embeddings/openAiEmbeddings.ts`
Text → vector conversion via OpenAI's `text-embedding-3-small` (1536 dimensions). Two entry points:
`embedText(text)` for one string, `embedTexts(texts[])` for a batch (chunked into groups of 100,
results re-ordered to match input order since the API doesn't guarantee it back).

### 1.2 Vector store — Qdrant, via `src/infra/vector/qdrantClient.ts`
A thin REST wrapper (Qdrant's REST API on port 6333, not gRPC) with four operations:
- `ensureCollection(name, vectorSize)` — idempotent create-if-missing, called once per process.
- `upsertPoints(collection, points)` — each point is `{ id, vector, payload }`.
- `search(collection, vector, limit, filterKey?, filterValue?)` — cosine-similarity search, optional
  single-field equality filter (e.g. `documentId = X`).
- `scrollPoints(collection, filterKey, filterValue, limit)` — filter-only listing, **no** query
  vector required. Used when you want "everything tagged X" rather than "the most similar to Y."
- `deleteByFilter(collection, filterKey, filterValue)` — bulk delete (used on document deletion).

- `scrollAll(collection, filter, pageSize, withVector, maxPoints)` — like `scrollPoints` but keeps
  point ids, can return vectors, and follows `next_page_offset` to page past one request's limit.
- `searchWithFilter(collection, vector, limit, filter?, scoreThreshold?)` — the general form of
  `search()`: arbitrary Qdrant filter DSL plus an optional relevance floor.

Three collections exist: `examland_kb_chunks` (document text chunks),
`examland_document_fingerprints` (whole-document semantic fingerprints, used for dedup — see §2.3),
and `examland_question_bank` (one point per packaged exam question — see §2.4).

`ensureCollection` takes an optional payload-index list (defaulting to `knowledgeBaseId` /
`documentId`); any field you intend to filter on needs an index. Note its memo is keyed by
collection name alone, so keep exactly one `ensureCollection` call site per collection.

### 1.3 Chunking — `src/infra/chunking.ts`
Turns a document's extracted text into overlapping, ~1500-character chunks (200-char overlap,
cutting on sentence/paragraph boundaries where possible) tagged with the source page number. This
is what actually gets embedded and stored — never the raw document.

---

## 2. Knowledge Base RAG (the core retrieval loop)

When a user uploads a document to a Knowledge Base (`src/modules/knowledgeBases/service.ts`,
`addDocuments`):

```
PDF → extractText → chunkText → embedTexts (batch) → upsertPoints
                                                        payload: { knowledgeBaseId, documentId,
                                                                   fileName, pageNumber,
                                                                   chunkIndex, text }
```

Every downstream AI feature that needs "context about this subject/document" does the same
retrieval pattern: embed a query string, `search()` the KB collection filtered by
`knowledgeBaseId` (or `documentId`), get back the top-K chunks, and splice their `text` into an LLM
prompt as grounding context. This is used by:

- **Knowledge Base search** (`GET /api/knowledge-bases/:id/search`) — the most direct RAG use:
  embed the query, search, return chunks as-is (no LLM step at all — pure retrieval).
- **Lesson generation** (`src/infra/pdf/lessonGenerator.ts`) — embeds the first 1000 chars of the
  document being processed, retrieves topK=5 chunks from the KB for extra context, formats them as
  `--- Source: file, page N ---\ntext` blocks prepended to the question-generation prompt.
- **Exam extraction** (`src/infra/pdf/examExtractor.ts`) — same idea, topK=12, used once per
  document (not per page) to ground "provided vs. inferred" answer confidence.
- **Prompt Practice** (`src/modules/promptPractice/service.ts`) — embeds the user's free-text
  prompt, retrieves topK=12 from the chosen KB, and generates questions grounded in whatever comes
  back (confidence calibrated by whether anything relevant was found at all).
- **Lesson Practice** (`src/modules/lessonPractice/service.ts`) — one priority chain for both entry
  points. Questions come **only** from `Standard` exam types on the requested stage, for the
  requested subject (§2.4b); `documentId`, when supplied, changes only how that pool is *ranked*,
  never which pool is used:
  - *Document-scoped* (`POST /api/knowledge-bases/:id/documents/:documentId/lesson-practice`, or
    the optional `documentId` on `POST /api/lesson-practice`): `scrollPoints` pulls all of the
    document's chunks to reconstruct the lesson text, which is embedded and used to rank the
    question bank by relevance. The LLM is called only for the **shortfall**, and not at all when
    the bank covers the target.
  - *Subject-scoped* (no `documentId`): no query vector exists, so the scope's vectors are scrolled
    and a set is picked by greedy farthest-point selection — removing near-duplicates
    (cosine ≥ 0.93) and spreading topics. Zero embedding calls, zero LLM calls.

  A document's **own** questions are deliberately not a source. Sourcing them (the lesson
  assessment's `GeneratedQuestion` rows, reachable via
  `processingSession.knowledgeBaseDocumentId`) used to short-circuit the whole chain, so
  "Practice a Lesson" silently returned the first 20 assessment questions and never consulted the
  real exam bank. Questions from a document processed into a *Standard* exam type are still found —
  through the bank, under their corrected subject mapping.

**Key architectural point**: there is no reranking, no hybrid (keyword + vector) search, and no
relevance threshold on any of these — `search()` always returns its `limit` closest chunks by raw
cosine similarity, even if the best match is a poor one. This is the single biggest lever for
quality improvement (see §5.1).

---

## 3. The PDF processing pipeline (`src/modules/pdfProcessing/pipeline.ts`)

This is the most complex AI flow — a whole state machine per uploaded PDF:

```
Pending → Extracting → Classifying → Processing → Completed | Failed
```

### 2.1 Extraction
`src/infra/pdf/extractText.ts` pulls raw text + per-page text out of the PDF (via `pdf-parse`).

### 2.2 Classification
`src/infra/pdf/contentClassifier.ts` — one LLM call (task `ClassifyContent`) on the first 4000
characters, asking the model to label the document `lesson | exam | reference`, estimate topic
list and questions-per-page. This single classification decides which of three generation branches
runs next.

### 2.3 Two-tier deduplication (runs before classification)
- **Tier 1 — exact hash**: SHA256 of the uploaded file compared against prior `Completed` sessions.
  Exact match → clone its questions, skip the entire LLM pipeline.
- **Tier 2 — semantic fingerprint**: embed the first 4000 chars, search the fingerprint collection,
  cosine similarity ≥ 0.97 → treat as the same document (handles re-scanned/re-exported PDFs that
  hash differently but are the same content) and clone the same way.

This is itself a RAG-adjacent technique — using vector similarity not for content retrieval but as
a fuzzy "have I seen this before?" check, saving real LLM cost on duplicate uploads.

### 2.4 Content-specific generation
- **`reference`** → no questions generated at all; the document is simply indexed into the KB (§2)
  for future retrieval. This is *why* "Practice a Lesson" needed the reuse-then-generate fix — pure
  reference documents never had any `GeneratedQuestion` rows to begin with.
- **`lesson`** → `lessonGenerator.ts`: chunked LLM generation (batches of ≤10 questions), with a
  running "already covered concepts" list fed back into later batches so questions don't repeat the
  same concept twice.
- **`exam`** → `examExtractor.ts`: one LLM call per page (≥20 chars of text), extracting questions
  *verbatim* rather than generating new ones, classifying each as `answer_source: provided |
  inferred` to set confidence appropriately.

### 2.4b The question-bank index (`src/infra/vector/questionIndex.ts`)
A vector index over the *packaged* question bank — one point per question filed into a `Standard`
exam type under a real subject module. Deliberately keyed off the bank rather than
`GeneratedQuestion`, because at row-creation time a question has no exam type and no confirmed
subject: both `finalizeExam` and `fixSubjectMapping` write the corrected subject to
`ExamTypeQuestion.moduleName` and **never** back to `GeneratedQuestion.sourceSection`, and a
session's `subjectId` is per-PDF rather than per-question.

- **Point id** is `uuidv5(examTypeId + "/" + questionFileName)` — deterministic, so re-indexing
  upserts in place. Excluding the module name from the id is what lets `fixSubjectMapping`
  re-index by overwriting the payload instead of orphaning points.
- **`scopeKey`** (`"{stageId}|{normalized subject}"`) collapses the (stage, subject) pair into a
  single equality match, since the client supports only one filter key per query.
- **Write-through** is hooked at the points where the bank changes (`finalizeExam`,
  `appendToExamType`, `fixSubjectMapping`, ZIP `createExamType`, and the two delete paths), always
  fire-and-forget after cache invalidation — a Qdrant outage must never fail an exam-type write.
- **Backfill**: `npm run backfill:question-embeddings -- [--stageId=N] [--dryRun]`. Idempotent;
  ~$0.03 per 10k questions.

### 2.5 Subject classification (the newest layer)
`src/infra/pdf/subjectClassifier.ts` — after exam extraction, a batch LLM call (reusing the
`ClassifyContent` task) maps each extracted question to one of the exam's real stage subjects
(`Physiology`, `Biophysics`, etc.) instead of leaving it tagged by page number. This same classifier
is reused by the "Fix Subject Mapping" button (`POST /api/exam-types/:id/fix-subject-mapping`) to
retroactively reclassify already-imported exam types, and it's applied incrementally — questions
already mapped to a real subject are skipped, so re-running it is cheap and idempotent.

### 2.6 Lesson Assessment full-bank generation (`src/infra/pdf/fullBankGenerator.ts`)
A variant used only for the "Lesson Assessment" feature: batches of up to 8 pages per LLM call
(vs. per-page for exam extraction), targeting full topic coverage across difficulty tiers
(Easy → Extreme), with a resumable watermark (`lastCompletedPage`) so a crash or restart mid-job
picks up where it left off rather than regenerating from scratch or losing progress.

---

## 4. LLM service semantics (`src/infra/llm/openAiLlm.ts`)

Every one of the above calls goes through one function: `generateWithFallback(task, prompt,
maxTokens, temperature)`. It is the resilience layer, not just an API wrapper:

- **Model chains with fallback** — each task (`ClassifyContent`, `GenerateQuestions`,
  `ExtractAnswers`, `QualityCheck`) has a primary model plus a fallback list (configured in
  `src/config/index.ts`); on failure, the next model in the chain is tried.
- **Retry policy** — up to 2 attempts per model, exponential backoff (1s, 2s), but *only* for
  transient failures (HTTP 429/5xx/network errors) — a genuine 4xx (bad request) fails permanently
  and moves straight to the next model.
- **Hard per-attempt timeout** — 90s, enforced by racing the request against a timer, not relying on
  the HTTP client's own timeout (which can hang past its nominal limit under load).
- **Cost accounting** — every call computes `promptTokens × price + completionTokens × price` from
  a per-model pricing table, so cost is tracked even though nothing currently enforces a budget cap
  per request (see §5.4).

---

## 5. Where this can be enhanced

Ranked roughly by impact-to-effort ratio.

### 5.1 Add reranking / a relevance floor to retrieval
Every `search()` call returns its top-K by raw cosine similarity, unconditionally — there's no
check that the best result is actually *good*. A weak match still gets spliced into the prompt as
if it were solid grounding, which is one of the most common causes of hallucinated or off-topic
generated questions in any RAG system. Two incremental fixes, in order of effort:
1. **Score threshold**: drop results below a similarity cutoff (Qdrant's `search` response includes
   per-point scores — currently discarded) instead of always returning exactly `limit` results.
2. **Cross-encoder rerank**: after the initial vector search, re-score the top ~20 candidates with a
   cheaper, more precise model (even a small LLM call: "does this chunk answer this question,
   yes/no/partial") before picking the final top-K to inject into the generation prompt.

### 5.2 Hybrid search (keyword + vector)
Pure embedding similarity misses exact-term matches (drug names, formulas, numbered classifications)
that a keyword/BM25 search would catch instantly. Qdrant supports payload-based full-text filtering
alongside vector search — combining both (reciprocal rank fusion of the two result sets) is a
well-known, high-value upgrade for domain-heavy content like medical/technical material, which is
exactly this app's use case.

### 5.3 Persist and reuse question embeddings more broadly — *partly done (§2.4b)*
Every question packaged into a `Standard` exam type is now embedded into `examland_question_bank`
automatically, which already delivers near-duplicate detection and similarity-based reuse for
Lesson Practice. Still open:
- **"Find similar questions"** as a reviewer tool when editing the question bank — the index
  supports it, nothing surfaces it.
- **`LessonAssessment` and `PromptPractice` questions are not indexed.** Only `STANDARD_KINDS`
  exam types are, which is what makes the `scopeKey`-only filter sufficient. Widening this means
  adding a `kind` (or `sourceType`) payload filter to queries, not just relaxing the write-through.
- **ZIP-uploaded exams have `stageId = null`** (`createExamType` never sets one), so they get no
  `scopeKey` and are invisible to Lesson Practice. Accepting a stage on ZIP upload is the fix.

### 5.4 Per-request cost/token budget enforcement
`config.pdfProcessing.maxTokensPerSession` / `maxCostPerSessionUsd` exist in configuration and are
tracked (`tokensUsed`, `totalCost` on `PdfProcessingSession`) but nothing actually **stops** a
runaway session once those thresholds are crossed mid-pipeline — a pathological document (huge page
count, degenerate classification loop) could keep generating batches past the configured cap. Add a
check before each LLM call in the chunked/batched generators (`lessonGenerator.ts`,
`fullBankGenerator.ts`) that aborts cleanly (marking the session `Completed` with whatever was
generated so far, not `Failed`) once the running total crosses the configured limit.

### 5.5 Evaluation harness for generation quality
There's currently no automated way to know if a prompt change made question quality better or
worse — every tuning decision (confidence thresholds, chunk sizes, prompt wording) is evaluated by
eyeballing output. Even a lightweight harness — a fixed set of ~20 test PDFs with hand-labeled
"expected question count / expected topics," re-run on every prompt change, diffed against the
baseline — would turn prompt engineering from guesswork into something measurable.

### 5.6 Streaming generation feedback
Every generation flow (lesson, exam, full-bank) runs multiple sequential LLM calls but only reports
progress as a coarse status enum (`Pending → Extracting → Classifying → Processing → Completed`).
For long documents (the full-bank generator especially — up to dozens of batches), surfacing
per-batch progress (e.g. "Generated 40/120 questions, page 12 of 30") via a lightweight
polling field or SSE would materially improve perceived responsiveness without needing WebSockets.

### 5.7 Image-aware RAG
Per `BACKEND_SPEC.md` §8.1, image extraction/association from PDFs was explicitly left unimplemented
in this port. Diagrams, charts, and labeled anatomy images are common in this domain and currently
contribute nothing to either question generation or retrieval — a vision-capable model pass (extract
image + caption it, embed the caption text alongside the surrounding page text) would let images
participate in the same RAG loop as regular text chunks.

### 5.8 Multi-document synthesis for Lesson Practice
The current document-scoped Lesson Practice path treats one document in isolation. Once a Knowledge
Base has several related documents (e.g. three chapters of the same subject), a more useful practice
set would synthesize across all of them — vector search across the whole KB (not just one
`documentId`) weighted toward the triggering document but pulling supporting context from siblings,
similar to how Prompt Practice already searches the whole KB rather than one document.

### 5.9 Confidence-driven review routing
`isReviewFlagged` is set purely from a static confidence threshold (`< 0.75`) at generation time and
never revisited. A feedback loop — track which auto-flagged questions get edited vs. accepted
as-is during human review, and use that signal to recalibrate the threshold or flag specific
`generationMethod`/model combinations that produce a disproportionate share of edits — would make
the review-flagging signal improve over time instead of being fixed forever at a guessed number.

---

## Quick reference: file map

| Concern | File |
|---|---|
| Embeddings | `src/infra/embeddings/openAiEmbeddings.ts` |
| Vector store client | `src/infra/vector/qdrantClient.ts` |
| Question-bank index | `src/infra/vector/questionIndex.ts` |
| Vector selection/dedupe helpers | `src/infra/vector/similarity.ts` |
| Question-embedding backfill | `src/scripts/backfillQuestionEmbeddings.ts` |
| Document fingerprinting | `src/infra/vector/fingerprintStore.ts` |
| Chunking | `src/infra/chunking.ts` |
| PDF text extraction | `src/infra/pdf/extractText.ts` |
| Content classification | `src/infra/pdf/contentClassifier.ts` |
| Lesson question generation | `src/infra/pdf/lessonGenerator.ts` |
| Exam question extraction | `src/infra/pdf/examExtractor.ts` |
| Full-bank generation | `src/infra/pdf/fullBankGenerator.ts` |
| Subject/module classification | `src/infra/pdf/subjectClassifier.ts` |
| LLM resilience layer | `src/infra/llm/openAiLlm.ts` |
| Pipeline orchestration | `src/modules/pdfProcessing/pipeline.ts` |
| Knowledge Base RAG (upload/search/embed) | `src/modules/knowledgeBases/service.ts` |
| Prompt Practice | `src/modules/promptPractice/service.ts` |
| Lesson Practice (reuse-then-generate) | `src/modules/lessonPractice/service.ts` |
| Lesson Assessment job | `src/modules/lessonAssessment/job.ts` |
