# Agent Development Kit (ADK) for TypeScript — and how it fits ExamLand

**Date**: 2026-08-02  
**Status**: Research / proposal doc  
**Scope**: Explains Google's Agent Development Kit (ADK) for TypeScript and maps it onto the AI
features already present in `examland-nodejs`, so we can decide what to adopt and where.

---

## 1. What is ADK?

The Agent Development Kit (ADK) is Google's open-source framework for building, evaluating, and
deploying AI agents. It is available in Python, TypeScript/JavaScript, Go, Java, and Kotlin. The
TypeScript version (`google/adk-js`) targets the Node.js and browser ecosystems and is:

- **Code-first**: agents, tools, and orchestration are defined directly in TypeScript (no YAML/JSON
  DSL), so your AI logic is versionable, testable, and CI/CD-friendly just like the rest of your
  code.
- **Type-safe end-to-end**: tool parameters are declared with **Zod** schemas with compile-time type
  inference. This repo already depends on `zod@^3.23.8`, so this fits naturally.
- **Model-agnostic**: optimized for Gemini/Vertex AI, but supports many providers (Claude, OpenAI,
  Ollama, vLLM, LiteLLM, etc.). ExamLand's existing LLM calls target OpenAI chat-completions, so we
  can point ADK agents at the same models.
- **Deployment-agnostic**: run agents in the same process as the Express server, in a container, or
  on serverless platforms (e.g. Cloud Run).
- **ESM + CommonJS + browser** capable, so agent code can be shared between backend and the Angular
  client if ever desired.

### 1.1 Core primitives

| Concept | What it is | ADK TypeScript class / API |
|---|---|---|
| Agent | A unit that can respond to queries; an `LlmAgent` is an agent whose decisions come from an LLM | `LlmAgent`, `Agent` |
| Tool | A function the agent can call; parameters declared with Zod, executed with your code | `FunctionTool` |
| Workflow | Orchestrated, deterministic multi-step logic (sequential, parallel, loop, routing) | `WorkflowAgent` / flow objects |
| Multi-agent | Agents that delegate to sub-agents, forming a team | `subAgents` |
| Session | Per-user conversation state (turns, events, state) | `Session`, `Runner` |
| Memory | Short-term (session) and long-term (vector-backed, RAG-style) recall | `LongTermMemory` etc. |
| Callbacks | Lifecycle hooks (before/after model call, tool call, etc.) for tracing and control | callbacks |
| Runtime | Ways to run agents: programmatic runner, CLI, dev web UI, or HTTP server | `Runner`, `npx adk ...` |
| Dev tools | Scaffold, test, debug, and deploy agents | `@google/adk-devtools` (`adk create/run/web/deploy`) |

### 1.2 What ADK is *not*

- It is **not a web framework** — you still keep Express and the existing REST API. ADK is a layer
  that you call *from* your routes/services when you want agentic behavior.
- It is **not a replacement** for your hand-rolled OpenAI client per se — you *can* keep
  `openAiLlm.ts` for deterministic, single-shot LLM calls. ADK shines when you want tool-use,
  multi-step orchestration, memory, and evaluation.

---

## 2. Getting started

Requirements (per current ADK docs): **Node.js 24.13.0+** and npm 11.8.0+. This repo pins Node 20
and npm 8; the project's engine would need to be raised (or the agent layer isolated in a process
that runs on Node 24) before production adoption.

```bash
npm install @google/adk
npm install -D @google/adk-devtools
```

A minimal agent (`agent.ts`):

```typescript
import {FunctionTool, LlmAgent} from '@google/adk';
import {z} from 'zod';

const getCurrentTime = new FunctionTool({
  name: 'get_current_time',
  description: 'Returns the current time in a specified city.',
  parameters: z.object({
    city: z.string().describe('The name of the city.'),
  }),
  execute: ({city}) => ({status: 'success', report: `The current time in ${city} is 10:30 AM`}),
});

export const rootAgent = new LlmAgent({
  name: 'hello_time_agent',
  model: 'gemini-flash-latest',          // or any supported provider model
  description: 'Tells the current time in a specified city.',
  instruction: `You are a helpful assistant that tells the current time in a city.
                Use the 'getCurrentTime' tool for this purpose.`,
  tools: [getCurrentTime],
});
```

Run it interactively to debug:

```bash
npx adk run agent.ts    # CLI REPL
npx adk web             # dev web UI at http://localhost:8000 (dev-only!)
```

### 2.1 Embedding an agent in your server

ADK is callable from your existing Express routes via the `Runner` (illustrative API — check the
latest TS reference before coding):

