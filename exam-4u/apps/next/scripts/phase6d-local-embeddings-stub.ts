/**
 * A tiny, local, OpenAI-embeddings-API-contract-compatible HTTP stub (Phase 6, sub-slice "6d"
 * verification-only tooling, NEVER shipped/imported by application code).
 *
 * **Why this exists**: `next start` unconditionally coerces `NODE_ENV` to `production` (documented
 * since Phase 5/6a), which makes `NullEmbeddingsAdapter`'s own defense-in-depth constructor guard
 * correctly refuse to construct — so a real Playwright pass driving the actual rendered UI through a
 * real `next start` process cannot use the `null` embeddings provider, and this environment has no
 * live `EMBEDDINGS_API_KEY`/OpenAI credential (confirmed, same finding every prior Phase 5/6 dispatch
 * already recorded). Without this stub, the ONLY way to drive the "Find similar questions" dialog
 * through a real, rendered `next start` browser session would be to accept its honest error state at
 * the embeddings-call boundary (the exact same "prove up to the real call boundary" pattern 6a's own
 * `AiDisabledError` proof already established) — which this dispatch's own exit gate explicitly asks
 * for more than that: real ranked results in the real dialog.
 *
 * This stub therefore stands in ONLY for the third-party embeddings PROVIDER (an external SaaS this
 * environment has no credential for) — every line of this app's own code
 * (`OpenAiCompatibleEmbeddingsAdapter`, `QdrantVectorStoreAdapter`, `SimilarQuestionsService`, the real
 * `GET /api/pdf-processing/questions/:id/similar` Route Handler, the real rendered dialog) still runs
 * completely for real, over a real HTTP round trip, against a real local server implementing the
 * identical wire contract `OpenAiCompatibleEmbeddingsAdapter` already expects
 * (`POST {base}/embeddings` → `{ data: [{ embedding, index }] }`). It is the same category of
 * substitution as swapping a real payment gateway for a sandbox/test endpoint — the calling code path
 * is real; only the opaque third party behind it is a stand-in.
 *
 * **Vectors are computed with the EXACT SAME deterministic SHA-256-derived algorithm as
 * `NullEmbeddingsAdapter`** — this is what makes the proof coherent: `scripts/seed-phase6c-demo-data.ts`
 * indexes the two real question-bank points via the `null` provider (run as a plain `tsx` script, not
 * through `next start`, so `NullEmbeddingsAdapter` is free to construct there), and this stub produces
 * the byte-identical vector for the byte-identical duplicate-designed question text at query time
 * through `next start`'s own real HTTP embeddings call — so the real Qdrant cosine search genuinely
 * scores a `1.0` match, exactly as it would if the same adapter class had computed both vectors.
 *
 * Deliberately NOT reachable from any application code path — never imported by `src/server/**`, only
 * ever run standalone for this one manual verification session, and stopped immediately after.
 *
 * Run: `npx tsx scripts/phase6d-local-embeddings-stub.ts [port=4569]`
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.argv[2]) || 4569;
const DIMS = 1536;

/** Verbatim copy of `NullEmbeddingsAdapter.pseudoVector` — see this file's own header doc comment for
 * why the two must compute identically. */
function pseudoVector(text: string): number[] {
  const digest = createHash('sha256').update(text).digest();
  const vector = new Array<number>(DIMS);
  for (let i = 0; i < DIMS; i += 1) {
    vector[i] = digest[i % digest.length] / 128 - 1;
  }
  return vector;
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/embeddings')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const { input } = JSON.parse(body) as { input: string[] };
      const data = input.map((text, index) => ({ embedding: pseudoVector(text), index }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    } catch (err) {
      res.writeHead(400).end(String(err));
    }
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console -- CLI script's own user-facing output, not application logging.
  console.log(`Local embeddings stub listening on http://localhost:${PORT} (verification-only, never imported by application code)`);
});
