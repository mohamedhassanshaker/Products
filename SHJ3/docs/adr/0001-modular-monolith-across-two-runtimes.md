# ADR-0001 — Modular monolith across two runtimes

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Product owner (stack selection), architecture
- **Supersedes:** —

## Context

SHJ3 comprises 17 screens across two audiences: a citizen-facing assistant (3 screens) and a government backoffice (14 screens). The functional baseline is `SHJ3-wireframes-guide.md`.

The architecture style selected was **modular monolith** — enforced module boundaries inside one deployable, chosen for speed of delivery and simple operations over the ops cost of microservices.

The stack selected in the same intake round is polyglot: **Next.js** for the web tier and **Python (FastAPI + Google ADK)** for the AI/agent runtime. These cannot share a process. A literal single-deployable monolith is therefore not achievable, and the two selections are in tension.

Additional forces:

- The agent runtime does long, expensive work: multi-second LLM turns, token streaming, and Graph RAG re-index jobs measured in minutes.
- The backoffice does short, cheap work: CRUD against configuration tables, rendered tables and editors.
- Google ADK, Neo4j's Python driver, Qdrant's client and the embedding/rerank SDKs are all Python-first. Reimplementing the agent runtime in TypeScript to preserve a single deployable would mean abandoning ADK, which was explicitly chosen.
- The team is small. Every additional deployable costs a Dockerfile, a Helm template, a health check, a log stream, an alert, and a place for configuration to drift.

## Options considered

### A. True single deployable — all TypeScript

Drop ADK and Python; implement the agent runtime in Node.

- **For:** One deployable, one language, one dependency tree, simplest possible ops. Honours "modular monolith" literally.
- **Against:** Discards a stack choice the product owner made deliberately. The TypeScript agent/RAG ecosystem is materially thinner — no ADK equivalent, weaker Neo4j GraphRAG tooling. A long re-index job would then run in the same event loop as the backoffice UI, where it starves request handling. Rejected.

### B. Two deployables, split at the language boundary — **chosen**

`shj3-web` (Next.js: UI + BFF + config API) and `shj3-ai` (FastAPI: agent runtime + Graph RAG). Module boundaries enforced strictly inside each.

- **For:** Keeps both chosen stacks. The split follows a real operational seam, not just a language one — the two sides differ in latency profile, scaling driver, deploy cadence and resource shape. Two deployables is close to the operational cost of one and nowhere near microservices. Isolates the risk of the runtime from the availability of the backoffice.
- **Against:** One network hop and one serialization boundary that a monolith would not have. Two CI paths, two images, two dependency audits. A shared understanding of the SQL Server schema must be maintained across two languages.

### C. Microservices per bounded context

Separate services for orchestration, knowledge, tools, channels, governance, etc.

- **For:** Independent scaling and deployment per context; strongest fault isolation.
- **Against:** ~8–16 services for a system with one team and no established traffic. Requires service discovery, distributed tracing, contract testing, per-service pipelines and a saga strategy for cross-context writes. The intake explicitly rejected this cost. Rejected.

## Decision

**Two deployables, and exactly two**, split along the TypeScript/Python boundary. Inside each, module boundaries are enforced as strictly as within a single-process monolith.

The style is still "modular monolith" in the sense that matters — *boundaries are architectural, not network-derived*. Modules communicate through published ports and domain events, and are prevented from importing each other's internals. The fact that two groups of modules happen to run in two processes is an implementation detail of the language split, not an invitation to distribute further.

Binding constraints:

1. **No third deployable without a superseding ADR.** Background workers run as additional *replicas of `shj3-ai`* with a different entrypoint, not as a new service with its own codebase.
2. **The web tier does not touch Neo4j or Qdrant.** Those stores belong to `shj3-ai`. Any need for graph or vector data from the web tier goes through the AI service's HTTP API.
3. **The AI service does not own the SQL Server schema.** See ADR-0005.
4. **Module dependency direction is enforced mechanically** — `eslint-plugin-boundaries` in web, `import-linter` in ai. A feature module importing another feature module fails the check.
5. **The internal API is versioned** (`/v1/...`) and typed, generated from a shared OpenAPI document, so the hop is type-safe in both directions.

## Consequences

### Positive

- Both chosen stacks are used for what they are best at; no capability is sacrificed to a structural purity argument.
- A 90-second re-index cannot starve the backoffice, because it is not in the same process.
- `shj3-ai` scales on conversation concurrency while `shj3-web` scales on page views — independently, with different resource limits.
- A crash in the agent runtime degrades conversations to the configured fallback (B5) instead of taking the backoffice down.
- The strict internal layering means extracting a module into a service later is a deployment change, not a rewrite — if scale ever demands option C.

### Negative

- One network hop on every conversation turn. Mitigated by keeping both deployables in the same namespace and using SSE for streaming so latency is perceived once, not per token.
- Two dependency ecosystems to patch and audit.
- Local development requires both runtimes plus four stores. Mitigated by a single `docker compose up` bringing up the whole stack.
- The temptation to add "just one more service" is now structurally available. Constraint 1 exists specifically to resist it, and it is a review-blocking rule.

### Neutral / follow-up

- Requires OpenTelemetry with a shared trace id across the hop from the first commit; retrofitting distributed tracing after the fact is painful, and B14 tab 3 depends on it being real.
- The internal API contract needs contract tests, since a type error across the hop is now a runtime failure rather than a compile failure.