```typescript
import {Runner, LlmAgent, FunctionTool} from '@google/adk';

const runner = new Runner({agent: rootAgent, appName: 'examland'});
const session = runner.createSession(userId);

// inside an Express route handler:
const response = await runner.run({session, query: req.body.query});
res.json(response);
```

---

## 3. Current AI stack in examland-nodejs (where the AI actually lives today)

Everything below is LLM/embeddings wiring the ADK layer could reuse or replace.

- **LLM client** — `src/infra/llm/openAiLlm.ts`: hand-rolled OpenAI `chat/completions` wrapper.
  `LlmTask` enum drives per-task models (`ClassifyContent`, `GenerateQuestions`, `ExtractAnswers`,
  `QualityCheck`), a fallback model chain, retry/backoff, markdown-fence stripping, and per-call cost
  tracking. Entry point: `generateWithFallback(task, prompt, maxTokens, temperature)`.
- **Embeddings** — `src/infra/embeddings/openAiEmbeddings.ts`: `embedText` / `embedTexts` against
  `text-embedding-3-small` (1536 dims), batched by 100.
- **Vector store** — `src/infra/vector/`: thin Qdrant REST client (`qdrantClient.ts`), question
  index (`questionIndex.ts`), document fingerprinting/dedup (`fingerprintStore.ts`), similarity
  helpers (`similarity.ts`).
- **RAG** — `src/modules/knowledgeBases/service.ts` (KB upload → chunk → embed → Qdrant → search),
  `src/modules/lessonPractice/service.ts` (semantic search over lessons), `src/modules/
  promptPractice/service.ts` (semantic search over prompts).
- **PDF → exam pipeline** — `src/modules/pdfProcessing/pipeline.ts` + `src/infra/pdf/`:
  `subjectClassifier.ts`, `contentClassifier.ts`, `lessonGenerator.ts`, `fullBankGenerator.ts`,
  `examExtractor.ts`, plus `src/infra/chunking.ts`.
- **Assessment job** — `src/modules/lessonAssessment/job.ts`.
- **Workers** — `src/workers/pdfProcessingWorker.ts` (resume/sweep/pending pipeline) and
  `src/workers/outboxWorker.ts`.

The pattern everywhere is *one prompt string → `generateWithFallback` → parse JSON*. It works, but
it is single-shot: no tool use, no multi-step reasoning, no structured feedback loop, and the
"LLM glue" (prompts, retries, cost) is duplicated across modules.

---

## 4. How ADK can enhance ExamLand's AI features

Below, each row maps a current ExamLand weakness to the ADK feature that fixes it, and points at the
file it would change.

### 4.1 Turn brittle JSON prompts into typed tools (everywhere)

Today each pipeline builds a giant prompt, asks for JSON, then hand-parses
(`stripMarkdownFences` + `JSON.parse`) and hopes the model complied. With ADK `FunctionTool` + Zod:

- The **tool parameters** (e.g. a generated question object) are schema-validated at compile time
  and the model is *called into* the tool rather than asked to print JSON.
- Malformed output is retried by the framework instead of silently producing `null` questions.

**Where it lands**: rewrite `src/infra/pdf/fullBankGenerator.ts`, `examExtractor.ts`,
`lessonGenerator.ts`, and `subjectClassifier.ts` so the LLM returns through a Zod-typed tool instead
of free-form JSON.

### 4.2 Structured, multi-step pipelines via workflows

The PDF pipeline currently chains stages with bespoke orchestration (`pipeline.ts`,
`pdfProcessingWorker.ts`) and hand-rolled resume/watermark logic. ADK `WorkflowAgent` gives
declarative **sequential / parallel / loop / routing** flows with built-in state, events, and
resume support — turning the fragile `classify → extract → generate → quality-check` chain into a
declared graph.

**Where it lands**: `src/modules/pdfProcessing/` and `src/workers/pdfProcessingWorker.ts` (loop flow
for the per-chunk generation loop; parallel flow where independent).

### 4.3 RAG with a proper retrieval tool instead of ad-hoc search

Knowledge-base / lesson / prompt practice currently call `embedText` + Qdrant search inline in each
service (`knowledgeBases/service.ts:181`, `lessonPractice/service.ts:212`,
`promptPractice/service.ts:103`). ADK's **long-term memory** and **retrieval tools** wrap the
same Qdrant store behind a standard interface: the agent decides *whether* and *how many* chunks to
retrieve, and the retrieval step is reusable across modules instead of copy-pasted.

**Where it lands**: `src/modules/knowledgeBases/`, `lessonPractice/`, `promptPractice/` — expose the
existing Qdrant client as an ADK `FunctionTool`/memory backend.

### 4.4 Agentic quality checking (the current `QualityCheck` task)

`config` already defines a `QualityCheck` model. Today it's a single pass. With ADK you can build a
small **agent team**: a *generator* agent produces questions, a *reviewer* agent critiques them, and
a loop flow runs generate→review→regenerate up to N rounds. This directly addresses the known
simplification in `README.md` about §8.1/§9 not matching the original spec's robustness.

### 4.5 Sessions & memory for interactive features

Lesson practice and prompt practice are interactive but stateless across calls. ADK `Session` +
memory gives per-user conversational context (e.g. "continue from the last question you got wrong"),
with the existing MySQL tables usable as the persistence store behind a custom memory/session
backend if we don't want ADK's default storage.

### 4.6 Evaluation before you ship a prompt change

ADK has an **evaluation** story (criteria, user simulation, metrics). Today there is no harness to
compare "old prompt vs new prompt" on the question bank. A small eval suite that runs the
`fullBankGenerator` agent against a golden set and scores question quality would let us change
prompts/models with confidence — and can be wired into CI.

### 4.7 Model/provider flexibility without touching code

`config/index.ts` hardcodes OpenAI models + fallbacks in `config.openAi`. ADK's model layer (and
LiteLLM integration) makes the model a per-agent config value; combined with the existing fallback
chain we can route `ClassifyContent` to a cheap model and `GenerateQuestions` to a big one — or
swap providers entirely — by editing config instead of client code.

### 4.8 Development tooling

`npx adk run agent.ts` / `npx adk web` give an interactive debugger for each agent — much easier to
tune the PDF-generation agent than the current approach of seeding a DB and hitting REST endpoints.
This is a dev-only win (ADK Web is explicitly not for production).

---

## 5. Recommended adoption path (incremental)

1. **Pilot (no behavior change)**: add `@google/adk` + `@google/adk-devtools` as a dependency;
   create `src/agents/` with one throwaway agent (e.g. wrap `getCurrentTime`-style tool) and run it
   with `npx adk run` to validate the toolchain. No production routes touched.
2. **Low-risk rewrite**: convert `subjectClassifier.ts` / `contentClassifier.ts` from
   `generateWithFallback` + JSON parsing to a Zod-typed ADK `LlmAgent`/tool call. Keep the same
   function signature so `pipeline.ts` doesn't change.
3. **Pipeline orchestration**: express the `classify → extract → generate → QC` chain as a
   `WorkflowAgent`, retiring the bespoke state machine in `pipeline.ts`/`pdfProcessingWorker.ts`
   (keep the outbox worker for persistence/retry).
4. **RAG standardisation**: expose Qdrant as a shared retrieval `FunctionTool` and refactor
   `knowledgeBases` / `lessonPractice` / `promptPractice` onto it.
5. **Interactive features**: introduce `Session` + memory for lesson/prompt practice.
6. **Evaluation**: add an ADK eval harness for question generation and gate prompt changes on it.
7. *(Optional, later)*: raise the Node engine to 24+ and deploy agents on Cloud Run / GKE using
   `adk deploy`.

Each step is independently shippable and reversible; the existing `openAiLlm.ts` / embeddings /
Qdrant code can remain as the fallback path throughout.

---

## 6. Caveats & open questions

- **Node version**: ADK currently requires Node ≥ 24.13; this repo targets Node 20
  (`package.json` engines, Dockerfile, `.nvmrc` if any). Decide whether to bump the runtime or keep
  ADK in a sidecar process/service.
- **Cost accounting**: ADK does not give you ExamLand's per-model pricing table
  (`config.openAi.modelPricing`). Wrap the ADK model client with a callback (or keep using
  `openAiLlm.ts` for cost-sensitive single-shot calls) to preserve the cost/token accounting the PDF
  SRS requires.
- **Storage**: ADK has its own session/memory storage defaults; map them onto the existing MySQL +
  Qdrant schema (or disable memory) to avoid a second persistence system.
- **New dependency surface**: `@google/adk` is relatively new; review its security/maturity posture
  and the license before making it a core dependency.
- **Don't rewrite everything**: for simple deterministic calls (e.g. a single `QualityCheck`),
  plain `generateWithFallback` is still simpler. Use ADK where tool use, orchestration, memory, or
  evaluation earn their keep.

---

## 7. References

- ADK TypeScript quickstart: https://adk.dev/get-started/typescript/
- GitHub `google/adk-js`: https://github.com/google/adk-js
- Docs (multi-agent, workflows, memory, evaluation): https://adk.dev/
- Samples: https://github.com/google/adk-samples
- In-repo context: `docs/AI_AND_RAG.md`, `docs/AI_PDF_Exam_Creation_SRS.md`,
  `src/config/index.ts` (OpenAI model/pricing config), `src/infra/llm/openAiLlm.ts`.
