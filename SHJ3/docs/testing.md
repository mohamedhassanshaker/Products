# SHJ3 — Test Strategy & Requirement Traceability Matrix

> Status: **Validated** · Last updated: 2026-09-08 · Phase D deliverable
> Upstream: [`requirements/`](./requirements/README.md) (294 FR + 84 NFR = **378 requirement IDs** at the wireframe baseline, split one file per module; plus FR-ORCH-15–30 for the delivery-added Pipeline Designer — [`requirements/orchestration.md`](./requirements/orchestration.md) §5.5.2, untested per [`requirements/risks.md`](./requirements/risks.md) RISK-026) · [`SHJ3-wireframes-guide.md`](./SHJ3-wireframes-guide.md) · [`architecture.md`](./architecture.md) · [`adr/`](./adr/)
> Downstream: [`deployment.md`](./deployment.md) (how the stack under test is brought up), [`design-system.md`](./design-system.md) (token and contrast rules the gates enforce)

---

## 1. Purpose and the coverage rule

This document defines how SHJ3 is tested and maps every requirement to the tests that verify it.

**The coverage rule, stated once and applied everywhere:**

1. **Coverage is measured per requirement, not per line.** The gating report is "how many of the 378 IDs have a passing test", not "what percentage of statements executed".
2. **A requirement with no passing test is an incomplete requirement.** Not a documented gap, not a follow-up — incomplete. The row is red and the slice containing it is not done.
3. **The project cannot be declared done while any matrix row is unverified.** §12 is the checklist. `Planned` and `Implemented` rows both count as unverified; only `Passing` counts.
4. **Where a requirement is genuinely untestable as written, it is rewritten in `requirements.md` until it is testable.** Requirement IDs are permanent (`requirements.md` §1.1), so the wording changes and the ID does not. §16 lists what remains only partially provable and why.

Every requirement in `requirements.md` already ships with acceptance criteria written to be executable. This document does not re-derive them; it assigns each one a layer, a test identifier and a status.

### 1.1 Test identifier convention

Test identifiers in §12 are real paths and are the contract between this document and the repository.

| Pattern | Meaning |
|---|---|
| `web/<module>/<name>.spec.ts` | Vitest unit test in `shj3-web`, domain/application layer, no I/O |
| `web/<module>/<name>.int.spec.ts` | Vitest integration test in `shj3-web`, real containerised stores |
| `ai/<module>/test_<name>.py` | pytest unit test in `shj3-ai`, no I/O |
| `ai/<module>/test_<name>_int.py` | pytest integration test in `shj3-ai`, real containerised stores |
| `contract/<name>.contract.spec.ts` · `ai/contract/test_<name>_contract.py` | Both sides of the `shj3-web` ↔ `shj3-ai` internal API contract |
| `e2e/journeys/<name>.spec.ts` | Playwright, citizen surface, real stack |
| `e2e/backoffice/<name>.spec.ts` | Playwright, backoffice, real stack |
| `e2e/roles/<role>.spec.ts` | Playwright permission walkthrough, one per role |
| `isolation/tenant-isolation.spec.ts` (+ `isolation/<store>.spec.ts`) | The release-gate isolation suite (§5) |
| `nfr/a11y/<name>.a11y.spec.ts` | axe + keyboard, Playwright |
| `nfr/perf/<name>.k6.js` | k6 load or latency profile |
| `nfr/sec/<name>.sec.spec.ts` | Security assertion suite |
| `nfr/i18n/<name>.i18n.spec.ts` | Locale, RTL, formatting |
| `nfr/data/<name>.data.spec.ts` | Retention, erasure, ledger integrity |
| `nfr/obs/<name>.obs.spec.ts` | Trace, log and metric assertions |
| `visual/<name>.vr.spec.ts` | Playwright visual regression snapshot |
| `gates/<name>.gate.ts` | Static/structural gate — lint rule, boundary check, drift check, coverage script |
| `eval/<name>.eval.py` | Model-quality evaluation, **non-blocking** (§8) |

Layer codes used in the matrix: **U** unit · **I** integration · **C** contract · **E** end-to-end · **S** static gate · **N** non-functional · **Q** quality evaluation (non-blocking).

### 1.2 Requirement annotation

Every test declares the requirement IDs it covers, in code, so the coverage report in §13 is generated rather than maintained.

```ts
// web/iam/permission-matrix.spec.ts
import { covers } from "../../test/covers";

describe("permission matrix", () => {
  covers("FR-IAM-09", "FR-IAM-10", "FR-IAM-12");

  it("creates a custom role with every permission denied", () => { /* … */ });
});
```

```python
# ai/orchestration/test_execution_modes.py
import pytest

@pytest.mark.covers("FR-ORCH-02", "FR-ORCH-03", "FR-ORCH-04", "FR-ORCH-05", "FR-ORCH-11")
def test_supervisor_worker_emits_plan_then_delegations_then_review(): ...
```

`covers()` and the `covers` marker do nothing at runtime beyond recording the mapping into the run's JSON report. A test with no `covers` annotation fails the lint gate — an unattributed test cannot move a matrix row.

---

## 2. Test pyramid and layers

Six layers. Each has a defined scope, tooling, execution location, speed budget and blocking behaviour. The shape is a pyramid by count and an hourglass by value: most tests are unit, but the integration and cross-module layers carry the highest defect-detection value in this system because SHJ3's hard parts are the seams (`requirements.md` §6).

| Layer | Tool | Scope | Runs where | Target duration | Blocks |
|---|---|---|---|---|---|
| **Unit** | Vitest (web), pytest (ai) | `domain/` + `application/` only. Pure functions, policy evaluation, state machines, derivations | Developer machine, pre-commit on changed packages | < 60 s per runtime, whole layer | Pre-commit and `verify` |
| **Integration** | Vitest + Testcontainers, pytest + Testcontainers, or the Compose stack | `adapters/` against **real** SQL Server, Neo4j, Qdrant, Redis. Repositories, graph store, vector store, cache, outbox, migrations | `verify`; Compose stack locally | < 8 min both runtimes | `verify` |
| **Contract** | Zod/Pydantic schema pairs + recorded interactions | The internal HTTP+SSE API between `shj3-web` and `shj3-ai`, both directions, plus schema evolution | `verify`, and independently runnable per runtime | < 90 s | `verify` and pre-commit (schema files changed) |
| **E2E** | Playwright, real browsers, full Compose stack | Citizen widget and backoffice, against seeded fixtures | `verify` | < 20 min sharded | `verify`, release gate |
| **Non-functional** | axe-core, Playwright, k6, custom scanners | a11y, performance, security, visual regression, i18n/RTL, data retention, observability | `verify` (a11y/sec/i18n/visual/data/obs); k6 on demand and before release | < 12 min excluding k6; k6 profiles 5–30 min | `verify` except k6 load profiles, which block release only |
| **Quality evaluation** | pytest + labelled sets, B13 runner | Retrieval quality, answer quality, Arabic parity | On demand, nightly locally, before release | 10–40 min, cost-bearing | **Never blocks a commit.** Reported as a trend; a regression beyond the agreed band blocks a *release* by human decision |

### 2.1 Unit — `domain/` and `application/`

The inner layers contain **zero vendor imports by design** (`architecture.md` §4, `NFR-OPS-12`, ADR-0004 rule 1). That is not a stylistic preference — it is precisely what makes them unit-testable without a test double for anything. There is no Prisma client to fake, no `litellm` to patch, no HTTP object to construct: a use case takes a port interface and returns a value.

**In:** routing-rule ordered evaluation, the transaction state machine, assurance-level comparison, conflict-resolution policy selection, retention-scope computation, permission evaluation, publish-gate arithmetic, merge policy, cost-ceiling accumulation, slug validation, contrast computation, token resolution order.

**Out:** anything touching a store, a network socket, a clock we do not control, a browser, or a model provider. A "unit test" that spins a container is an integration test filed in the wrong place, and will be moved.

The tenant-context requirement `NFR-SEC-17` has a direct consequence here: application-layer functions take **no** tenant parameter, so unit tests never pass one. A unit test that needs a tenant argument is evidence the isolation design was violated, and the boundary gate (`gates/tenant-param.gate.ts`) fails the build for it.

### 2.2 Integration — real stores, in containers

Adapters are verified against the real engines, never against an in-memory substitute. Testcontainers for per-suite isolation; the Compose stack for suites that need all four stores plus both runtimes.

**In:** Prisma repositories against real SQL Server schemas (including schema-per-tenant handle construction), builder-generated Cypher against a real single-database Neo4j Community instance (ADR-0009), Qdrant collection lifecycle and hybrid search, Redis prefixing and breaker state sharing across replicas, the outbox and its reconciliation job, Prisma migrations applied per tenant, the audit table's `UPDATE`/`DELETE` grant absence, the `shj3-ai` three-table-group write grant.

**Out:** model providers (§3), the WhatsApp BSP, the payment gateways, UAE PASS — all stubbed at the port boundary with recorded, schema-validated fixtures.

SQL Server is the awkward one: container start is slow. One session-scoped container per runtime, per-test isolation by transaction rollback where the test does not exercise DDL, and a fresh schema per test where it does.

### 2.3 Contract — the `shj3-web` ↔ `shj3-ai` hop

ADR-0001 accepted a two-runtime split and named its cost explicitly: **a type error across that hop is a runtime failure, not a compile failure.** There is no shared type system between TypeScript and Python. Contract tests are therefore load-bearing, not hygiene.

The contract is generated from one source: the internal API schemas in `api.md` §5, emitted as Zod schemas for `shj3-web` and Pydantic models for `shj3-ai`. Both sides test against the same fixture corpus.

- **Web → AI (consumer side):** every request `shj3-web` can construct validates against the AI service's declared input schema; every response the AI service can return parses in `shj3-web` without a narrowing cast.
- **AI → Web (provider side):** the AI service's handlers accept the full fixture corpus, including the boundary cases the web client can produce — empty tool-binding lists, a nullable pending slot, a 4096-character free-text turn, an Arabic turn with mixed-direction text.
- **SSE:** the streaming contract is part of the contract, not an afterthought — event names, ordering, the terminal event, and the mid-stream error frame (§6.9).
- **Schema evolution:** a dedicated suite asserts that adding an optional field to either side does not break the other, and that removing or retyping a field **fails loudly**. This is the test that prevents a silent runtime break when one runtime ships ahead of the other.

```ts
// contract/turn-request.contract.spec.ts
covers("NFR-SEC-05", "FR-CONV-10");

it("every web-constructible turn request satisfies the AI input schema", () => {
  for (const fixture of turnRequestCorpus) {
    expect(AiTurnRequestSchema.safeParse(fixture).success).toBe(true);
  }
});

it("fails when a required field is removed from the AI schema", () => {
  // guards schema evolution: this test must break if `conversationId` becomes optional
  expect(AiTurnRequestSchema.shape.conversationId.isOptional()).toBe(false);
});
```

### 2.4 E2E — Playwright against the real running stack

Real Chromium, real Firefox for the citizen widget, against the Compose stack with both runtimes, all four stores, and the deterministic seed. Two surfaces:

- **Citizen widget** — docked, expanded, WhatsApp-rendered, voice input, escalated. Includes an embed test on a plain HTML host page, because `FR-CHAN-08`/`FR-CHAN-09` are about embedding, not about the backoffice's own rendering of the widget.
- **Backoffice** — the 14 screens plus Settings → Appearance and the user guide.

E2E asserts journeys and cross-module consequences. It does not assert unit-level branches; an E2E suite used as a substitute for unit coverage becomes slow, flaky and uninformative.

### 2.5 Non-functional

Five families, all mechanised: accessibility (axe on every page plus scripted keyboard walkthroughs), performance and load (k6), security (an assertion suite plus scanners), visual regression (Playwright snapshots of the design-system organisms in light, dark, LTR and RTL), and i18n/RTL. Detailed in §11.

### 2.6 Quality evaluation

Model-dependent quality. Separate suite, separate schedule, never blocking a commit. Detailed in §8.

---

## 3. What we do not mock, and why

Three decisions, in descending order of how often they are got wrong.

**1. We do not mock the stores.** Integration tests run against real SQL Server, Neo4j, Qdrant and Redis in containers. A mocked repository that returns the shape the test expects will pass indefinitely while the real schema is broken, the real Cypher is invalid, the real collection has the wrong vector dimension, or the real key is missing its tenant prefix. In a system whose isolation guarantee is *physical* in three stores — schema per tenant, collection per tenant, prefix per tenant (ADR-0002) — a mocked store cannot verify the property that matters, because the property lives in the store, not in the code. The isolation suite (§5) is meaningless against fakes.

The graph is the exception, and it cuts the same way for a different reason. Under ADR-0009 the graph's isolation unit is **logical** — a `:Tenant_<slug>` label plus a `tenant_id` property in one Neo4j Community database — so the property lives in the code that builds the query rather than in the store. That makes real Neo4j *more* necessary, not less: a fake would happily return a scoped-looking result for an unscoped query, which is precisely the defect the graph now has to be tested for. Every graph isolation case in §5.2 runs against the real engine with two populated tenants in the same database.

**2. We do not mock the browser.** Playwright drives real engines. The hard organisms in this product — B6's SVG graph canvas, B7's flow canvas, B9's 7×8 permission matrix, the streaming assistant thread, RTL mirroring — are exactly the things a JSDOM-based test reports as working when they are not.

**3. We do stub the model providers, in every deterministic test.** `ChatModel`, `EmbeddingProvider` and `Reranker` are ports (ADR-0004 rule 1). In unit, integration, contract, E2E and non-functional tests, all three are backed by deterministic stub adapters.

This is the most important testing decision in the system, so the reasoning is stated rather than assumed:

> **A non-deterministic LLM cannot be an assertion target.** If the assertion is `expect(reply).toContain("SEWA")`, the test measures the model's mood. It will fail on a provider-side model update that changed nothing about SHJ3, and it will pass while the pipeline is broken because the model happened to say something plausible. Either way it stops being a signal, and a suite that is routinely re-run until green is not a suite.

So the split is:

| | Deterministic suite (blocking) | Evaluation suite (non-blocking) |
|---|---|---|
| Model providers | Stubbed at the port | Real providers, or a pinned local model |
| Asserts | **Pipeline behaviour** — that the right stages ran, in the right order, with the right inputs, producing the right trace, persistence, guardrail verdict, citation and stream | **Answer quality** — accuracy, groundedness, tool-selection correctness, Arabic parity |
| Determinism | Total. Same input, same output, every run | None. Scores move; trends matter |
| Cost | Zero | Real money per run |
| Failure means | The code is broken. Fix the code | The quality moved. Investigate, decide |
| Gates | Every commit and every phase | A release, by human judgement against an agreed band |

What the stub does *not* do is fake the pipeline. Guardrails, routing, retrieval, tool dispatch, merge, streaming and persistence are all real. The stub replaces exactly one thing: the token generator. `ai/testing/stub_chat_model.py` returns scripted responses keyed by a `(scenario, hop)` pair, so a test can script a tool call on hop 1, an error on hop 2 and a final answer on hop 3 — and the whole orchestrator runs for real around it (§6.1).

Also stubbed, for the same determinism reason: the WhatsApp BSP, both payment gateways, the MCP servers behind recorded tool schemas, and `VerificationProvider` (which is *specified* as a first-class mock by ADR-0006 rule 5, not merely tolerated as one).

Never stubbed: our own code. There is no test in this suite that mocks a use case to test a controller.

---

## 4. Test data strategy

### 4.1 Determinism is non-negotiable

`FR-PLAT-10`, `NFR-OPS-02` and ADR-0008 all require it, and the reason is specific to this product: **the wireframe's cross-module wiring only demonstrates correctly from a known starting state.** "Approve the template and the campaign unblocks" is only an assertion if the campaign was blocked, and blocked *for that reason*, before the test ran. Half the highest-value tests in this system (§10) are differential — they assert a state change between two reads — and a differential assertion against a non-deterministic starting state is not a test.

`docker compose up` from empty volumes, twice, produces byte-identical seed state: fixed UUIDs, fixed timestamps relative to a pinned seed epoch, fixed vector payloads (the stub embedder is deterministic), fixed graph node ids.

### 4.2 The seeded state, exactly

The seed reproduces the wireframe's sample state. These are fixture specifications, not content (`requirements.md` §2.4), and the E2E and wiring suites assert against them by name.

**Tenants (4)** — `sewa`, `customs`, `libraries`, `platform`. All four fully provisioned across all four stores, which satisfies the "at least two tenants" requirement with margin (§4.4).

**Agents (4)** — including `Library Services v0.9 Draft`: status `Draft`, no bound channels, no usage. It exists to prove `FR-AGENT-01`'s "a Draft agent shows no channels and no usage" and to be the subject of the Agent-Designer-cannot-publish test (`FR-IAM-11`).

**Knowledge sources (4)** — at **100%**, **90%**, **70%** and **55%** indexed. The 70% source is the fixture for `FR-KNOW-05` (partial retrieval is reported as partial, never as ready); the 55% source is the one a freshly-added-source test drives upward.

**Users (5)** — across all five B9 statuses and role assignments, so `e2e/roles/*` has a real principal per role and `FR-IAM-03` has a suspendable user holding a live session.

**Source conflicts (2)** — both seeded **unresolved**. One is the SEWA tariff conflict. The other is the deliberately awkward one: the **library membership conflict, where the more recent source holds the less authoritative value**. That fixture exists to make `FR-KNOW-22` assertable in both directions — `Prefer most recently updated source` selects the *wrong* value and `Prefer owning entity source` selects the right one. The failure of the recency policy is the assertion, not an accident.

**Circuit breakers (3)** — the **SEWA bill API breaker seeded `Open — fallback active`**, matching B14 tab 3's `Degraded` row from one underlying state (`FR-TOOL-22`). No test may leave it closed.

**Promotion (1 pending)** — `SEWA Billing v1.4`, UAT → Production, requester recorded, approval pending. The approve-and-audit atomicity test (`FR-GOV-29`) consumes it; the separation-of-duties test (`FR-GOV-15`) attempts approval as the requester.

**Publish-gate blockage** — `General FAQ v3.0` blocked on **Arabic parity at 71%** accuracy, with Arabic translation completeness at **82%**. Two numbers, two independent block reasons, one message that must name both (`FR-EVAL-08`, `FR-EVAL-09`, RISK-007).

**Template and campaign** — `appointment_confirmation` at `Pending review`, and its campaign at `Blocked`. The unblock test approves the template and re-reads the campaign (`FR-CHAN-15`, `FR-CHAN-23`).

**Also seeded** — the 4 routing rules in the B8 order, the 4 golden sets including the red-team set, the 3 escalation tickets with their three distinct reasons, the 4 transactions including the pending refund, the 5 guardrail policies with their locked flags, the 3 environments, the 2 skins.

### 4.3 Fixtures, factories and isolation

- **Seed** — one deterministic dataset, applied by `shj3-web`'s seeder through the same provisioning path the product uses (`FR-PLAT-02`). Never raw SQL: a seeder that bypasses provisioning would let a half-provisioned tenant into the fixture set, which is the one state where isolation reasoning breaks (ADR-0002 rule 6).
- **Factories** — typed builders per aggregate (`agentFactory`, `ticketFactory`, `sourceFactory`) with sensible defaults and explicit overrides, for tests that need data the seed does not contain. Factories always go through the domain constructors, so an invalid aggregate cannot be manufactured.
- **Per-test isolation** — SQL Server: transaction per test, rolled back, for non-DDL tests; a fresh tenant schema for DDL tests. Neo4j: one database (Community has only one — ADR-0009), so per-test isolation is a **fresh per-test tenant slug**, its label and constraints created at setup and removed in teardown by the product's own de-provisioning path — the filtered `DETACH DELETE` plus the completeness proof of ADR-0009 rule 6, so every graph test exercises that proof once. Qdrant: a per-test collection named from the test id. Redis: a per-test key prefix, `FLUSHDB` on a dedicated logical database in teardown.
- **Teardown is asserted, not assumed.** A `afterAll` hook verifies zero leaked schemas, collections, key prefixes and graph tenant labels — for the graph, zero nodes matching either encoding, since the label and the property are two independent things to leak. A suite that leaks fails.
- **E2E** — restores the seed between spec files rather than between tests, and every E2E spec is written to be order-independent within its file. Specs that mutate seeded fixtures the wiring tests depend on (the breaker, the pending promotion, the template) run in a dedicated shard against a restored stack.
- **Clock** — a controllable clock port. The WhatsApp 24-hour window, retention purges, wait-time routing and breaker cooldowns are all time-dependent; none of them is tested with `sleep`.

### 4.4 Two tenants minimum, and why it is a floor not a target

**Isolation is untestable against one tenant.** With a single tenant, every query returns the right data by accident, and a missing tenant filter is indistinguishable from a correct one. The Compose stack therefore provisions all four seeded tenants, and the isolation suite (§5) always runs with at least `sewa` and `customs` populated with structurally identical, value-distinct data — same agent names, same source names, same entity labels, different values — so a leak produces a *wrong value* rather than an empty result. An empty result is ambiguous; a wrong value is a failure.

---

## 5. Tenant isolation suite — the release gate

`isolation/tenant-isolation.spec.ts` and its per-store companions. ADR-0002 names it as a required test and `NFR-SEC-24` makes it a release gate. **This suite gates every phase, not only release.** If it is unrun or failing, the slice is not done and the release is not a release.

It runs against the Compose stack with at least two provisioned tenants (§4.4). It asserts against the stores directly as well as through the API, because retrieval output is what gets quoted back to a citizen (`NFR-SEC-21`).

### 5.1 The case matrix

**34 cases:** the 18 store, forgery, principal-confusion, half-provisioned and escape-hatch cases below, plus the **16-case graph set** of §5.2, which case 3 delegates to.

The shape of this suite is no longer symmetric across the four stores, and that asymmetry is deliberate. ADR-0009 removed the graph's infrastructure boundary: SQL Server, Qdrant and Redis are each defended by a physical isolation unit a scoped handle cannot address past, so a small number of cases per store proves a property that is true by construction. The graph is defended by code — a label, a predicate, a builder and a post-filter — and a code property is only proved on the paths actually exercised. **The weakest store therefore carries the most cases.** That inversion is the point, not an accident of how the suite grew.

| # | Case | Store(s) | Requirement |
|---|---|---|---|
| 1 | Cross-tenant **read** — principal A reads B's agents, users, sources, transcripts, transactions, audit | SQL Server | NFR-SEC-15, NFR-SEC-18 |
| 2 | Cross-tenant **write** — principal A creates/updates/deletes a record in B's schema | SQL Server | NFR-SEC-15 |
| 3 | Cross-tenant **graph access** — **not one case.** Delegates to the 16-case graph set in §5.2: a negative test per query path the adapter exposes, plus the structural, constraint, post-filter, slug and query-builder cases. Logical isolation cannot be proved store-wide the way the other three can | Neo4j | NFR-SEC-15, NFR-SEC-21, NFR-SEC-25 |
| 4 | Cross-tenant **vector retrieval** — a search in A's collection returns no point, score, payload or citation from B | Qdrant | NFR-SEC-21 |
| 5 | Cross-tenant **cache read** — A reads a session, breaker, rate-limit counter or campaign queue entry under B's prefix | Redis | NFR-SEC-15 |
| 6 | Forged tenant in **request body** | all | NFR-SEC-16 |
| 7 | Forged tenant in **header** (including `X-Tenant`, and a spoofed internal header on the web→ai hop) | all | NFR-SEC-16, NFR-SEC-03 |
| 8 | Forged tenant in **query string** | all | NFR-SEC-16 |
| 9 | Forged tenant in **route parameter** | all | NFR-SEC-16 |
| 10 | **Principal from A holding an id from B** — a valid `sewa` principal supplies a valid `customs` agent id, source id, ticket id, transaction id, golden-set id, skin id. Must 404 or 403, never 200, and never a cross-schema join | SQL Server, Neo4j, Qdrant | NFR-SEC-16, NFR-SEC-17 |
| 11 | **Injection payload in a tenant field** — `sewa; DROP SCHEMA customs`, `../customs`, `sewa_knowledge`, a Cypher fragment. Rejected at slug validation before any handle is built | all | FR-PLAT-03, NFR-SEC-19 |
| 12 | **Half-provisioned tenant** — a tenant whose SQL schema exists but whose graph label indexes and composite constraints were never created (and each of the other three permutations). Requests fail closed with a provisioning error; they never fall back to another tenant's store, to an unscoped handle, or — the graph-specific failure ADR-0009 introduces — to a **label that matches nothing and returns an empty result that reads as "no data"** | all | FR-PLAT-02, ADR-0002 rule 6, ADR-0009 |
| 13 | **Context propagation** — the tenant survives an async continuation, a background task spawned from a request, and a streamed SSE response that outlives the handler | all | NFR-SEC-17 |
| 14 | **No unscoped client is exported** — static assertion over both runtimes' module surfaces | — | NFR-SEC-18 |
| 15 | **Escape hatch 1: tenant provisioning** — denied to every non-Super-Admin role; on success writes exactly one audit entry naming actor, hatch and scope | SQL Server | FR-PLAT-08, NFR-SEC-20 |
| 16 | **Escape hatch 2: cross-tenant analytics rollup** — same denial and audit assertions; and no feature-module analytics query spans more than one tenant | SQL Server | FR-PLAT-08, FR-ANLY-13, NFR-SEC-20 |
| 17 | **No third path** — enumerate the route table and the data-access surface; exactly two cross-tenant paths exist | — | NFR-SEC-20 |
| 18 | **Branding does not bleed** — load the same route as principals of two tenants in sequence, including through the shared cache and with a warm CDN edge | SQL Server, Redis | NFR-SEC-22, FR-THEME-15 |
| 19 | **Retention/erasure/residency are per tenant** — A at 30 days and B at 1 year purge independently, verified in all four stores | all | NFR-SEC-23, FR-GOV-28 |

### 5.2 The graph case set — a negative test per query path

`ai/knowledge/test_graph_isolation_int.py`, `ai/knowledge/test_graph_query_builder.py`, `ai/knowledge/test_graph_post_filter_int.py` and `isolation/graph-isolation.spec.ts`, against a real single-database Neo4j Community instance holding `sewa` and `customs` side by side with structurally identical, value-distinct entities (§4.4).

**Why per path rather than per store.** Under ADR-0002 the graph case asserted that a connection opened against database A could not see database B. That was true by construction; one shallow test was adequate evidence because the boundary was infrastructure and there was nothing for a code path to get wrong. ADR-0009 removed that boundary. What remains is a label, a `tenant_id` predicate and a builder that emits both — which means **every distinct query path is an independent opportunity to omit scoping**, and a single "A cannot read B's graph" test proves only that the one path it happened to call was scoped. There is no database-level RBAC to catch the others, because Community has none (ADR-0009 context table, row 2). So the convention is: **one negative test per query path the `GraphStore` port exposes, and a new path ships with its negative test or it does not ship.**

Cases G1–G10 are the paths. Each drives the path as a principal scoped to `sewa`, against data seeded in both tenants, and asserts the `customs` value is unreachable through *that specific path* — not merely absent from some other path's result.

| # | Graph case | Path under test | Requirement |
|---|---|---|---|
| G1 | **Entity read by key** — `sewa` reads `Provider {key: 'sewa'}`; the identical `customs` key is unreachable and returns not-found, never the other tenant's node | `get_entity` | NFR-SEC-15, NFR-SEC-25 |
| G2 | **Entity search** — a label/text search for a term both tenants match returns only `sewa` nodes, and the result count equals the `sewa` count, not the union | `search_entities` | NFR-SEC-15, FR-KNOW-08 |
| G3 | **Neighbour traversal** — one-hop neighbours of a `sewa` node exclude every `customs` node, including nodes reachable only if an edge were mis-scoped | `neighbours` | NFR-SEC-15, FR-KNOW-07 |
| G4 | **Multi-hop traversal** — the deepest seeded traversal (`Service → Provider → Fee`) stays inside `sewa` at **every** hop, asserted per hop rather than on the final result, because a mid-traversal escape can still return a scoped-looking endpoint | `traverse` | NFR-SEC-15, FR-KNOW-06 |
| G5 | **Duplicate detection** — the candidate list for a `sewa` entity never proposes a `customs` node as its duplicate. This is the path where an unscoped query is *most* plausible, because similarity is naturally global | `find_duplicates` | NFR-SEC-15, FR-KNOW-09 |
| G6 | **Merge** — a merge attempted across tenants is refused before any write; a merge inside `sewa` redirects only `sewa` edges and citations, and leaves `customs` untouched byte for byte | `merge_entities` | NFR-SEC-15, FR-KNOW-09 |
| G7 | **Node creation** — a node written as `sewa` carries `:Tenant_sewa` **and** `tenant_id: 'sewa'`; a caller that supplies a `customs` `tenant_id` in the payload is refused, not honoured — the context wins over the argument (`NFR-SEC-17`) | `create_entity` | NFR-SEC-15, FR-KNOW-10 |
| G8 | **Edge creation** — an edge between a `sewa` node and a `customs` node is rejected at the adapter. A cross-tenant edge is invalid by definition (ADR-0009 data shape) and this is the only path that could create one | `create_relationship` | NFR-SEC-15, FR-KNOW-06 |
| G9 | **Deletion** — a delete issued as `sewa` cannot remove, detach or orphan a `customs` node, including via `DETACH DELETE` on a node whose id was supplied by the caller | `delete_entity`, `deprovision_tenant` | NFR-SEC-15, FR-PLAT-04 |
| G10 | **Retrieval subgraph match** — the subgraph blended into Graph RAG for a `sewa` question contains no `customs` node, edge or attribution, asserted on the matched subgraph itself and again on the citation set the citizen sees | `match_subgraph` | NFR-SEC-21, FR-KNOW-24 |
| G11 | **Label and property agree** — a reconciliation query asserts that **no node exists whose label set and `tenant_id` disagree, and none exists with neither**. Two encodings are only defence in depth while they are kept in step; a node with one of them is a node one defect away from being visible (ADR-0009 rule 5) | — | NFR-SEC-15 |
| G12 | **No cross-tenant edge exists** — asserted over the whole database, not per tenant, after the full seed and after every write-path suite has run | — | NFR-SEC-15 |
| G13 | **Composite constraints behave** — `sewa` and `customs` may each hold a `Provider` named `SEWA` without collision, **and** a second `Provider` named `SEWA` inside `sewa` is still rejected. Both halves are the assertion: a constraint relaxed from `key` to `(tenant_id, key)` is easy to relax into nothing | — | NFR-SEC-15, FR-PLAT-02 |
| G14 | **Post-retrieval re-filter, proved on its own** — a graph result carrying a foreign `tenant_id` is **injected at the adapter boundary**, downstream of the builder, and must be dropped before it can ground an answer: absent from the merged context, absent from the citations, and the drop recorded. This is the case that makes "defence in depth" a tested claim rather than an architectural assertion — without it, the post-filter is only believed to work because the builder never gives it anything to catch (ADR-0009 rule 4) | — | NFR-SEC-25, NFR-SEC-21 |
| G15 | **Slug validation closes the label-injection path** — labels are interpolated into Cypher by construction, so a forged or malformed slug is the one injection vector this design opens. `Tenant_sewa) MATCH (n`, `sewa OR 1=1`, `Tenant_*`, an empty slug, a 40-character slug, a slug with a hyphen or a space, and a well-formed slug absent from the tenant registry are each rejected at validation against `^[a-z][a-z0-9_]{1,30}$` **before** a label is built (ADR-0009 rule 3) | — | NFR-SEC-19, FR-PLAT-03 |
| G16 | **The query builder itself** — a unit suite over the builder, which ADR-0009 makes security-critical code. For **every** operation G1–G10 exposes, the emitted Cypher contains both the `:Tenant_<slug>` label and the `tenant_id` predicate — including when the caller passes an **empty filter**, a `None` filter, and a filter that already mentions `tenant_id`. The builder must have no code path that emits a query without both, and the suite is parametrised over the operation list so that adding an operation without a case fails the suite | — | NFR-SEC-25, NFR-SEC-18 |

G16 is a unit test and the only case in this suite that touches no store. It is here rather than in §2.1 because it is isolation evidence, and because a builder tested away from the isolation suite is a builder whose failure nobody reads as a leak.

The per-path parametrisation is written the way §6.6's per-node escape test is written, and for the same reason:

```python
# ai/knowledge/test_graph_isolation_int.py
@pytest.mark.covers("NFR-SEC-15", "NFR-SEC-21", "NFR-SEC-25")
@pytest.mark.parametrize("path", GRAPH_QUERY_PATHS)   # every method on the GraphStore port
async def test_no_graph_query_path_reaches_another_tenant(path, graph, seeded_two_tenants):
    # both tenants hold a Provider named "SEWA" with different fee values
    result = await path.invoke(as_tenant="sewa")

    assert result.nodes                                        # proves the path ran
    assert {n.tenant_id for n in result.nodes} == {"sewa"}     # proves the predicate held
    assert all(f"Tenant_sewa" in n.labels for n in result.nodes)   # proves the label held
    assert CUSTOMS_FEE_VALUE not in result.values()            # proves no bleed
```

`GRAPH_QUERY_PATHS` is derived from the `GraphStore` port's method list, not hand-written. **A path added to the port with no entry appears as a missing parametrisation and fails the suite** — which is the only mechanical defence available against the failure mode §16.4 describes.

### 5.3 The assertion shape

Wrong-value-not-empty-result, as argued in §4.4:

```ts
// isolation/vector-retrieval.spec.ts
covers("NFR-SEC-21", "FR-KNOW-24");

it("retrieval in sewa never surfaces a customs passage", async () => {
  // both tenants seed a source named "Tariff schedule" with different values
  const asSewa = await api.as(principals.sewaKnowledgeManager).retrieve("tariff");

  expect(asSewa.passages).not.toHaveLength(0);              // proves the query ran
  expect(asSewa.passages.map(p => p.tenant)).toEqual(       // proves it was scoped
    Array(asSewa.passages.length).fill("sewa"),
  );
  expect(asSewa.text()).not.toContain(CUSTOMS_TARIFF_VALUE); // proves no bleed
  expect(asSewa.citations.every(c => c.chunk.tenant === "sewa")).toBe(true);
});
```

An empty result would pass a naive version of this test while proving nothing. The first assertion is what makes the third meaningful.

### 5.4 RISK-003 is closed; RISK-024 replaces it

**RISK-003 resolved in the negative: there is no Neo4j Enterprise licence.** ADR-0009 amends ADR-0002 for the graph store only, and the graph portion of this suite is **no longer blocked** — G1–G16 are writable today against Neo4j Community. The other three stores are untouched: SQL Server schema-per-tenant, Qdrant collection-per-tenant and Redis key-prefix all keep their physical isolation units and their existing cases.

What changed is not whether the tests can run but what a green run means. Cases 1, 2, 4 and 5 assert a boundary the infrastructure enforces. G1–G16 assert that sixteen specific code paths were scoped on the day the suite ran. That is a materially weaker claim about a store holding materially the same data, and it is carried as a standing risk — **RISK-024**, §16.4 — rather than a resolved one.

---

## 6. Testing the agent runtime

The hardest part of the system, and where a generic test strategy fails. Everything here runs with `ChatModel` stubbed (§3) and asserts **pipeline behaviour**.

### 6.1 The deterministic model stub

```python
# ai/testing/stub_chat_model.py
class StubChatModel(ChatModel):
    """Scripted ChatModel. Keyed by (scenario, hop) so a test can script a
    multi-hop conversation: tool call, then error, then final answer.

    Why: the orchestrator's correctness is *ordering and dispatch*, which is
    deterministic; the token text is not. We assert the former and script
    the latter. See testing.md §3.
    """

    def __init__(self, script: dict[tuple[str, int], ChatTurn]) -> None:
        self._script, self._hops, self.calls = script, defaultdict(int), []

    async def complete(self, request: ChatRequest) -> ChatTurn:
        hop = self._hops[request.scenario]
        self._hops[request.scenario] += 1
        self.calls.append((request.model, request.scenario, hop))
        turn = self._script[(request.scenario, hop)]
        if isinstance(turn, Exception):
            raise turn                  # drives the fallback path — §6.3
        return turn
```

`self.calls` is the assertion surface for model identity: it is how `FR-AGENT-11` (primary model changed by configuration, no redeploy) and `FR-AGENT-12` (fallback invoked) are proved without a real provider.

### 6.2 Pipeline behaviour — the six structural stages

`ai/orchestration/test_pipeline_stages.py` asserts the pipeline of `FR-ORCH-01` and `architecture.md` §7: **guardrail pre-check → route → execute → merge → guardrail post-check → stream + persist.**

- Every stage appears on the persisted trace, in order, for every turn.
- The stages are **structural, not conditional**. `FR-ORCH-14` is tested by attempting to remove the guardrail stages three ways — through the API, through a per-agent override, and by editing the policy row directly in the database — and asserting all three leave the stages running. The third case is the one that matters: it proves the check is code-structural rather than data-driven.
- A turn that skips a stage must be unconstructible; the test asserts on the trace's stage set being exactly the six, not merely containing them.

### 6.3 Execution modes, each with its own trace

`ai/orchestration/test_execution_modes.py` — one test per mode, asserting the *distinct* trace, because the modes' observable difference is their trace shape (`FR-ORCH-02`…`05`, `FR-ORCH-11`).

| Mode | Asserted trace shape |
|---|---|
| **Sequential** | `router → billing_agent` → `get_bill_status()` → hand to knowledge agent → merge preserving invocation order. Exactly one agent active at a time |
| **Parallel** | Two agents invoked concurrently (asserted by overlapping start/end timestamps from the controlled clock, not by wall time), one merged reply, no duplicated statement, turn latency bounded by the slower agent rather than their sum |
| **Supervisor–worker** | An explicit plan node (`fetch bill → check eligibility → prepare payment link`), one delegation per sub-task, a supervisor review step **before** the reply is emitted |

`FR-ORCH-12` runs the same prompt through all three and asserts the ordering property, not absolute numbers: parallel has the lowest latency, supervisor–worker the highest token cost.

### 6.4 The fallback model path has its own test

ADR-0004 rule 4: *an untested fallback is not a fallback.* `ai/orchestration/test_model_fallback.py`:

- Primary model raises → fallback answers → trace names **both** models and the trigger (`FR-AGENT-12`).
- Primary model times out (controlled clock, not a real delay) → same assertions, different recorded trigger.
- Fallback also fails → the turn terminates with the configured fallback *behaviour*, records the reason, and does not hang or return a partial stream as if complete.
- Fallback is invoked at most once per hop — a retry storm across two models is an incident, not a resilience feature.
- The fallback is drawn from the agent version record, not a hardcoded default (`FR-AGENT-11`).

### 6.5 Tools — retries, fall-through, and the breaker consulted first

`ai/tools/test_tool_dispatch_int.py`, `ai/flows/test_tool_call_node.py`:

- **Breaker before the call.** With the seeded SEWA breaker `Open`, **no outbound request is made at all** — asserted on the stub HTTP transport's call count being zero, not on the response body — and the fallback is served within the fast-fail budget, with the decision on the trace (`FR-TOOL-14`). Ordering is the assertion: a breaker consulted *after* the call passes a naive response-shape test and fails this one.
- **Retry-then-fall-through.** Force two consecutive `get_bill_status` timeouts: exactly **two** attempts occur (not one, not three), the flow follows its configured fall-through edge, the conversation does not terminate, and the attempt count is on the trace (`FR-FLOW-05`).
- **Binding, not discovery, confers callability.** A discovered-but-unbound tool is rejected at invocation with a permission error, recorded on the trace — asserted by a **direct runtime invocation**, not through the UI, because the UI never offers it and so proves nothing (`FR-TOOL-07`).
- **Breaker state is shared.** Trip on replica A; replica B takes the fallback on its next call with no restart and no local timer (`FR-TOOL-18`) — a two-replica integration test against real Redis.
- **Cached-while-degraded.** With the breaker open, a 23-hour-old answer is served and labelled cached; a 25-hour-old one is not, and the degraded path is taken instead (`FR-TOOL-16`).

### 6.6 Free-text escape at every node

Brief requirement R3 and `FR-FLOW-07`. **The escape is asserted node by node, from each of the five node types — not once, and not only from the node the wireframe demonstrates.**

```python
# ai/flows/test_free_text_escape.py
@pytest.mark.covers("FR-FLOW-07", "FR-FLOW-09", "FR-CONV-15", "FR-ORCH-13")
@pytest.mark.parametrize("node_id,node_type", SEEDED_FLOW_NODES)  # all 5 types
async def test_escape_from_every_node_preserves_context(node_id, node_type, runtime):
    convo = await runtime.drive_to_node("pay_utilities_bill", node_id)
    filled_before, awaiting_before = convo.slots.filled, convo.slots.awaiting

    trace = await convo.turn("i have another inquiry")

    assert trace.stage("flow") == "escape_triggered"      # left the flow
    assert trace.routing_decision is not None             # router re-opened
    assert convo.slots.filled == filled_before            # context preserved
    assert convo.slots.awaiting == awaiting_before        # resumable at the same node

    await convo.turn("back to my bill please")
    assert convo.active_flow_node == node_id              # resumed, not restarted
```

The parametrisation is the point: `no node can trap the user` is a property of every node type, and a single-node test would leave four untested. The `Question` node with a graph-bound option list and the `Tool call` node mid-retry are the two that a naive implementation traps.

### 6.7 Slots and step-up ordering

- Slot state is exposed on the trace including the awaited slot (`FR-FLOW-08`), and transfers intact with an escalation (`FR-HAND-17`).
- **Step-up pauses before the tool call, never after.** `ai/verification/test_step_up_ordering.py` asserts on the trace's *event ordering*: the L2 assurance record's timestamp precedes the payment tool invocation. The test is written so that it **fails if the tool is invoked first**, even when the end state is identical — because a system that charges then verifies produces the same final record as one that verifies then charges (`FR-FLOW-11`, `FR-VERI-07`, `FR-PAY-06`).
- The gated-action ladder L0–L3 is exercised in full against the mock, including failure, timeout and provider-unavailable (`FR-VERI-08`).
- Account-ownership refusal happens **before any tool call** (`FR-VERI-05`) — the single most consequential toggle in the system, and it has its own negative test with a zero-outbound-call assertion.

### 6.8 Guardrails

`ai/governance/test_guardrails_int.py`:

- **Refusal below grounding confidence** — at 59% against a 60% threshold, the answer is withheld, a human offered where staffed, and the trace names the policy, the measured confidence and the threshold (`FR-GOV-05`, `NFR-OBS-07`).
- **PII masked before persistence.** The assertion is **on the stored record, not on the response.** A turn containing an Emirates ID, an account number and a card number is submitted; the test then reads the transcript row, the trace's tool arguments, the vector payload and the graph attribution directly from the stores and asserts the raw values are absent from all four. Asserting on the API response would pass while unmasked text sat in the database (`FR-CONV-13`, `FR-GOV-03`, `NFR-DATA-08`).
- **Prompt injection through retrieved content** — a retrieved passage carrying "ignore all previous instructions" does not change behaviour, and the block is recorded (`FR-GOV-04`, `NFR-SEC-06`).
- **A locked policy toggle is rejected, not silently ignored.** This distinction is the test: attempting to disable PII masking or the injection filter returns an explicit refusal with an audit entry, for **every** role including Super Admin. A implementation that accepts the write and ignores it fails, because the operator would believe the change took effect (`FR-GOV-02`, `FR-GOV-09`).

### 6.9 Ceilings, cost, and the stream

- **Hop, loop and cost ceilings** (`FR-ORCH-07`, `FR-ORCH-08`): a deliberately looping configuration terminates at the ceiling, records the reason, returns the fallback. A turn exceeding the cost ceiling terminates with a trace entry naming the ceiling and the accumulated cost. Per-call token accounting is asserted per model call against tenant, agent and conversation (`NFR-OBS-06`).
- **SSE assertions** (`FR-CONV-10`, `NFR-PERF-05`):

```ts
// contract/turn-stream.contract.spec.ts
covers("FR-CONV-10", "NFR-PERF-05", "NFR-A11Y-06");

it("emits events in contract order and terminates exactly once", async () => {
  const events = await collectSse(post(`/v1/conversations/${id}/turns`, turn));
  expect(events.map(e => e.event)).toEqual([
    "processing", "routed", "token", "token", "sources", "trace", "done",
  ]);
  expect(events.filter(e => e.event === "done")).toHaveLength(1);
});

it("emits a terminal error frame mid-stream, never a truncated success", async () => {
  const events = await collectSse(post(url, turn, { scenario: "fail-after-2-tokens" }));
  expect(events.at(-1)).toMatchObject({ event: "error", data: { retryable: false } });
  expect(events.map(e => e.event)).not.toContain("done");
});

it("stops generation and persists the partial turn on client disconnect", async () => {
  const stream = openSse(url, turn);
  await stream.waitFor("token");
  await stream.abort();
  await expect.poll(() => stubChat.activeCalls).toBe(0);   // generation stopped
  await expect.poll(() => turnRow(id).status).toBe("abandoned"); // persisted, not lost
});
```

Client disconnect matters commercially as well as correctly: a stream nobody is reading that keeps calling a paid model is a cost leak.

---

## 7. Testing Graph RAG

Retrieval **mechanics** and retrieval **quality** are different things, tested by different suites with different gating behaviour. Conflating them is how a RAG test suite becomes both flaky and uninformative.

### 7.1 Mechanics — deterministic, blocking

`ai/knowledge/test_retrieval_int.py` and companions, against real Neo4j and Qdrant, with a deterministic stub embedder and a controllable stub reranker.

Neo4j Community is single-instance, so the graph is a single point of failure for graph-grounded retrieval (ADR-0009, Availability). Two cases below exist because of that, and they are written the same way the rerank-outage case is written — the degradation is a *tested product behaviour*, not an operational hope.

| Assertion | Requirement |
|---|---|
| Hybrid weighting **actually shifts results** — 60/40 and 80/20 return demonstrably different rankings for the same query, not merely a different displayed label | FR-KNOW-12 |
| Top-K is honoured exactly — K=8 returns 8, K=3 returns 3, and K is read per tenant | FR-KNOW-11 |
| The reranker toggle **changes order** — the stub reranker is scripted to invert, so "on" must produce the inverted order and "off" the hybrid order | FR-KNOW-11 |
| **Rerank failure degrades to unreranked rather than failing the conversation** — provider unavailable → results still returned, turn still completes, trace records the skip. A rerank outage never fails a citizen conversation | FR-KNOW-14, ADR-0004 rule 6 |
| **Citations resolve through SQL Server** — delete a chunk from the system of record, leave its vector in Qdrant, retrieve: the stale vector must not produce a citation. A fabricated citation is worse than a missing answer | FR-KNOW-17, ADR-0003 rule 3 |
| **Changing the embedding model forces a full re-index** — a confirmation naming the consequence, a full re-index job enqueued, and a collection-metadata assertion that two models' vectors never coexist | FR-KNOW-13, ADR-0004 rule 3 |
| **Duplicate merge** — edges and citations redirect to the survivor with zero dangling references; ignore suppresses the candidate until its supporting data changes | FR-KNOW-09 |
| **Conflict resolution lowers grounding confidence** — an answer over a conflicted entity reports lower confidence than the same answer after resolution, by enough to trip a 60% refusal threshold | FR-KNOW-21, FR-KNOW-26 |
| **Recency is not enough** — the library-membership fixture: `Prefer most recently updated` selects the *wrong* value, `Prefer owning entity` selects the right one. Both asserted | FR-KNOW-22 |
| **Graph unavailable degrades to vector-only, and the conversation does not fail** — stop Neo4j mid-suite; retrieval falls back to **vector-only from Qdrant**, the turn still completes, the citizen gets an answer with citations from the passages that remain, the degradation is recorded on the trace and surfaced, and grounding confidence drops — correctly making the 60% refusal and the escalation paths *more* likely rather than serving an ungrounded answer. Asserted as the ordered pair: same question, graph up then graph down, confidence strictly lower the second time. **A citizen conversation must never fail because the graph is down** (ADR-0009, Availability) | FR-KNOW-14, FR-GOV-05, NFR-DATA-01 |
| **Rebuild by re-index is the primary graph recovery path** — the graph is derived (ADR-0003 rule 1), and under ADR-0009 a restore is an optimisation rather than a dependency, so re-index is what is tested. Delete every node for one tenant, re-index through the product's own B6 mechanism, and assert the graph returns correctly: node and edge counts match, every node carries both encodings in agreement (G11), no cross-tenant edge appeared during the rebuild, traversals and attributions resolve as before, and the other tenants' subgraphs were not touched while it ran | FR-KNOW-23, NFR-DATA-01, NFR-DATA-10 |
| **Full rebuild from the system of record** — drop both derived stores for a tenant, re-index through the product's own mechanism, assert retrieval and citations return to their prior state | FR-KNOW-23, NFR-DATA-01 |
| **Write ordering** — system-of-record first, then derived, via outbox; a derived-write failure leaves SQL correct and the outbox item pending; no two-phase commit exists in the codebase (static assertion) | FR-KNOW-25, NFR-DATA-09 |

### 7.2 Quality — non-blocking, tracked as a trend

`eval/retrieval_quality.eval.py`. A small labelled retrieval set — **[ASSUMPTION]** 120 query/relevant-chunk pairs, 60 English and 60 Arabic, drawn from the seeded corpus and hand-labelled once — scored on **recall@5**, **recall@10** and **MRR**, per language.

It reports a trend against the last N runs and a floor agreed by the team (**[ASSUMPTION]** recall@10 ≥ 0.85 EN, ≥ 0.78 AR at the start of Phase D, ratcheted up as the corpus grows). A drop below the floor blocks a *release* by human decision; it never blocks a commit, because retrieval quality moves when the corpus changes, when the embedding model changes and when the provider silently updates, none of which are code defects.

The English/Arabic split is not decoration: it is the measurement that decides RISK-001's self-hosted-BGE-M3 spike.

---

## 8. Evaluation: product feature vs our test suite

Two different things wear the word "evaluation" in this project, and conflating them produces a suite that tests neither.

**8.1 B13 is a product feature.** Golden sets, regression runs and the publish gate are functionality SHJ3 ships to its users, and they are tested exactly like any other feature — deterministically, with the model stubbed, at unit/integration/E2E level:

- A golden set's stored case count equals the number of its cases after a batch of additions (`FR-EVAL-14`).
- A run produces one record per agent/set pairing, prepended, never overwriting (`FR-EVAL-06`).
- The gate's five conditions are **independently** effective — disabling one does not disable the others (`FR-EVAL-07`).
- The gate reads the *most recent run for the exact version being published*, and blocks when none exists (`FR-EVAL-11`).
- The red-team requirement is absolute: 96% blocks even with accuracy 99% and groundedness 95% (`FR-EVAL-12`).
- The block message names **every** failing condition with its score and threshold — not the first (`FR-EVAL-08`, `FR-EVAL-09`, RISK-007).

The scores these tests operate on are **fixtures**. `ai/evaluation/test_publish_gate.py` asserts gate arithmetic against a seeded run record of 71%; it does not run a model to get 71%. That is what makes the gate's logic testable at all.

**8.2 Our own model-quality evaluation** is a separate, non-blocking suite (§7.2, plus `eval/answer_quality.eval.py` for accuracy, groundedness and tool-selection correctness against the seeded golden sets using real providers). It answers "is the assistant good", which is a product question with a moving answer. It does not gate a commit and is never used to justify a code change without investigation.

**8.3 Arabic parity is a first-class quality gate in both.** The requirements deliberately hold Arabic readiness as **two distinct numbers** — 82% translation completeness (`NFR-I18N-03`, from the message catalogue) and 71% test accuracy (B13 tab 2, the Arabic language parity golden set). They block for different reasons and must be reported separately (RISK-007). In the product suite, both gates are asserted independently and the combined block message is asserted to name both. In our evaluation suite, Arabic is scored on every run alongside English and never averaged into a single number, because an average hides a 71% behind a 95%.

---

## 9. E2E scenarios

### 9.1 The primary journey

`e2e/journeys/pay-utilities-bill.spec.ts` — the wireframe's own worked example, normative as a journey (`requirements.md` §2.4, `architecture.md` §8):

```
Pay Utilities Bills → SEWA → account number → "i have another inquiry"
```

It is the primary E2E because **every screen is fed by it**. One spec, walked in steps, asserting at each:

1. Widget opens docked; disclaimer banner from channel config; five configured chips (`FR-CONV-01`…`03`).
2. Tap *Pay Utilities Bills* → processing state within 300 ms → streamed reply (`FR-CONV-10`).
3. Trace rail shows `router → billing_agent (confidence 0.94)`, `get_bill_status(provider="SEWA")`, `awaiting slot: account_number` (`FR-CONV-07`, `FR-ORCH-11`).
4. Sources rail names the SEWA tariff schedule and the traversed entity path; step 1 states no grounding was required (`FR-CONV-08`).
5. Account number supplied → step-up requested **before** the payment tool is called (`FR-FLOW-11`, `FR-VERI-07`).
6. `"i have another inquiry"` → escape fires, context preserved, router re-opens (`FR-CONV-15`, `FR-ORCH-13`).
7. Return to billing → flow resumes at `account_number` with prior slots intact (`FR-FLOW-09`).
8. Thumbs-down → the conversation appears in B1 tab 3's feedback queue (`FR-CONV-12`, `FR-ANLY-09`).

`e2e/journeys/demo-path.spec.ts` walks the guide's §9 nine-step demo path end to end as a single spec — launcher, conversation, wizard step 4 MCP connect, three orchestrator modes, conflict resolution then playground, ticket then rule reorder then tester, ownership toggle then step-up rules, gate blocking General FAQ v3.0, approve promotion then audit log. It is the smoke test that the system holds together as one system, and it is the spec that fails first when a seam breaks.

### 9.2 Permissions — one spec per role, asserting presence **and absence**

`e2e/roles/{super-admin,entity-admin,agent-designer,knowledge-manager,reviewer,live-agent,analyst}.spec.ts`. Seven specs, walking the 7×8 matrix of B9 tab 3.

Each spec asserts, for its role: every navigation item and control it **should** see is present and functional; every one it should **not** see is absent; and — the part that matters — **every hidden control's endpoint returns 403 when called directly**. A UI that hides a button is presentation; `NFR-SEC-01` and `FR-IAM-12` require the server to refuse. The canonical case is `agent-designer.spec.ts`: complete the wizard through step 9, then be refused server-side at publish with an error naming the missing permission (`FR-IAM-11`, `FR-AGENT-19`). `live-agent.spec.ts` asserts the inverse pair — queue access granted, dashboard absent *and* 403.

### 9.3 The rest

| Spec | Asserts |
|---|---|
| `e2e/journeys/whatsapp-window.spec.ts` | Channel-native rendering (chips → list-message rows), opt-in notice, opt-out keyword, free-form reply inside the 24-hour window, refusal outside it, template send succeeding outside it, window state surfaced in the thread (`FR-CHAN-11`, `FR-CHAN-20`…`22`) |
| `e2e/journeys/voice-and-handover.spec.ts` | Interim transcription preview marked not-sent, correction, commit; escalation banner with queue position; composer paused; full transcript + assurance level + pending slot arriving in the agent workspace; system note at the handoff point (`FR-CONV-09`, `FR-CONV-11`, `FR-HAND-06`, `FR-HAND-17`) |
| `e2e/backoffice/agent-wizard-publish.spec.ts` | All ten wizard steps, non-linear navigation with state persisting, sandbox turn using the real pipeline, publish incrementing the version with a mandatory change summary (`FR-AGENT-08`…`18`) |
| `e2e/backoffice/blocked-publish.spec.ts` | General FAQ v3.0 refused, message naming agent, version, failing set, score **and** threshold — and naming both Arabic failures (`FR-EVAL-08`, `FR-EVAL-09`, `FR-AGENT-20`) |
| `e2e/backoffice/theming.spec.ts` | Token change repaints every screen with no reload; skin duplicate/edit; export → import round-trip identical; a contrast-violating skin **rejected** naming the failing token pair and ratio; one-click restore reachable by keyboard from an unreadable theme (`FR-THEME-03`, `FR-THEME-09`…`12`, `FR-THEME-16`, `FR-THEME-17`) |
| `e2e/backoffice/rtl-arabic.spec.ts` | Full Arabic pass over all 17 screens: `dir="rtl"`, mirrored sidebar, wizard step strip, assistant thread, tables, graph canvas; AED and date formatting; fallback locale rendering for a missing string (`FR-THEME-08`, `NFR-I18N-02`, `NFR-I18N-05`, `NFR-I18N-06`) |
| `e2e/backoffice/user-guide.spec.ts` | Help control on every authenticated page, deep-link to the current page's entry, search scoped to permissions, EN/AR, route-vs-entry coverage at 100% (`FR-GUIDE-01`…`08`) |

---

## 10. Cross-module wiring tests

One row per wireframe §6 wiring row, and per `requirements.md` §6's eleven invariants — they correspond one-to-one. **These are the highest-value integration tests in the system**, because each is a place where a plausible implementation silently grows a second source of truth and both screens keep rendering.

Every one of these is a **differential** test: read state, act, read again, assert the change — plus a structural assertion that only one write path exists.

| Wireframe §6 action | Consequence asserted | Invariant | Spec | Layer |
|---|---|---|---|---|
| Bind an MCP tool in wizard step 4 | Present in the tools registry on the next read; unbind in the registry → absent in the wizard; exactly one persistence path exists | FR-TOOL-21 | `e2e/wiring/tool-binding-one-record.spec.ts` + `web/tools/binding-write-path.spec.ts` | E, U |
| Approve `appointment_confirmation` | Its campaign becomes enableable in the same read; withdraw approval → back to `Blocked` and sending stops; the campaign holds no copied approval flag | FR-CHAN-23, FR-CHAN-15 | `e2e/wiring/template-approval-unblocks-campaign.spec.ts` | E, I |
| Reassign a user's team | Users view and teams view agree on the next read; no independently writable membership relation exists | FR-IAM-18, FR-IAM-07 | `e2e/wiring/team-membership-projection.spec.ts` + `web/iam/membership-single-write-path.spec.ts` | E, U |
| Approve a pending promotion | Audit entry present on the next read, written **in the same transaction**; inject an audit-write failure → decision rolled back, promotion still pending; decision count equals audit count at all times | FR-GOV-29 | `web/governance/promotion-audit-atomicity.int.spec.ts` + `e2e/wiring/promotion-audit.spec.ts` | I, E |
| Add a transcript to a golden set | Case count +1 exactly, new case names the source conversation, duplicate submission rejected, stored count equals case count after a batch | FR-EVAL-14, FR-EVAL-03 | `e2e/wiring/add-to-golden-set.spec.ts` | E, I |
| Arabic parity at 82% / 71% | Gate blocks the bound agent **and names the reason** — locale and percentage read live from `channels`, no copied figure; raise to 100% → stops blocking with no evaluation-side edit | FR-EVAL-15, FR-EVAL-09 | `e2e/wiring/arabic-parity-gate.spec.ts` + `ai/evaluation/test_gate_reads_live_locale.py` | E, I |
| SEWA bill API shows `Degraded` | The breaker is `Open` serving the fallback, from **one** underlying state; reset the breaker → observability recovers once error rate does; no path produces `Healthy` alongside an open breaker | FR-TOOL-22, FR-GOV-20 | `web/governance/dependency-health-single-state.int.spec.ts` | I, E |
| Unresolved source conflict | Grounding confidence drops enough to trip the 60% refusal; resolve → the same question is answered; both confidence figures on both traces | FR-KNOW-26, FR-KNOW-21 | `ai/knowledge/test_conflict_lowers_confidence_int.py` | I |
| Handover node triggers in the flow | Exactly one ticket, carrying **that** trigger as its reason plus the measured confidence; no ticket without a trigger, no fired trigger without a ticket | FR-HAND-20, FR-HAND-05 | `ai/flows/test_handover_creates_ticket_int.py` | I, E |
| Reorder a routing rule | The tester returns a different route; then save and route a real ticket with identical attributes → outcomes match, because tester and router share one evaluation implementation | FR-HAND-21, FR-HAND-15 | `web/handover/rule-tester-parity.spec.ts` + `e2e/wiring/reorder-rule-tester.spec.ts` | U, E |
| Tool call fails twice | The tool-failure escalation reason on the ticket, naming the failing tool and both attempt outcomes; one failure → no ticket; a third attempt never occurs | FR-FLOW-12, FR-FLOW-05 | `ai/flows/test_tool_failure_escalation_int.py` | I |

---

## 11. Non-functional testing

### 11.1 Performance — `NFR-PERF`

Targets come from B14 tab 3's own figures, treated as the healthy baseline the system must hold. The SEWA bill API's **1,840 ms / 6.1%** is the *degraded* example — a breaker trigger, not a target.

| Reference (B14 tab 3) | Target | Profile |
|---|---|---|
| MCP gateway 240 ms p95 | ≤ 300 ms p95 | `nfr/perf/mcp-gateway.k6.js` |
| Graph RAG retrieval 310 ms p95 | ≤ 350 ms p95 at the tenant's configured top-K, reranking included | `nfr/perf/retrieval.k6.js` |
| WhatsApp BSP 190 ms p95 | ≤ 250 ms p95 | `nfr/perf/whatsapp-egress.k6.js` |
| SEWA bill API 1,840 ms / 6.1% (degraded) | > 1,500 ms **or** > 5% ⇒ `Degraded` + breaker open | `web/governance/degradation-thresholds.spec.ts` (U, not load) |

**Assistant-turn latency and backoffice page latency are separate budgets** and are load-tested separately, because they have different shapes: a turn is a long-lived streaming request bounded by time-to-first-token, and a page is a short request bounded by first meaningful content.

| Budget | Target | Profile |
|---|---|---|
| Assistant time-to-first-token | p95 ≤ 2,000 ms; processing state ≤ 300 ms | `nfr/perf/assistant-turn.k6.js` — ramp to **[ASSUMPTION]** 60 concurrent turns, 10 min steady |
| Backoffice first meaningful content | p95 ≤ 1,000 ms; interaction ≤ 100 ms | `nfr/perf/backoffice-screens.k6.js` — all 14 screens, including B9's 7×8 matrix and B1's explorer as the densest |
| Explorer pagination at volume | first page within the 1,000 ms budget at 100,000 conversations; no unbounded collection returned by any endpoint | `nfr/perf/explorer-at-volume.k6.js` + `gates/no-unbounded-list.gate.ts` |
| Re-index under conversational load | retrieval and first-token p95 both stay in budget during a full tenant re-index | `nfr/perf/reindex-under-load.k6.js` — **this is the demonstration that justifies the two-runtime split (ADR-0001) and it must actually be run** |
| Pooling at tenant count | 20 provisioned tenants under load stay inside SQL connection and Qdrant client ceilings; exceeding queues rather than failing the process | `nfr/perf/tenant-pooling.k6.js` |

All k6 profiles run with model providers stubbed behind a latency-injecting stub (§16), so the numbers measure SHJ3 and not OpenRouter.

### 11.2 Accessibility — `NFR-A11Y`

WCAG 2.1 AA on both surfaces. **axe-core on every page** in `nfr/a11y/*.a11y.spec.ts` — all 17 wireframe screens plus Settings → Appearance and the guide, in light and dark, LTR and RTL, giving 19 × 4 automated audits with zero AA violations required.

Automated audits do not cover keyboard models, so three organisms get hand-written keyboard walkthroughs because they are genuinely hard and axe will call them clean when they are not:

- **B9's 7×8 permission matrix** (`nfr/a11y/permission-matrix.a11y.spec.ts`) — a 56-cell grid of toggles. Asserts a coherent two-dimensional traversal model (arrow keys within the grid, Tab into and out of it as one stop, not 56), that each cell's accessible name carries **both** its role and its permission (a bare "on" is useless), and that toggling announces the new state.
- **B6's graph canvas** (`nfr/a11y/graph-canvas.a11y.spec.ts`) — an SVG node/edge graph. Asserts a keyboard traversal order over nodes, that a selected node's type, label, neighbours and supporting sources are announced, that entity search is operable and its result count announced, and that an accessible list equivalent of the subgraph exists.
- **B7's flow canvas** (`nfr/a11y/flow-canvas.a11y.spec.ts`) — asserts node selection, inspector focus management, edge relationships exposed as structure rather than as visual position, and that node reordering is achievable without a pointer.

Plus: `prefers-reduced-motion` honoured for streaming indicators, graph transitions and theme preview (`NFR-A11Y-05`); live-region announcements for streamed output, queue changes, job status and validation errors (`NFR-A11Y-06`); empty/loading/error/permission-denied states reachable and announced for every list, table and canvas (`NFR-A11Y-07`); chart figures exposed as an accessible table (`NFR-A11Y-08`).

**Status is never colour alone.** `nfr/a11y/status-not-colour.a11y.spec.ts` enumerates every badge state in the design system's status vocabulary — `Active`, `Invited`, `Suspended`, `Draft`, `Published`, `Archived`, `Live`, `Disabled`, `Approved`, `Pending review`, `Blocked`, `Passed`, `Failed`, `Healthy`, `Degraded`, `Open`, `Closed`, `Tested`, `Untested`, `Connected`, `Not connected` — and asserts each carries a text label. A greyscale visual-regression render is the second channel: `visual/status-greyscale.vr.spec.ts` must remain fully interpretable.

### 11.3 i18n / RTL — `NFR-I18N`

- **Layout mirroring** — `nfr/i18n/rtl-mirroring.i18n.spec.ts`: sidebar, wizard step strip, assistant thread bubble alignment, tables, graph canvas, breadcrumbs, all mirrored under `dir="rtl"`.
- **Bidirectional text** — Arabic containing embedded Latin (`SEWA`, `TXN-88213`, `v1.4`) and Latin containing embedded Arabic render with correct isolation and no visual reordering of identifiers. Tested as visual regression, because this is a rendering property.
- **AED formatting** — `AED 412.00` with locale-appropriate separators and an explicit currency code, from a UTC-stored exact decimal (`NFR-I18N-05`, `NFR-DATA-11`).
- **No physical CSS direction property ships** — `gates/logical-properties.gate.ts` fails the build on `margin-left`, `padding-right`, `left:`, `right:`, `text-align: left|right`, `border-left`, and their Tailwind physical equivalents, in feature code. Present in the first commit (`FR-THEME-19`, ADR-0007).
- **Translation completeness is computed** — adding an untranslated string lowers the reported percentage with no manual edit, and the publish gate's decision changes accordingly (`NFR-I18N-03`).
- **Missing string falls back and is counted** — renders in the designated fallback locale, visibly not an error, miss counter incremented (`NFR-I18N-06`).

### 11.4 Security — `NFR-SEC`

- **Authorisation matrix as tests** — `nfr/sec/authz-matrix.sec.spec.ts` enumerates the route table from the router definition and calls **every endpoint × every role × unauthenticated**, asserting deny-by-default. A new route with no server-side check fails the suite the moment it is added, because the enumeration is generated, not listed (`NFR-SEC-01`, `FR-IAM-12`).
- **Session revocation is immediate** — suspend a user holding a live session; the very next request returns 401, not at expiry. Reactivation does not restore the old session (`FR-IAM-03`).
- **Rate limits fail closed** — authentication, citizen turns, outbound sends and tool invocations, per principal and per tenant, returning 429 rather than a slow success (`NFR-SEC-07`). Login backoff and lockout are asserted with the controllable clock (`FR-IAM-13`).
- **WhatsApp webhook signature verification and replay protection** — `nfr/sec/whatsapp-webhook.sec.spec.ts`: an unsigned payload is rejected; a payload with a wrong signature is rejected; a **valid payload replayed** is rejected on the second delivery (nonce/timestamp window), because signature verification without replay protection is not protection.
- **Skin import as untrusted input** — `nfr/sec/skin-import.sec.spec.ts`: malformed JSON, schema-invalid fields, a `javascript:` URL in a logo reference, a CSS-injection payload in a token value, a 50 MB document, deeply nested objects, and a schema-valid skin that fails contrast. All rejected; **no partial import is ever applied** (`FR-THEME-11`).
- **Injection through retrieved documents** — a poisoned chunk in the corpus cannot alter agent behaviour (`NFR-SEC-06`, `FR-GOV-04`), asserted at the pipeline level, not the prompt-string level.
- **No raw Cypher outside the graph adapter** — `gates/no-raw-cypher.gate.ts` fails the build when a Cypher string literal (`MATCH`, `MERGE`, `CREATE`, `CALL db.`) appears anywhere outside `adapters/outbound/graph/`, in either runtime, including in test helpers and seed scripts. ADR-0009 rule 2. This gate is what makes "application code cannot express an unscoped graph query" mechanical rather than a review convention (`NFR-SEC-25`, `NFR-SEC-18`), and it is the graph's analogue of `gates/no-unscoped-client-export.gate.ts`. It carries the same weakness as every other gate here: **`--no-verify` bypasses it, and with no CI nothing else catches it** (RISK-002, RISK-011, §15.3).
- **Secrets absent from logs** — `nfr/sec/no-secrets-in-logs.sec.spec.ts` scans the E2E suite's captured stdout, log files and telemetry export for every seeded credential value, connection string and API key, including in failed-external-call error paths, which is where credentials usually leak (`NFR-SEC-02`, `NFR-SEC-12`, `NFR-OBS-03`).
- **CSP, cookies, mTLS, NetworkPolicy** — CSP asserted in test rather than merely configured (`NFR-SEC-14`); cookie attributes asserted and the value proved opaque (`NFR-SEC-10`); plain-HTTP refused and a client certificate required on the web→ai hop (`NFR-SEC-03`); a pod outside the allowed set cannot reach `shj3-ai`, Neo4j or Qdrant (`NFR-SEC-04`).
- **The mock verification adapter cannot boot in Production.** `nfr/sec/mock-adapter-refuses-production.sec.spec.ts`. ADR-0006 rule 6 calls a mocked verification path in front of real payments *the worst failure this system could have*, so it is prevented at startup:

```python
# ai/platform/test_boot_guards.py  (mirrored in web/platform/boot-guards.int.spec.ts)
@pytest.mark.covers("FR-VERI-09", "NFR-SEC-02", "FR-PLAT-09")
@pytest.mark.parametrize("override", [
    {}, {"ALLOW_MOCK_VERIFICATION": "true"}, {"SHJ3_FORCE_BOOT": "1"},
    {"ENVIRONMENT": "Production"}, {"ENVIRONMENT": "PRODUCTION"},
])
def test_mock_verification_provider_cannot_boot_in_production(override):
    env = {"ENVIRONMENT": "production",
           "VERIFICATION_PROVIDER": "mock", **override}
    result = boot(env)
    assert result.exit_code != 0
    assert "MockVerificationProvider" in result.stderr
    assert "production" in result.stderr.lower()
```

The parametrised overrides are the point: **no configuration value bypasses the guard.** The same test shape covers a `Sandbox` payment gateway in production (`FR-PAY-09`).

- **Dependency and image scanning** run inside `verify`, since no scheduled pipeline exists (`NFR-SEC-13`).

### 11.5 Data — `NFR-DATA`

- **Retention enforcement** — the purge job removes transcripts and derived memory beyond the configured period, across all four stores, with a recorded run naming scope, counts and outcome (`FR-GOV-23`, `FR-GOV-27`, `NFR-DATA-06`).
- **The 7-year transaction carve-out survives a 30-day transcript setting** — `nfr/data/transaction-carveout.data.spec.ts`: set transcript retention to 30 days, seed a 6-month-old transaction with its transcript, run the purge, assert the transcript is gone and the transaction is **intact and complete**. Plus a structural assertion that the carve-out is in the purge job's *scope* by construction, not a configurable exception a user could remove (`FR-PAY-08`, `FR-GOV-24`, `NFR-DATA-07`).
- **Erasure completeness across all four stores** — `nfr/data/erasure-completeness.data.spec.ts`: after an erasure request, the citizen's transcripts (SQL), derived memory (SQL), vectors (Qdrant), graph attributions (Neo4j) and cache entries (Redis) are absent — asserted **by direct store inspection**, not by the completion report, since the report is the thing under test. The report names all four stores and lists statutory retentions with the obligation cited (`FR-GOV-22`, `NFR-DATA-12`).
- **Consent ledger integrity** — grants and withdrawals both recorded with timestamp and scope; append-only; the outbound send check reads the ledger at **send time**, so a revocation after campaign configuration suppresses the next send (`FR-GOV-21`, `FR-CHAN-16`).
- **Schema ownership** — Prisma is the sole owner; no second migration tool exists in the repository; SQLAlchemy models regenerate to an empty diff and carry a do-not-edit header; `shj3-ai`'s database user holds write grants on exactly three table groups, asserted by querying the permission catalogue (`NFR-DATA-03`…`05`).
- **Audit immutability at the database level** — no `UPDATE`/`DELETE` grant on the audit table for any application user; the application path returns method-not-supported; the database path fails at the database (`FR-GOV-17`).
- **Redis loss is survivable** — flush Redis mid-suite; sessions and breakers reset, **no record is lost** (`NFR-DATA-02`).

### 11.6 Observability — `NFR-OBS`

- **One trace id spans web → ai → tool call → store.** `nfr/obs/trace-propagation.obs.spec.ts` drives one citizen turn and asserts a single trace id present on the web span, the AI span, the MCP tool-call span and the store spans, with correct parent/child nesting across the runtime boundary — the property most easily lost at exactly the hop ADR-0001 created (`NFR-OBS-01`).
- **Logs never carry raw citizen text.** `nfr/obs/no-citizen-text-in-logs.obs.spec.ts` runs the canonical journey with PII-bearing input and scans every log line, span attribute and metric label for the raw values, the full transcript and any credential. Trace attributes carrying tool arguments are asserted masked (`NFR-OBS-03`, `NFR-SEC-12`, `FR-TOOL-19`).
- Tenant, environment, conversation and agent attributes on every record (`NFR-OBS-02`); per-dependency p95 and error rate as the observability screen's source, with "no data" rather than a stale figure (`NFR-OBS-04`); probes that do not restart-loop `shj3-ai` under the shipped values (`NFR-OBS-05`); cost records per model call queryable three ways (`NFR-OBS-06`); every guardrail decision, refusal, degradation and fallback explainable (`NFR-OBS-07`); a run record per job type (`NFR-OBS-08`); an authenticated health endpoint naming an unreachable store (`NFR-OBS-09`).

---

## 12. Traceability matrix

**All 378 requirement IDs.** Grouped by module. Layer codes: **U** unit · **I** integration · **C** contract · **E** E2E · **S** static gate · **N** non-functional · **Q** quality evaluation.

Status vocabulary: `Planned` (mapped, not written) · `Implemented` (written, not yet green in `verify`) · `Passing` (green in the last `verify` run). **Everything is `Planned`** — this document precedes the first line of implementation code. The graph rows are `Planned` rather than blocked: ADR-0009 closed RISK-003, so nothing in the graph set now waits on a commercial answer (§5.4). Nothing may move to `Passing` except by a recorded `verify` run (§13).

### 12.1 `platform` — FR-PLAT (10)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-PLAT-01 | Tenant registry, validated slug | U, I | `web/platform/tenant-registry.spec.ts`; `web/platform/tenant-registry.int.spec.ts` | Planned |
| FR-PLAT-02 | Atomic 4-store provisioning or rollback | I | `web/platform/provisioning-atomicity.int.spec.ts`; `isolation/graph-isolation.spec.ts` (G13 composite constraints) | Planned |
| FR-PLAT-03 | Handle names derived, never from input | U, S | `web/platform/slug-derivation.spec.ts`; `gates/no-input-interpolated-handles.gate.ts` | Planned |
| FR-PLAT-04 | Idempotent, audited de-provisioning | I | `web/platform/deprovisioning.int.spec.ts`; `ai/knowledge/test_graph_isolation_int.py` (G9 filtered delete + completeness proof) | Planned |
| FR-PLAT-05 | Resumable per-tenant migration orchestrator | I | `web/platform/migration-orchestrator.int.spec.ts` | Planned |
| FR-PLAT-06 | Config resolution tenant → platform | U | `web/platform/config-resolution.spec.ts` | Planned |
| FR-PLAT-07 | Platform tenant read scope | I, E | `isolation/platform-scope.spec.ts`; `e2e/roles/super-admin.spec.ts` | Planned |
| FR-PLAT-08 | Exactly two audited escape hatches | I, S | `isolation/escape-hatches.spec.ts`; `gates/cross-tenant-path-census.gate.ts` | Planned |
| FR-PLAT-09 | Boot refuses on missing config | I | `web/platform/boot-guards.int.spec.ts`; `ai/platform/test_boot_guards.py` | Planned |
| FR-PLAT-10 | Deterministic seed, ≥2 tenants | I | `e2e/fixtures/seed-determinism.spec.ts` | Planned |

### 12.2 `iam` — FR-IAM (18)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-IAM-01 | User record, three statuses, text labels | U, N | `web/iam/user-status.spec.ts`; `nfr/a11y/status-not-colour.a11y.spec.ts` | Planned |
| FR-IAM-02 | Invited → Active on enrolment only | I, E | `web/iam/invite-lifecycle.int.spec.ts`; `e2e/backoffice/user-invite.spec.ts` | Planned |
| FR-IAM-03 | Suspension revokes sessions immediately | I, N | `web/iam/suspension-revokes-session.int.spec.ts`; `nfr/sec/session-revocation.sec.spec.ts` | Planned |
| FR-IAM-04 | Removal retains audit identity refs | I | `web/iam/user-removal-retains-audit.int.spec.ts` | Planned |
| FR-IAM-05 | Edit name, email, team, role | I, E | `web/iam/user-edit.int.spec.ts`; `e2e/backoffice/users.spec.ts` | Planned |
| FR-IAM-06 | Teams with entity scope | U, I | `web/iam/team-scope.spec.ts`; `web/iam/teams.int.spec.ts` | Planned |
| FR-IAM-07 | Membership derived, one write path | U | `web/iam/membership-single-write-path.spec.ts` | Planned |
| FR-IAM-08 | Create team, unique name | I | `web/iam/team-create.int.spec.ts` | Planned |
| FR-IAM-09 | 7×8 matrix, every cell settable | U, E | `web/iam/permission-matrix.spec.ts`; `e2e/backoffice/permission-matrix.spec.ts` | Planned |
| FR-IAM-10 | Custom role starts fully denied | U, N | `web/iam/custom-role-denies-all.spec.ts`; `nfr/sec/authz-matrix.sec.spec.ts` | Planned |
| FR-IAM-11 | Authoring vs publishing separated | E | `e2e/roles/agent-designer.spec.ts` | Planned |
| FR-IAM-12 | Deny-by-default, server-side, no role-name compare | U, N, S | `web/iam/authorization.spec.ts`; `nfr/sec/authz-matrix.sec.spec.ts`; `gates/no-role-name-compare.gate.ts` | Planned |
| FR-IAM-13 | Argon2id, TOTP for privileged, backoff, lockout | I, N | `web/iam/local-auth.int.spec.ts`; `nfr/sec/login-throttle.sec.spec.ts` | Planned |
| FR-IAM-14 | Opaque Redis sessions, no claims | I, N | `web/iam/session-store.int.spec.ts`; `nfr/sec/cookie-attributes.sec.spec.ts` | Planned |
| FR-IAM-15 | `IdentityProvider` port, no credential in features | S | `gates/identity-port-purity.gate.ts` | Planned |
| FR-IAM-16 | Credentials in adapter-owned table only | I, S | `web/iam/credential-table-ownership.int.spec.ts`; `gates/prisma-no-credential-on-user.gate.ts` | Planned |
| FR-IAM-17 | Audit entry for all 8 IAM operations | I | `web/iam/audit-coverage.int.spec.ts` | Planned |
| FR-IAM-18 | Membership projection consistent across views | U, E | `web/iam/membership-single-write-path.spec.ts`; `e2e/wiring/team-membership-projection.spec.ts` | Planned |

### 12.3 `conversation` — FR-CONV (16)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-CONV-01 | Docked/expanded preserves thread and scroll | E | `e2e/journeys/widget-states.spec.ts` | Planned |
| FR-CONV-02 | Dismissible disclaimer from config | E | `e2e/journeys/widget-states.spec.ts` | Planned |
| FR-CONV-03 | Greeting + configurable Quick Action chips | I, E | `web/channels/quick-actions.int.spec.ts`; `e2e/journeys/pay-utilities-bill.spec.ts` | Planned |
| FR-CONV-04 | Per-message TTS, timestamp, thumbs | E, N | `e2e/journeys/message-meta.spec.ts`; `nfr/a11y/assistant-thread.a11y.spec.ts` | Planned |
| FR-CONV-05 | Composer placeholder + mic from config | E | `e2e/journeys/widget-states.spec.ts` | Planned |
| FR-CONV-06 | Semantic speaker distinction, ordered thread | E, N | `e2e/journeys/pay-utilities-bill.spec.ts`; `nfr/a11y/assistant-thread.a11y.spec.ts` | Planned |
| FR-CONV-07 | Persisted per-turn agent trace | I, E | `ai/orchestration/test_trace_persistence_int.py`; `e2e/journeys/pay-utilities-bill.spec.ts` | Planned |
| FR-CONV-08 | Sources panel, or explicit no-grounding | I, E | `ai/knowledge/test_citation_exposure_int.py`; `e2e/journeys/pay-utilities-bill.spec.ts` | Planned |
| FR-CONV-09 | Voice interim preview before commit | E | `e2e/journeys/voice-and-handover.spec.ts` | Planned |
| FR-CONV-10 | Processing state ≤300 ms, SSE streaming | C, E, N | `contract/turn-stream.contract.spec.ts`; `e2e/journeys/pay-utilities-bill.spec.ts`; `nfr/perf/assistant-turn.k6.js` | Planned |
| FR-CONV-11 | Escalated state, queue position, paused composer | E | `e2e/journeys/voice-and-handover.spec.ts` | Planned |
| FR-CONV-12 | Feedback recorded per turn, reaches queue | I, E | `web/analytics/feedback-capture.int.spec.ts`; `e2e/wiring/feedback-to-queue.spec.ts` | Planned |
| FR-CONV-13 | PII masked **before** persistence | I, N | `ai/governance/test_pii_masked_before_persist_int.py`; `nfr/data/pii-at-rest.data.spec.ts` | Planned |
| FR-CONV-14 | Outcome derivation Resolved/Escalated/Abandoned | U | `web/conversation/outcome-derivation.spec.ts` | Planned |
| FR-CONV-15 | Context preserved across free-text escape | I, E | `ai/flows/test_free_text_escape.py`; `e2e/journeys/pay-utilities-bill.spec.ts` | Planned |
| FR-CONV-16 | Session scoped to one tenant + channel | I | `isolation/session-scope.spec.ts` | Planned |

### 12.4 `agents` — FR-AGENT (21)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-AGENT-01 | Registry, six columns, three statuses | I, E | `web/agents/registry.int.spec.ts`; `e2e/backoffice/agent-registry.spec.ts` | Planned |
| FR-AGENT-02 | Ordered immutable version history | U, I | `web/agents/version-history.spec.ts`; `web/agents/version-history.int.spec.ts` | Planned |
| FR-AGENT-03 | Clone → Draft v0.1 with source history entry | I, E | `web/agents/clone.int.spec.ts`; `e2e/backoffice/agent-registry.spec.ts` | Planned |
| FR-AGENT-04 | Publish/unpublish changes channel availability | I, E | `web/agents/publish-lifecycle.int.spec.ts`; `e2e/backoffice/agent-wizard-publish.spec.ts` | Planned |
| FR-AGENT-05 | Archive retains versions and audit | I | `web/agents/archive.int.spec.ts` | Planned |
| FR-AGENT-06 | Rollback prepends history, deletes nothing | U, I | `web/agents/rollback.spec.ts`; `web/agents/rollback.int.spec.ts` | Planned |
| FR-AGENT-07 | Rollback ≠ promotion (per-environment) | I | `web/agents/rollback-vs-promotion.int.spec.ts` | Planned |
| FR-AGENT-08 | 10 steps freely navigable, state persists | E | `e2e/backoffice/agent-wizard-publish.spec.ts` | Planned |
| FR-AGENT-09 | Step 1 identity, tenant-restricted owner | I, E | `web/agents/wizard-identity.int.spec.ts`; `e2e/backoffice/agent-wizard-publish.spec.ts` | Planned |
| FR-AGENT-10 | Step 2 prompt verbatim + tone into runtime | U, I | `web/agents/wizard-prompt.spec.ts`; `ai/orchestration/test_prompt_assembly.py` | Planned |
| FR-AGENT-11 | Model/fallback/temperature as runtime config | U, I | `ai/orchestration/test_model_selection.py`; `web/agents/model-config.int.spec.ts` | Planned |
| FR-AGENT-12 | Fallback model invoked and traced | U, I | `ai/orchestration/test_model_fallback.py` | Planned |
| FR-AGENT-13 | Bind knowledge collections, tenant-filtered | I | `web/agents/wizard-knowledge-binding.int.spec.ts`; `isolation/collection-offer.spec.ts` | Planned |
| FR-AGENT-14 | Bind flows with publication status | I, E | `web/agents/wizard-flow-binding.int.spec.ts`; `e2e/backoffice/agent-wizard-publish.spec.ts` | Planned |
| FR-AGENT-15 | Per-agent guardrails, locked policies refused | I | `web/governance/agent-guardrail-selection.int.spec.ts` | Planned |
| FR-AGENT-16 | Bind channels; disabled channel unbindable | I | `web/agents/wizard-channel-binding.int.spec.ts` | Planned |
| FR-AGENT-17 | Sandbox uses real pipeline, excluded from KPIs | I, E | `ai/orchestration/test_sandbox_turn_int.py`; `e2e/backoffice/agent-wizard-publish.spec.ts` | Planned |
| FR-AGENT-18 | Publish to environment, mandatory summary | I, E | `web/agents/publish.int.spec.ts`; `e2e/backoffice/agent-wizard-publish.spec.ts` | Planned |
| FR-AGENT-19 | `Publish agents` required for all four ops | N, E | `nfr/sec/authz-matrix.sec.spec.ts`; `e2e/roles/agent-designer.spec.ts` | Planned |
| FR-AGENT-20 | Publish gate evaluated before publish | I, E | `ai/evaluation/test_publish_gate.py`; `e2e/backoffice/blocked-publish.spec.ts` | Planned |
| FR-AGENT-21 | Per-day per-channel usage, sandbox excluded | I | `web/agents/usage-rollup.int.spec.ts` | Planned |

### 12.5 `orchestration` — FR-ORCH (14)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-ORCH-01 | Six-stage pipeline on every turn | U, I | `ai/orchestration/test_pipeline_stages.py` | Planned |
| FR-ORCH-02 | Three execution modes selectable, recorded | U, I | `ai/orchestration/test_execution_modes.py` | Planned |
| FR-ORCH-03 | Sequential: order-preserving hand and merge | I | `ai/orchestration/test_execution_modes.py` | Planned |
| FR-ORCH-04 | Parallel: concurrent fan-out, overlap resolved | I | `ai/orchestration/test_execution_modes.py` | Planned |
| FR-ORCH-05 | Supervisor–worker: plan, delegate, review | I | `ai/orchestration/test_execution_modes.py` | Planned |
| FR-ORCH-06 | Router strategy + agent selection scope | U, I | `ai/orchestration/test_router_scope.py`; `isolation/router-scope.spec.ts` | Planned |
| FR-ORCH-07 | Hop and loop ceilings terminate with fallback | U, I | `ai/orchestration/test_ceilings.py` | Planned |
| FR-ORCH-08 | Per-call cost accounting + per-turn ceiling | U, I | `ai/orchestration/test_cost_accounting_int.py` | Planned |
| FR-ORCH-09 | Deterministic conflict/merge policy | U | `ai/orchestration/test_merge_policy.py` | Planned |
| FR-ORCH-10 | Fallback agent below confidence floor | U, I | `ai/orchestration/test_router_fallback.py` | Planned |
| FR-ORCH-11 | One persisted trace per turn, full contents | I, E | `ai/orchestration/test_trace_persistence_int.py`; `e2e/journeys/pay-utilities-bill.spec.ts` | Planned |
| FR-ORCH-12 | Per-mode latency and cost comparable | I | `ai/orchestration/test_mode_cost_latency.py` | Planned |
| FR-ORCH-13 | Escape re-opens routing, context preserved | I | `ai/flows/test_free_text_escape.py` | Planned |
| FR-ORCH-14 | Guardrail stages structurally undisableable | I | `ai/governance/test_guardrail_stages_undisableable_int.py` | Planned |

### 12.6 `tools` — FR-TOOL (22)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-TOOL-01 | Skills catalogue, per-agent attach/detach | I, E | `web/tools/skills-catalogue.int.spec.ts`; `e2e/backoffice/tools-registry.spec.ts` | Planned |
| FR-TOOL-02 | Live counts of skills/MCP tools/connectors | E | `e2e/backoffice/agent-wizard-publish.spec.ts` | Planned |
| FR-TOOL-03 | MCP server registry with connection state | I, E | `web/tools/mcp-registry.int.spec.ts`; `e2e/backoffice/tools-registry.spec.ts` | Planned |
| FR-TOOL-04 | Connect and discover tool set; failure reason | I | `ai/tools/test_mcp_discovery_int.py` | Planned |
| FR-TOOL-05 | Add MCP server, secret-reference credentials | I | `web/tools/mcp-add.int.spec.ts` | Planned |
| FR-TOOL-06 | Per-tool independent binding, per agent version | I | `web/tools/tool-binding.int.spec.ts` | Planned |
| FR-TOOL-07 | Binding, not discovery, confers callability | I | `ai/tools/test_unbound_tool_rejected_int.py` | Planned |
| FR-TOOL-08 | Connector registry, declared path params | U, I | `web/tools/connector-schema.spec.ts`; `web/tools/connector-registry.int.spec.ts` | Planned |
| FR-TOOL-09 | Test connector on demand, state + sample body | I | `web/tools/connector-test.int.spec.ts` | Planned |
| FR-TOOL-10 | Add connector, untested until tested | I | `web/tools/connector-add.int.spec.ts` | Planned |
| FR-TOOL-11 | Connector becomes a skill with schema + limit | U, I | `web/tools/connector-as-skill.spec.ts`; `ai/tools/test_connector_rate_limit_int.py` | Planned |
| FR-TOOL-12 | Wizard and registry are one data set | U, E | `web/tools/binding-write-path.spec.ts`; `e2e/wiring/tool-binding-one-record.spec.ts` | Planned |
| FR-TOOL-13 | Per-dependency breaker configuration | I, E | `web/tools/breaker-config.int.spec.ts`; `e2e/backoffice/resilience.spec.ts` | Planned |
| FR-TOOL-14 | Breaker consulted **before** the call | I | `ai/tools/test_breaker_before_call_int.py` | Planned |
| FR-TOOL-15 | Manual trip/reset, role-gated and audited | I, N | `web/tools/breaker-manual-control.int.spec.ts`; `nfr/sec/authz-matrix.sec.spec.ts` | Planned |
| FR-TOOL-16 | Cached answers honour max age | I | `ai/tools/test_degraded_cache_age_int.py` | Planned |
| FR-TOOL-17 | Configurable degraded-mode message | I, E | `ai/tools/test_degraded_message_int.py`; `e2e/journeys/degraded-sewa.spec.ts` | Planned |
| FR-TOOL-18 | Breaker state shared across replicas via Redis | I | `ai/tools/test_breaker_shared_state_int.py` | Planned |
| FR-TOOL-19 | Tool invocation on trace, args post-masking | I, N | `ai/tools/test_tool_trace_int.py`; `nfr/obs/no-citizen-text-in-logs.obs.spec.ts` | Planned |
| FR-TOOL-20 | Credentials as secret references only | I, N | `web/tools/secret-references.int.spec.ts`; `nfr/sec/no-secrets-in-logs.sec.spec.ts` | Planned |
| FR-TOOL-21 | Wizard ↔ registry: one record, one write path | U, E | `web/tools/binding-write-path.spec.ts`; `e2e/wiring/tool-binding-one-record.spec.ts` | Planned |
| FR-TOOL-22 | Degraded status ↔ breaker state are one state | I, E | `web/governance/dependency-health-single-state.int.spec.ts`; `e2e/wiring/degraded-breaker.spec.ts` | Planned |

### 12.7 `knowledge` — FR-KNOW (26)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-KNOW-01 | Source registry, computed indexed % | I, E | `web/knowledge/source-registry.int.spec.ts`; `e2e/backoffice/knowledge-sources.spec.ts` | Planned |
| FR-KNOW-02 | Add source: 5 types × 3 schedules, job queued | I | `web/knowledge/source-add.int.spec.ts` | Planned |
| FR-KNOW-03 | Async re-crawl updates coverage and timestamp | I | `ai/knowledge/test_recrawl_int.py` | Planned |
| FR-KNOW-04 | Remove source; orphan entities deleted only | I | `ai/knowledge/test_source_removal_int.py` | Planned |
| FR-KNOW-05 | Partial indexing surfaced, never "ready" | I, E | `web/knowledge/indexing-state.int.spec.ts`; `e2e/backoffice/knowledge-sources.spec.ts` | Planned |
| FR-KNOW-06 | 5 entity types, 4 relationship types traversable | I, E | `ai/knowledge/test_graph_model_int.py`; `ai/knowledge/test_graph_isolation_int.py` (G4, G8); `e2e/backoffice/graph-explorer.spec.ts` | Planned |
| FR-KNOW-07 | Node inspection: type, neighbours, sources | I, E | `ai/knowledge/test_node_inspection_int.py`; `ai/knowledge/test_graph_isolation_int.py` (G3); `e2e/backoffice/graph-explorer.spec.ts` | Planned |
| FR-KNOW-08 | Live entity search de-emphasises non-matches | I, E | `ai/knowledge/test_graph_isolation_int.py` (G2); `e2e/backoffice/graph-explorer.spec.ts` | Planned |
| FR-KNOW-09 | Duplicate detect, merge/ignore, no dangling refs | I | `ai/knowledge/test_duplicate_merge_int.py`; `ai/knowledge/test_graph_isolation_int.py` (G5, G6) | Planned |
| FR-KNOW-10 | Manual entity add, marked manually authored | I | `ai/knowledge/test_manual_entity_int.py`; `ai/knowledge/test_graph_isolation_int.py` (G7) | Planned |
| FR-KNOW-11 | Retrieval config: chunk, model, weights, K, rerank | U, I | `ai/knowledge/test_retrieval_config.py`; `ai/knowledge/test_retrieval_int.py` | Planned |
| FR-KNOW-12 | Hybrid weighting governs actual ranking | I | `ai/knowledge/test_hybrid_weighting_int.py` | Planned |
| FR-KNOW-13 | Embedding model change forces full re-index | I | `ai/knowledge/test_embedding_model_change_int.py` | Planned |
| FR-KNOW-14 | Rerank failure degrades, never fails the turn | I | `ai/knowledge/test_rerank_degradation_int.py`; `ai/knowledge/test_graph_degradation_int.py` (graph down → vector-only, §7.1) | Planned |
| FR-KNOW-15 | Playground: scored passages + matched subgraph | I, E | `ai/knowledge/test_playground_int.py`; `e2e/backoffice/retrieval-playground.spec.ts` | Planned |
| FR-KNOW-16 | Re-index job history, three terminal states | I | `ai/knowledge/test_reindex_jobs_int.py` | Planned |
| FR-KNOW-17 | Citations resolve through the system of record | I | `ai/knowledge/test_citation_resolution_int.py` | Planned |
| FR-KNOW-18 | Conflict detection records both sides | I | `ai/knowledge/test_conflict_detection_int.py` | Planned |
| FR-KNOW-19 | Three conflict policies change grounding | U, I | `ai/knowledge/test_conflict_policies.py` | Planned |
| FR-KNOW-20 | Admin resolution restores confidence, audited | I, E | `ai/knowledge/test_conflict_resolution_int.py`; `e2e/backoffice/source-conflicts.spec.ts` | Planned |
| FR-KNOW-21 | Unresolved conflict lowers confidence enough to refuse | I | `ai/knowledge/test_conflict_lowers_confidence_int.py` | Planned |
| FR-KNOW-22 | Recency alone is wrong (library fixture) | U, I | `ai/knowledge/test_recency_policy_selects_wrong_value.py` | Planned |
| FR-KNOW-23 | Full derived-store rebuild via product re-index | I | `ai/knowledge/test_derived_store_rebuild_int.py`; `ai/knowledge/test_graph_rebuild_int.py` (graph recovery is re-index, ADR-0009) | Planned |
| FR-KNOW-24 | Grounding only on the serving tenant's sources | I | `isolation/vector-retrieval.spec.ts`; `ai/knowledge/test_graph_isolation_int.py` (G10) | Planned |
| FR-KNOW-25 | SoR-first writes, outbox, no 2PC | I, S | `web/knowledge/outbox-ordering.int.spec.ts`; `gates/no-two-phase-commit.gate.ts` | Planned |
| FR-KNOW-26 | Conflict → confidence drop → refusal, reversible | I | `ai/knowledge/test_conflict_lowers_confidence_int.py` | Planned |

### 12.8 `flows` — FR-FLOW (12)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-FLOW-01 | Canvas nodes + inspector, positions persist | I, E | `web/flows/canvas-persistence.int.spec.ts`; `e2e/backoffice/flow-designer.spec.ts` | Planned |
| FR-FLOW-02 | All five node types executable end to end | U, I | `ai/flows/test_node_types.py`; `ai/flows/test_full_flow_int.py` | Planned |
| FR-FLOW-03 | Message node chips from Quick Actions | I | `ai/flows/test_message_node_chips_int.py` | Planned |
| FR-FLOW-04 | Question node options bound to graph entities | I | `ai/flows/test_question_node_options_int.py` | Planned |
| FR-FLOW-05 | Tool node: exactly two attempts, then fall-through | I | `ai/flows/test_tool_call_node.py` | Planned |
| FR-FLOW-06 | Handover node: both triggers, full transcript | I | `ai/flows/test_handover_node_int.py` | Planned |
| FR-FLOW-07 | Free-text escape at **every** node type | I | `ai/flows/test_free_text_escape.py` (parametrised over all 5) | Planned |
| FR-FLOW-08 | Slot state incl. awaited slot exposed | U, I | `ai/flows/test_slot_state.py` | Planned |
| FR-FLOW-09 | Flow resumes at the node it was left | I | `ai/flows/test_free_text_escape.py` | Planned |
| FR-FLOW-10 | Flow versions; editing published forks a draft | I | `web/flows/versioning.int.spec.ts` | Planned |
| FR-FLOW-11 | Step-up pauses **before** the tool call | I | `ai/verification/test_step_up_ordering.py` | Planned |
| FR-FLOW-12 | Two tool failures → tool-failure escalation reason | I | `ai/flows/test_tool_failure_escalation_int.py` | Planned |

### 12.9 `handover` — FR-HAND (21)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-HAND-01 | Presence states; only Available is offered tickets | U, I | `web/handover/presence.spec.ts`; `web/handover/presence.int.spec.ts` | Planned |
| FR-HAND-02 | Queue with five fields, live waiting time | E | `e2e/backoffice/agent-workspace.spec.ts` | Planned |
| FR-HAND-03 | Ticket loads its own transcript and context | I, E | `web/handover/ticket-load.int.spec.ts`; `e2e/backoffice/agent-workspace.spec.ts` | Planned |
| FR-HAND-04 | Context rail shows reference + verification state | I, E | `web/handover/context-rail.int.spec.ts`; `e2e/backoffice/agent-workspace.spec.ts` | Planned |
| FR-HAND-05 | Three structured escalation reasons, never absent | U, I | `web/handover/escalation-reason.spec.ts`; `ai/flows/test_handover_creates_ticket_int.py` | Planned |
| FR-HAND-06 | System note at the handoff point, once | I, E | `web/handover/system-note.int.spec.ts`; `e2e/journeys/voice-and-handover.spec.ts` | Planned |
| FR-HAND-07 | Topic-scoped canned replies populate, not send | E | `e2e/backoffice/agent-workspace.spec.ts` | Planned |
| FR-HAND-08 | Ordered evaluation, first match wins, short-circuits | U | `web/handover/rule-evaluation.spec.ts` | Planned |
| FR-HAND-09 | Reorder persists and governs evaluation | U, E | `web/handover/rule-reorder.spec.ts`; `e2e/wiring/reorder-rule-tester.spec.ts` | Planned |
| FR-HAND-10 | Disable skips but retains position | U | `web/handover/rule-evaluation.spec.ts` | Planned |
| FR-HAND-11 | Rule form: attribute-driven operator, prefilled edit | U, E | `web/handover/rule-form.spec.ts`; `e2e/backoffice/routing-rules.spec.ts` | Planned |
| FR-HAND-12 | Delete closes the ordering gap | U | `web/handover/rule-delete.spec.ts` | Planned |
| FR-HAND-13 | Tester evaluates unsaved order/enable/edits | U, E | `web/handover/rule-tester-parity.spec.ts`; `e2e/wiring/reorder-rule-tester.spec.ts` | Planned |
| FR-HAND-14 | Tester names the firing rule or the default queue | U | `web/handover/rule-tester-output.spec.ts` | Planned |
| FR-HAND-15 | Billing+High reroutes on reorder (canonical proof) | U, E | `web/handover/rule-reorder.spec.ts`; `e2e/wiring/reorder-rule-tester.spec.ts` | Planned |
| FR-HAND-16 | Escalation only within staffed hours | U, I | `web/handover/working-hours.spec.ts`; `ai/handover/test_out_of_hours_int.py` | Planned |
| FR-HAND-17 | Transcript + assurance + pending slot transferred | I, E | `ai/handover/test_context_transfer_int.py`; `e2e/journeys/voice-and-handover.spec.ts` | Planned |
| FR-HAND-18 | `Handle escalations` gates the queue | N, E | `nfr/sec/authz-matrix.sec.spec.ts`; `e2e/roles/live-agent.spec.ts` | Planned |
| FR-HAND-19 | Wait-time re-queue, supervisor alert, bounded twice | U, I | `web/handover/requeue-bound.spec.ts`; `web/handover/supervisor-alert.int.spec.ts` | Planned |
| FR-HAND-20 | Handover node → exactly one ticket with that reason | I, E | `ai/flows/test_handover_creates_ticket_int.py`; `e2e/wiring/handover-ticket-reason.spec.ts` | Planned |
| FR-HAND-21 | Tester and router share one evaluation implementation | U, E | `web/handover/rule-tester-parity.spec.ts`; `e2e/wiring/reorder-rule-tester.spec.ts` | Planned |

### 12.10 `channels` — FR-CHAN (23)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-CHAN-01 | Four channels with binding, hours, state | I, E | `web/channels/registry.int.spec.ts`; `e2e/backoffice/channels.spec.ts` | Planned |
| FR-CHAN-02 | Disable stops new, completes open conversations | I | `web/channels/disable-behaviour.int.spec.ts` | Planned |
| FR-CHAN-03 | Assistant hours ≠ human-agent hours | U | `web/channels/hours-independence.spec.ts` | Planned |
| FR-CHAN-04 | Per-weekday hours + UAE holiday sync | U, I | `web/channels/working-hours.spec.ts`; `web/channels/holiday-sync.int.spec.ts` | Planned |
| FR-CHAN-05 | Assistant-without-agents toggle + message | I, E | `web/channels/no-agent-message.int.spec.ts`; `e2e/journeys/out-of-hours.spec.ts` | Planned |
| FR-CHAN-06 | Six widget studio settings honoured | I, E | `web/channels/widget-config.int.spec.ts`; `e2e/backoffice/widget-studio.spec.ts` | Planned |
| FR-CHAN-07 | Live preview uses the real components | E, N | `e2e/backoffice/widget-studio.spec.ts`; `visual/widget-preview.vr.spec.ts` | Planned |
| FR-CHAN-08 | Embed snippet reflects config, carries no secret | E, N | `e2e/journeys/embed-host-page.spec.ts`; `nfr/sec/no-secrets-in-logs.sec.spec.ts` | Planned |
| FR-CHAN-09 | Origin allowlist enforced server-side | I, N | `web/channels/origin-allowlist.int.spec.ts`; `nfr/sec/widget-origin.sec.spec.ts` | Planned |
| FR-CHAN-10 | WhatsApp config behind a BSP adapter | I, S | `web/channels/whatsapp-config.int.spec.ts`; `gates/bsp-adapter-purity.gate.ts` | Planned |
| FR-CHAN-11 | 24-hour window: free-form in, template out | I, E | `web/channels/session-window.int.spec.ts`; `e2e/journeys/whatsapp-window.spec.ts` | Planned |
| FR-CHAN-12 | Template registry; new templates Pending review | I | `web/channels/template-registry.int.spec.ts` | Planned |
| FR-CHAN-13 | Campaigns reference templates by identity | U, I | `web/channels/campaign-model.spec.ts`; `web/channels/campaigns.int.spec.ts` | Planned |
| FR-CHAN-14 | Blocked campaign cannot be enabled (server-side) | I | `web/channels/campaign-blocked.int.spec.ts` | Planned |
| FR-CHAN-15 | Approval unblocks campaign with no campaign edit | I, E | `web/channels/template-approval-cascade.int.spec.ts`; `e2e/wiring/template-approval-unblocks-campaign.spec.ts` | Planned |
| FR-CHAN-16 | Send-time template + opt-in verification | I | `web/channels/send-time-checks.int.spec.ts` | Planned |
| FR-CHAN-17 | Quiet hours: queued or dropped, recorded | U, I | `web/channels/quiet-hours.spec.ts`; `web/channels/quiet-hours.int.spec.ts` | Planned |
| FR-CHAN-18 | Locale registry with computed completeness | I, N | `web/channels/locale-registry.int.spec.ts`; `nfr/i18n/completeness.i18n.spec.ts` | Planned |
| FR-CHAN-19 | Exactly one fallback locale; misses counted | U, N | `web/channels/fallback-locale.spec.ts`; `nfr/i18n/fallback.i18n.spec.ts` | Planned |
| FR-CHAN-20 | Channel-native structural rendering | I, E | `ai/channels/test_channel_rendering_int.py`; `e2e/journeys/whatsapp-window.spec.ts` | Planned |
| FR-CHAN-21 | Opt-in notice, opt-out keyword recorded | I, E | `web/channels/opt-out.int.spec.ts`; `e2e/journeys/whatsapp-window.spec.ts` | Planned |
| FR-CHAN-22 | Window state visible in the citizen thread | E | `e2e/journeys/whatsapp-window.spec.ts` | Planned |
| FR-CHAN-23 | Campaign state read live from template state | I, E | `web/channels/template-approval-cascade.int.spec.ts`; `e2e/wiring/template-approval-unblocks-campaign.spec.ts` | Planned |

### 12.11 `verification` — FR-VERI (14)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-VERI-01 | Provider registry, independently toggleable | I, E | `web/verification/provider-registry.int.spec.ts`; `e2e/backoffice/verification.spec.ts` | Planned |
| FR-VERI-02 | Emirates ID stored as a salted hash only | I, N | `web/verification/id-hashing.int.spec.ts`; `nfr/data/pii-at-rest.data.spec.ts` | Planned |
| FR-VERI-03 | OTP fallback; both unavailable ⇒ refuse | U, I | `ai/verification/test_provider_fallback.py` | Planned |
| FR-VERI-04 | Account-ownership check configurable per tenant | I | `web/verification/ownership-toggle.int.spec.ts` | Planned |
| FR-VERI-05 | Ownership refusal **before** any tool call | I | `ai/verification/test_ownership_refusal.py` | Planned |
| FR-VERI-06 | L0–L3 ladder mapped to gated actions | U | `web/verification/assurance-levels.spec.ts` | Planned |
| FR-VERI-07 | Assurance satisfied before the gated tool call | I | `ai/verification/test_step_up_ordering.py` | Planned |
| FR-VERI-08 | Mock implements all levels + all failure modes | I | `ai/verification/test_mock_adapter_suite.py` | Planned |
| FR-VERI-09 | Mock adapter cannot boot in Production | I, N | `ai/platform/test_boot_guards.py`; `nfr/sec/mock-adapter-refuses-production.sec.spec.ts` | Planned |
| FR-VERI-10 | Stitching key config incl. never-stitch | U, I | `web/verification/stitching-config.spec.ts`; `web/verification/stitching.int.spec.ts` | Planned |
| FR-VERI-11 | Anonymous never merged into verified | U, I | `web/verification/stitching-negative.spec.ts`; `web/verification/stitching.int.spec.ts` | Planned |
| FR-VERI-12 | Memory scope: identity / session / none | U, I | `ai/verification/test_memory_scope_int.py` | Planned |
| FR-VERI-13 | Memory retention purge, stricter setting wins | I, N | `web/verification/memory-retention.int.spec.ts`; `nfr/data/retention.data.spec.ts` | Planned |
| FR-VERI-14 | Assurance level carried on `Principal` | U, S | `web/verification/principal-assurance.spec.ts`; `gates/identity-port-purity.gate.ts` | Planned |

### 12.12 `payments` — FR-PAY (10)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-PAY-01 | Gateway registry behind a port | I, S | `web/payments/gateway-registry.int.spec.ts`; `gates/payment-port-purity.gate.ts` | Planned |
| FR-PAY-02 | Receipt delivery + assistant-refund toggles | I | `web/payments/receipt-config.int.spec.ts` | Planned |
| FR-PAY-03 | Transaction log, exact decimals with currency | U, I | `web/payments/money.spec.ts`; `web/payments/transaction-log.int.spec.ts` | Planned |
| FR-PAY-04 | Status state machine rejects invalid transitions | U | `web/payments/transaction-state-machine.spec.ts` | Planned |
| FR-PAY-05 | Refund approve/decline, both audited | I, E | `web/payments/refund-resolution.int.spec.ts`; `e2e/backoffice/transactions.spec.ts` | Planned |
| FR-PAY-06 | L2 required before payment or mobile change | I | `ai/verification/test_step_up_ordering.py` | Planned |
| FR-PAY-07 | Idempotency key prevents double charge | I | `web/payments/idempotency.int.spec.ts` | Planned |
| FR-PAY-08 | 7-year retention survives 30-day transcripts | N | `nfr/data/transaction-carveout.data.spec.ts` | Planned |
| FR-PAY-09 | Sandbox gateway refused in Production | I, N | `web/platform/boot-guards.int.spec.ts`; `nfr/sec/mock-adapter-refuses-production.sec.spec.ts` | Planned |
| FR-PAY-10 | Transaction ↔ conversation link survives purge | I, N | `web/payments/transaction-links.int.spec.ts`; `nfr/data/transaction-carveout.data.spec.ts` | Planned |

### 12.13 `governance` — FR-GOV (29)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-GOV-01 | Five global policies with defaults and locks | I, E | `web/governance/policy-registry.int.spec.ts`; `e2e/backoffice/guardrails.spec.ts` | Planned |
| FR-GOV-02 | Locked policy toggle **rejected**, not ignored | I | `ai/governance/test_locked_policy_rejected_int.py` | Planned |
| FR-GOV-03 | PII masking locked and pre-persistence | I, N | `ai/governance/test_pii_masked_before_persist_int.py`; `nfr/data/pii-at-rest.data.spec.ts` | Planned |
| FR-GOV-04 | Injection filter on retrieved content + uploads | I, N | `ai/governance/test_prompt_injection_int.py`; `nfr/sec/retrieved-content-injection.sec.spec.ts` | Planned |
| FR-GOV-05 | Withhold below grounding threshold, offer human | I | `ai/governance/test_grounding_refusal_int.py` | Planned |
| FR-GOV-06 | Financial-advice block, disableable and audited | I | `ai/governance/test_financial_advice_block_int.py` | Planned |
| FR-GOV-07 | In-scope restriction returns the service directory | I | `ai/governance/test_scope_restriction_int.py` | Planned |
| FR-GOV-08 | Per-agent override requires a stated reason | U, I | `web/governance/override-reason.spec.ts`; `web/governance/overrides.int.spec.ts` | Planned |
| FR-GOV-09 | Locked policies absent from the override surface | I, E | `web/governance/override-excludes-locked.int.spec.ts`; `e2e/backoffice/guardrails.spec.ts` | Planned |
| FR-GOV-10 | Override removal returns the global value | I | `web/governance/override-removal.int.spec.ts` | Planned |
| FR-GOV-11 | Global change applies without republish | I | `ai/governance/test_global_policy_propagation_int.py` | Planned |
| FR-GOV-12 | Three environments matching the Helm set | I, S | `web/governance/environments.int.spec.ts`; `gates/env-names-match-helm.gate.ts` | Planned |
| FR-GOV-13 | Promotion requests name a specific version | U, I | `web/governance/promotion-request.spec.ts`; `web/governance/promotions.int.spec.ts` | Planned |
| FR-GOV-14 | Decision + audit entry in one transaction | I, E | `web/governance/promotion-audit-atomicity.int.spec.ts`; `e2e/wiring/promotion-audit.spec.ts` | Planned |
| FR-GOV-15 | Approver ≠ requester | U, I | `web/governance/separation-of-duties.spec.ts`; `web/governance/promotions.int.spec.ts` | Planned |
| FR-GOV-16 | Four audited categories, exhaustively verified | I, N | `web/governance/audit-coverage.int.spec.ts`; `nfr/sec/privileged-action-census.sec.spec.ts` | Planned |
| FR-GOV-17 | Audit append-only by database grant | I | `web/governance/audit-append-only.int.spec.ts` | Planned |
| FR-GOV-18 | Per-dependency p95, error rate, health | I, N | `web/governance/observability-screen.int.spec.ts`; `nfr/obs/dependency-metrics.obs.spec.ts` | Planned |
| FR-GOV-19 | Health derived from configured thresholds | U | `web/governance/degradation-thresholds.spec.ts` | Planned |
| FR-GOV-20 | Degraded row links to its breaker config | I, E | `web/governance/dependency-health-single-state.int.spec.ts`; `e2e/wiring/degraded-breaker.spec.ts` | Planned |
| FR-GOV-21 | Consent ledger grants and withdrawals | I, N | `web/governance/consent-ledger.int.spec.ts`; `nfr/data/consent-ledger.data.spec.ts` | Planned |
| FR-GOV-22 | Erasure across all four stores, reported | N | `nfr/data/erasure-completeness.data.spec.ts` | Planned |
| FR-GOV-23 | Transcript retention, four options, purge | I, N | `web/governance/retention-config.int.spec.ts`; `nfr/data/retention.data.spec.ts` | Planned |
| FR-GOV-24 | 7-year transaction carve-out by construction | N, S | `nfr/data/transaction-carveout.data.spec.ts`; `gates/purge-scope-excludes-transactions.gate.ts` | Planned |
| FR-GOV-25 | Residency setting persists per tenant | I | `web/governance/residency-config.int.spec.ts` | Planned |
| FR-GOV-26 | Residency conflict enumerated per provider | U, E | `web/governance/residency-conflict.spec.ts`; `e2e/backoffice/privacy-and-data.spec.ts` | Planned |
| FR-GOV-27 | Purge job runs recorded, retried, alertable | I, N | `web/governance/purge-job-runs.int.spec.ts`; `nfr/obs/job-runs.obs.spec.ts` | Planned |
| FR-GOV-28 | Retention/erasure/residency per tenant | I | `isolation/retention-per-tenant.spec.ts` | Planned |
| FR-GOV-29 | No decision without audit, no audit without decision | I, E | `web/governance/promotion-audit-atomicity.int.spec.ts`; `e2e/wiring/promotion-audit.spec.ts` | Planned |

### 12.14 `evaluation` — FR-EVAL (15)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-EVAL-01 | Golden sets, tenant-owned, four fields | I | `web/evaluation/golden-sets.int.spec.ts`; `isolation/golden-set-scope.spec.ts` | Planned |
| FR-EVAL-02 | On-demand run produces a versioned score record | I | `ai/evaluation/test_run_records_int.py` | Planned |
| FR-EVAL-03 | Add conversation once; duplicates rejected | I, E | `web/evaluation/add-case.int.spec.ts`; `e2e/wiring/add-to-golden-set.spec.ts` | Planned |
| FR-EVAL-04 | Case add/amend/remove changes scoring | I | `web/evaluation/case-editing.int.spec.ts` | Planned |
| FR-EVAL-05 | Regression runs, seven fields, derived result | U, I | `web/evaluation/run-result-derivation.spec.ts`; `ai/evaluation/test_run_records_int.py` | Planned |
| FR-EVAL-06 | Run-all: one record per agent/set, no overwrite | I | `ai/evaluation/test_run_all_int.py` | Planned |
| FR-EVAL-07 | Five gate settings, independently effective | U | `ai/evaluation/test_publish_gate.py` | Planned |
| FR-EVAL-08 | Block message names agent, version, set, score, threshold | U, E | `ai/evaluation/test_publish_gate.py`; `e2e/backoffice/blocked-publish.spec.ts` | Planned |
| FR-EVAL-09 | Locale gate blocks naming locale and percentage | U, E | `ai/evaluation/test_locale_gate.py`; `e2e/backoffice/blocked-publish.spec.ts` | Planned |
| FR-EVAL-10 | Gate off permits publish; disabling is audited | I | `web/evaluation/gate-disabled.int.spec.ts` | Planned |
| FR-EVAL-11 | Gate evaluates the exact version; none ⇒ block | U, I | `ai/evaluation/test_gate_version_binding.py` | Planned |
| FR-EVAL-12 | Red-team below 100% blocks absolutely | U | `ai/evaluation/test_publish_gate.py` | Planned |
| FR-EVAL-13 | Gate config, blocks and bypasses all audited | I | `web/evaluation/gate-audit.int.spec.ts` | Planned |
| FR-EVAL-14 | Case count equals case rows after a batch | I, E | `web/evaluation/count-consistency.int.spec.ts`; `e2e/wiring/add-to-golden-set.spec.ts` | Planned |
| FR-EVAL-15 | Gate reads live locale figure, holds no copy | I, E | `ai/evaluation/test_gate_reads_live_locale.py`; `e2e/wiring/arabic-parity-gate.spec.ts` | Planned |

### 12.15 `analytics` — FR-ANLY (13)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-ANLY-01 | Date range re-renders every overview panel | E | `e2e/backoffice/command-centre.spec.ts` | Planned |
| FR-ANLY-02 | Four KPIs reconcile with a direct query | I | `web/analytics/kpi-reconciliation.int.spec.ts` | Planned |
| FR-ANLY-03 | Channel split sums to conversation volume | I, E | `web/analytics/channel-split.int.spec.ts`; `e2e/backoffice/command-centre.spec.ts` | Planned |
| FR-ANLY-04 | Top intents derived from routing decisions | I | `web/analytics/top-intents.int.spec.ts` | Planned |
| FR-ANLY-05 | Explorer filters applied server-side | I, N | `web/analytics/explorer-filters.int.spec.ts`; `nfr/perf/explorer-at-volume.k6.js` | Planned |
| FR-ANLY-06 | Six columns; masked citizen identifier | E, N | `e2e/backoffice/conversation-explorer.spec.ts`; `nfr/data/pii-at-rest.data.spec.ts` | Planned |
| FR-ANLY-07 | Inline transcript with redaction footer | E | `e2e/backoffice/conversation-explorer.spec.ts` | Planned |
| FR-ANLY-08 | Export masked, tenant-scoped, audited | I, N | `web/analytics/export.int.spec.ts`; `nfr/sec/export-authz.sec.spec.ts` | Planned |
| FR-ANLY-09 | Thumbs-down queue, fix/reopen recorded | I, E | `web/analytics/feedback-queue.int.spec.ts`; `e2e/wiring/feedback-to-queue.spec.ts` | Planned |
| FR-ANLY-10 | Clusters with ≥2 resolution paths, both dequeue | I | `web/analytics/unanswered-clusters.int.spec.ts` | Planned |
| FR-ANLY-11 | Resolution creates a linked artefact both ways | I, E | `web/analytics/resolution-creates-artefact.int.spec.ts`; `e2e/wiring/feedback-to-knowledge.spec.ts` | Planned |
| FR-ANLY-12 | Metric definitions published with figures | U, E | `web/analytics/metric-definitions.spec.ts`; `e2e/backoffice/command-centre.spec.ts` | Planned |
| FR-ANLY-13 | Cross-tenant totals only via the audited rollup | I, S | `isolation/analytics-rollup.spec.ts`; `gates/no-cross-tenant-analytics-query.gate.ts` | Planned |

### 12.16 `theming` — FR-THEME (20)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-THEME-01 | Settings → Appearance + tenant branding surface | E, N | `e2e/backoffice/theming.spec.ts`; `nfr/sec/authz-matrix.sec.spec.ts` | Planned |
| FR-THEME-02 | Three token layers; features use semantic only | S | `gates/token-layers.gate.ts` | Planned |
| FR-THEME-03 | Runtime token change repaints the whole app | E, N | `e2e/backoffice/theming.spec.ts`; `visual/token-repaint.vr.spec.ts` | Planned |
| FR-THEME-04 | Eleven brand values incl. logo, favicon, title | I, E | `web/theming/brand-values.int.spec.ts`; `e2e/backoffice/theming.spec.ts` | Planned |
| FR-THEME-05 | Typography values; fallback stack required | U, I | `web/theming/typography.spec.ts`; `web/theming/typography.int.spec.ts` | Planned |
| FR-THEME-06 | Layout values incl. density through tokens | E, N | `e2e/backoffice/theming.spec.ts`; `visual/density.vr.spec.ts` | Planned |
| FR-THEME-07 | light / dark / system; every token defined in both | N | `visual/theme-modes.vr.spec.ts`; `nfr/a11y/theme-modes.a11y.spec.ts` | Planned |
| FR-THEME-08 | LTR/RTL tied to language, logical properties | N, S | `nfr/i18n/rtl-mirroring.i18n.spec.ts`; `gates/logical-properties.gate.ts` | Planned |
| FR-THEME-09 | Named skins; shipped skins not editable in place | I, E | `web/theming/skins.int.spec.ts`; `e2e/backoffice/theming.spec.ts` | Planned |
| FR-THEME-10 | Versioned JSON export; round-trip exact | U, E | `web/theming/skin-export.spec.ts`; `e2e/backoffice/theming.spec.ts` | Planned |
| FR-THEME-11 | Import validated as untrusted; no partial apply | U, N | `web/theming/skin-import.spec.ts`; `nfr/sec/skin-import.sec.spec.ts` | Planned |
| FR-THEME-12 | Live preview, save/reset, never half-applied | E | `e2e/backoffice/theming.spec.ts` | Planned |
| FR-THEME-13 | Resolution user → tenant → system default | U, I | `web/theming/resolution-order.spec.ts`; `web/theming/resolution.int.spec.ts` | Planned |
| FR-THEME-14 | Server-side resolution inlined on first paint | E | `e2e/backoffice/theme-first-paint.spec.ts` | Planned |
| FR-THEME-15 | Tenant theme in-schema; no cross-tenant render | I | `isolation/branding-bleed.spec.ts` | Planned |
| FR-THEME-16 | AA contrast computed at save; text pairs blocked | U, N | `web/theming/contrast.spec.ts`; `nfr/a11y/contrast.a11y.spec.ts` | Planned |
| FR-THEME-17 | Keyboard-reachable restore from an unreadable theme | E, N | `e2e/backoffice/theming.spec.ts`; `nfr/a11y/theme-restore.a11y.spec.ts` | Planned |
| FR-THEME-18 | Scope authority enforced server-side | I, N | `web/theming/scope-authority.int.spec.ts`; `nfr/sec/authz-matrix.sec.spec.ts` | Planned |
| FR-THEME-19 | Build fails on arbitrary value or physical property | S | `gates/token-lint.gate.ts`; `gates/logical-properties.gate.ts` | Planned |
| FR-THEME-20 | Widget accent resolves through the same tokens | I, E | `web/channels/widget-token-binding.int.spec.ts`; `e2e/journeys/embed-host-page.spec.ts` | Planned |

### 12.17 `userguide` — FR-GUIDE (10)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| FR-GUIDE-01 | Help control on every authenticated page | E, N | `e2e/backoffice/user-guide.spec.ts`; `nfr/a11y/help-control.a11y.spec.ts` | Planned |
| FR-GUIDE-02 | Menu generated from the route/nav definition | U, S | `web/userguide/menu-generation.spec.ts`; `gates/guide-menu-matches-routes.gate.ts` | Planned |
| FR-GUIDE-03 | One entry per page; a gap fails the gate | S | `gates/guide-route-coverage.gate.ts` | Planned |
| FR-GUIDE-04 | Five structural elements present in every entry | U, S | `web/userguide/entry-schema.spec.ts`; `gates/guide-entry-completeness.gate.ts` | Planned |
| FR-GUIDE-05 | Search scoped to the user's permissions | I, E | `web/userguide/search.int.spec.ts`; `e2e/backoffice/user-guide.spec.ts` | Planned |
| FR-GUIDE-06 | Deep-linkable; help opens the current page's entry | E | `e2e/backoffice/user-guide.spec.ts` | Planned |
| FR-GUIDE-07 | EN/AR with direction-appropriate screenshots | N | `nfr/i18n/guide-locales.i18n.spec.ts` | Planned |
| FR-GUIDE-08 | Guide versioned with the application | U, S | `web/userguide/version-binding.spec.ts`; `gates/guide-version-match.gate.ts` | Planned |
| FR-GUIDE-09 | Screenshots auto-captured; staleness flagged | S | `gates/guide-screenshot-staleness.gate.ts` | Planned |
| FR-GUIDE-10 | Permission notes generated from the live matrix | U, S | `web/userguide/permission-notes.spec.ts`; `gates/guide-permission-notes.gate.ts` | Planned |

### 12.18 Security — NFR-SEC (25)

Rows 15–25 are the tenant-isolation set; their tests are the §5 suite. `NFR-SEC-15` is no longer uniform across the four stores and `NFR-SEC-25` is new — both follow ADR-0009 (see §5.2, §5.4, §16.4).

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| NFR-SEC-01 | Deny-by-default, server-side, every route | N | `nfr/sec/authz-matrix.sec.spec.ts` | Planned |
| NFR-SEC-02 | Secrets only in env; absent from repo/image/chart/logs | N, S | `nfr/sec/no-secrets-in-logs.sec.spec.ts`; `gates/secret-scan.gate.ts` | Planned |
| NFR-SEC-03 | TLS everywhere; mTLS on the web→ai hop | N | `nfr/sec/transport-security.sec.spec.ts` | Planned |
| NFR-SEC-04 | NetworkPolicy restricts ai, Neo4j, Qdrant reachability | N | `nfr/sec/network-policy.sec.spec.ts` | Planned |
| NFR-SEC-05 | Shared schema validation on both sides of every boundary | C, N | `contract/turn-request.contract.spec.ts`; `nfr/sec/schema-validation.sec.spec.ts` | Planned |
| NFR-SEC-06 | Retrieved content and uploads treated as untrusted | I, N | `ai/governance/test_prompt_injection_int.py`; `nfr/sec/retrieved-content-injection.sec.spec.ts` | Planned |
| NFR-SEC-07 | Rate limits fail closed with 429 | N | `nfr/sec/rate-limits.sec.spec.ts` | Planned |
| NFR-SEC-08 | Non-root, read-only rootfs, no toolchain | N | `nfr/sec/image-hardening.sec.spec.ts` | Planned |
| NFR-SEC-09 | Base images pinned by digest, labelled to a commit | S | `gates/image-pinning.gate.ts` | Planned |
| NFR-SEC-10 | Cookie attributes and opaque value | N | `nfr/sec/cookie-attributes.sec.spec.ts` | Planned |
| NFR-SEC-11 | Eight privileged action classes audited | N | `nfr/sec/privileged-action-census.sec.spec.ts` | Planned |
| NFR-SEC-12 | No PII, credentials or transcripts in logs | N | `nfr/obs/no-citizen-text-in-logs.obs.spec.ts`; `nfr/sec/no-secrets-in-logs.sec.spec.ts` | Planned |
| NFR-SEC-13 | Dependency and image scanning inside `verify` | S | `gates/vulnerability-scan.gate.ts` | Planned |
| NFR-SEC-14 | CSP asserted on backoffice and widget | N | `nfr/sec/csp.sec.spec.ts` | Planned |
| NFR-SEC-15 | Physical unit in SQL/Qdrant/Redis; **logical** label + `tenant_id` in Neo4j | I, U | `isolation/tenant-isolation.spec.ts` (cases 1, 2, 4, 5); `ai/knowledge/test_graph_isolation_int.py` (G1–G10); `isolation/graph-isolation.spec.ts` (G11–G13, G15); `ai/knowledge/test_graph_query_builder.py` (G16) | Planned |
| NFR-SEC-16 | Tenant from principal only; four forgery vectors | I | `isolation/tenant-isolation.spec.ts` (cases 6–10) | Planned |
| NFR-SEC-17 | Context request-scoped, no tenant argument | I, S | `isolation/tenant-isolation.spec.ts` (case 13); `gates/tenant-param.gate.ts` | Planned |
| NFR-SEC-18 | No unscoped store client exported | S, U | `gates/no-unscoped-client-export.gate.ts`; `gates/no-raw-cypher.gate.ts`; `ai/knowledge/test_graph_query_builder.py` (G16) | Planned |
| NFR-SEC-19 | Names derived from a validated slug | I, S | `isolation/tenant-isolation.spec.ts` (case 11); `isolation/graph-isolation.spec.ts` (G15 label injection); `gates/no-input-interpolated-handles.gate.ts` | Planned |
| NFR-SEC-20 | Exactly two audited cross-tenant paths | I, S | `isolation/escape-hatches.spec.ts`; `gates/cross-tenant-path-census.gate.ts` | Planned |
| NFR-SEC-21 | Retrieval, embedding, traversal, cache all scoped | I | `isolation/vector-retrieval.spec.ts`; `ai/knowledge/test_graph_isolation_int.py` (G3, G4, G10); `ai/knowledge/test_graph_post_filter_int.py` (G14) | Planned |
| NFR-SEC-22 | No branding bleed, including through cache/CDN | I | `isolation/branding-bleed.spec.ts` | Planned |
| NFR-SEC-23 | Retention/erasure/residency per tenant | I | `isolation/retention-per-tenant.spec.ts` | Planned |
| NFR-SEC-24 | `tenant-isolation.spec` is a release gate | I, U, S | `isolation/tenant-isolation.spec.ts` (all 34 cases — the 18 store/forgery/hatch cases plus the 16-case graph set of §5.2, run as one gate) | Planned |
| NFR-SEC-25 | Mandatory tenant-aware graph query builder; no raw Cypher; post-retrieval re-filter | U, I, S | `ai/knowledge/test_graph_query_builder.py` (G16); `ai/knowledge/test_graph_isolation_int.py` (G1–G10); `ai/knowledge/test_graph_post_filter_int.py` (G14); `gates/no-raw-cypher.gate.ts` | Planned |

### 12.19 Performance — NFR-PERF (10)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| NFR-PERF-01 | Retrieval p95 ≤ 350 ms incl. rerank | N | `nfr/perf/retrieval.k6.js` | Planned |
| NFR-PERF-02 | MCP invocation p95 ≤ 300 ms | N | `nfr/perf/mcp-gateway.k6.js` | Planned |
| NFR-PERF-03 | WhatsApp BSP egress p95 ≤ 250 ms | N | `nfr/perf/whatsapp-egress.k6.js` | Planned |
| NFR-PERF-04 | >1,500 ms or >5% ⇒ degraded, breaker trips | U, N | `web/governance/degradation-thresholds.spec.ts`; `nfr/perf/degradation-trigger.k6.js` | Planned |
| NFR-PERF-05 | TTFT p95 ≤ 2,000 ms; processing ≤ 300 ms | N | `nfr/perf/assistant-turn.k6.js` | Planned |
| NFR-PERF-06 | Backoffice FMC p95 ≤ 1,000 ms; interaction ≤ 100 ms | N | `nfr/perf/backoffice-screens.k6.js` | Planned |
| NFR-PERF-07 | Server-side pagination; no unbounded collection | N, S | `nfr/perf/explorer-at-volume.k6.js`; `gates/no-unbounded-list.gate.ts` | Planned |
| NFR-PERF-08 | Re-index does not breach conversational budgets | N | `nfr/perf/reindex-under-load.k6.js` | Planned |
| NFR-PERF-09 | Independent HPAs, ≥2 replicas each | N | `nfr/perf/independent-scaling.k6.js` | Planned |
| NFR-PERF-10 | Bounded per-tenant pooling at 20 tenants | N | `nfr/perf/tenant-pooling.k6.js` | Planned |

### 12.20 Accessibility — NFR-A11Y (8)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| NFR-A11Y-01 | AA on all 19 surfaces + manual hard-organism pass | N | `nfr/a11y/all-screens.a11y.spec.ts`; `nfr/a11y/permission-matrix.a11y.spec.ts`; `nfr/a11y/graph-canvas.a11y.spec.ts`; `nfr/a11y/flow-canvas.a11y.spec.ts` | Planned |
| NFR-A11Y-02 | Keyboard-operable, visible focus, no traps | N | `nfr/a11y/keyboard-walkthrough.a11y.spec.ts` | Planned |
| NFR-A11Y-03 | Status never colour alone; greyscale interpretable | N | `nfr/a11y/status-not-colour.a11y.spec.ts`; `visual/status-greyscale.vr.spec.ts` | Planned |
| NFR-A11Y-04 | Text and non-text contrast validated at save | U, N | `web/theming/contrast.spec.ts`; `nfr/a11y/contrast.a11y.spec.ts` | Planned |
| NFR-A11Y-05 | `prefers-reduced-motion` honoured | N | `nfr/a11y/reduced-motion.a11y.spec.ts` | Planned |
| NFR-A11Y-06 | Live regions announce dynamic content | N | `nfr/a11y/live-regions.a11y.spec.ts` | Planned |
| NFR-A11Y-07 | Empty/loading/error/denied states everywhere | N | `nfr/a11y/list-states.a11y.spec.ts` | Planned |
| NFR-A11Y-08 | Charts have accessible non-visual equivalents | N | `nfr/a11y/chart-equivalents.a11y.spec.ts` | Planned |

### 12.21 Internationalisation — NFR-I18N (8)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| NFR-I18N-01 | EN/AR everywhere; no hardcoded user-visible string | N, S | `nfr/i18n/locale-coverage.i18n.spec.ts`; `gates/no-hardcoded-strings.gate.ts` | Planned |
| NFR-I18N-02 | RTL correct; logical properties only | N, S | `nfr/i18n/rtl-mirroring.i18n.spec.ts`; `gates/logical-properties.gate.ts` | Planned |
| NFR-I18N-03 | Completeness computed and consumed by the gate | I, N | `nfr/i18n/completeness.i18n.spec.ts`; `ai/evaluation/test_gate_reads_live_locale.py` | Planned |
| NFR-I18N-04 | Locale and direction change as one action | U, N | `web/theming/direction-binding.spec.ts`; `nfr/i18n/rtl-mirroring.i18n.spec.ts` | Planned |
| NFR-I18N-05 | Locale formatting; timestamps stored UTC | U, N | `web/platform/formatting.spec.ts`; `nfr/i18n/formatting.i18n.spec.ts` | Planned |
| NFR-I18N-06 | Missing string falls back and is counted | N | `nfr/i18n/fallback.i18n.spec.ts` | Planned |
| NFR-I18N-07 | Arabic retrieval quality as a first-class dimension | Q | `eval/retrieval_quality.eval.py`; `eval/answer_quality.eval.py` | Planned |
| NFR-I18N-08 | Locale-specific TTS voice | N | `nfr/i18n/tts-voice.i18n.spec.ts` | Planned |

### 12.22 Observability — NFR-OBS (9)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| NFR-OBS-01 | One trace id web → ai → tool → store | N | `nfr/obs/trace-propagation.obs.spec.ts` | Planned |
| NFR-OBS-02 | Tenant/env/conversation/agent on every record | N | `nfr/obs/telemetry-attributes.obs.spec.ts` | Planned |
| NFR-OBS-03 | No PII or credentials in telemetry | N | `nfr/obs/no-citizen-text-in-logs.obs.spec.ts` | Planned |
| NFR-OBS-04 | Per-dependency p95/error rate; "no data" not stale | N | `nfr/obs/dependency-metrics.obs.spec.ts` | Planned |
| NFR-OBS-05 | Probes incl. an `shj3-ai` startup budget | N | `nfr/obs/probes.obs.spec.ts` | Planned |
| NFR-OBS-06 | Token/cost/provider per call, queryable three ways | I, N | `ai/orchestration/test_cost_accounting_int.py`; `nfr/obs/cost-records.obs.spec.ts` | Planned |
| NFR-OBS-07 | Every guardrail decision explainable | I, N | `ai/governance/test_decision_recording_int.py`; `nfr/obs/guardrail-decisions.obs.spec.ts` | Planned |
| NFR-OBS-08 | Run record per job type; failures visible | N | `nfr/obs/job-runs.obs.spec.ts` | Planned |
| NFR-OBS-09 | Authenticated health endpoint names unreachable stores | N | `nfr/obs/health-endpoint.obs.spec.ts` | Planned |

### 12.23 Data — NFR-DATA (12)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| NFR-DATA-01 | SQL is SoR; derived stores fully rebuildable | I | `ai/knowledge/test_derived_store_rebuild_int.py` | Planned |
| NFR-DATA-02 | Redis loss destroys no record | I, N | `nfr/data/redis-flush-survivable.data.spec.ts` | Planned |
| NFR-DATA-03 | Prisma sole schema owner; no second tool | S | `gates/single-migration-tool.gate.ts` | Planned |
| NFR-DATA-04 | Generated SQLAlchemy models; drift fails the gate | S | `gates/prisma-sqlalchemy-drift.gate.ts` | Planned |
| NFR-DATA-05 | `shj3-ai` writes exactly three table groups | I | `ai/platform/test_write_grants_int.py` | Planned |
| NFR-DATA-06 | Retention four options, all stores purged | N | `nfr/data/retention.data.spec.ts` | Planned |
| NFR-DATA-07 | 7-year transaction retention structural | N, S | `nfr/data/transaction-carveout.data.spec.ts`; `gates/purge-scope-excludes-transactions.gate.ts` | Planned |
| NFR-DATA-08 | PII masked before persistence in every store | I, N | `ai/governance/test_pii_masked_before_persist_int.py`; `nfr/data/pii-at-rest.data.spec.ts` | Planned |
| NFR-DATA-09 | SoR-first writes via outbox; no 2PC | I, S | `web/knowledge/outbox-ordering.int.spec.ts`; `gates/no-two-phase-commit.gate.ts` | Planned |
| NFR-DATA-10 | Per-tenant SQL restore; graph and Qdrant by re-index | N, I | `nfr/data/restore-drill.data.spec.ts` (runbook-verified, §16.5); `ai/knowledge/test_graph_rebuild_int.py` | Planned |
| NFR-DATA-11 | Exact decimal money with explicit currency | U, I | `web/payments/money.spec.ts`; `web/payments/transaction-log.int.spec.ts` | Planned |
| NFR-DATA-12 | Provable erasure across four stores, per store report | N | `nfr/data/erasure-completeness.data.spec.ts` | Planned |

### 12.24 Operations — NFR-OPS (12)

| ID | Summary | Layer | Test identifier | Status |
|---|---|---|---|---|
| NFR-OPS-01 | Multi-stage non-root images, healthcheck, version label | N | `nfr/sec/image-hardening.sec.spec.ts`; `gates/image-labels.gate.ts` | Planned |
| NFR-OPS-02 | One `docker compose up`, four stores, ≥2 tenants seeded | I | `e2e/fixtures/compose-stack-health.spec.ts`; `e2e/fixtures/seed-determinism.spec.ts` | Planned |
| NFR-OPS-03 | One chart, three env value sets matching the product | S | `gates/helm-values-render.gate.ts`; `gates/env-names-match-helm.gate.ts` | Planned |
| NFR-OPS-04 | Requests/limits everywhere; ai limits larger | S | `gates/helm-resource-limits.gate.ts` | Planned |
| NFR-OPS-05 | Secrets referenced by name only in the chart | S | `gates/helm-no-secret-values.gate.ts` | Planned |
| NFR-OPS-06 | PDBs and a rolling update that drops no turn | N | `nfr/perf/rolling-update-no-turn-loss.k6.js` | Planned |
| NFR-OPS-07 | Six mandatory pre-commit gates, in the first commit | S | `gates/precommit-config.gate.ts` | Planned |
| NFR-OPS-08 | One command runs the full gate, one exit code | S | `gates/verify-completeness.gate.ts` | Planned |
| NFR-OPS-09 | Suite is CI-ready: unattended, deterministic, containerised | S | `gates/ci-readiness.gate.ts` (no prompts, no manual steps, pinned seed) | Planned |
| NFR-OPS-10 | Scripted release tags both images identically | S | `gates/release-script.gate.ts` | Planned |
| NFR-OPS-11 | Module boundaries enforced for all 17 modules | S | `gates/module-boundaries.gate.ts` | Planned |
| NFR-OPS-12 | Zero vendor imports in domain/application; swap test | S, U | `gates/inner-layer-purity.gate.ts`; `ai/platform/test_adapter_swap.py` | Planned |

### 12.25 Row count

| Group | Rows |
|---|---|
| FR-PLAT · FR-IAM · FR-CONV | 10 · 18 · 16 |
| FR-AGENT · FR-ORCH · FR-TOOL | 21 · 14 · 22 |
| FR-KNOW · FR-FLOW · FR-HAND | 26 · 12 · 21 |
| FR-CHAN · FR-VERI · FR-PAY | 23 · 14 · 10 |
| FR-GOV · FR-EVAL · FR-ANLY | 29 · 15 · 13 |
| FR-THEME · FR-GUIDE | 20 · 10 |
| **Functional subtotal** | **294** |
| NFR-SEC · NFR-PERF · NFR-A11Y · NFR-I18N | 25 · 10 · 8 · 8 |
| NFR-OBS · NFR-DATA · NFR-OPS | 9 · 12 · 12 |
| **Non-functional subtotal** | **84** |
| **Total** | **378** |

Unmapped: **0**. `Passing`: **0**. The project is not done.

---

## 13. Coverage reporting

Two reports. One gates; the other informs.

### 13.1 Per-requirement coverage — the gating report

`scripts/requirement-coverage.ts` reads the JSON reports emitted by Vitest, pytest, Playwright and k6, extracts every `covers(...)` annotation, joins them against the requirement inventory parsed from `requirements.md`, and emits `reports/requirement-coverage.json` plus a Markdown summary.

```bash
pnpm verify                     # runs everything, writes the JSON reports
pnpm coverage:requirements      # joins annotations → requirement IDs
# → 378 requirements · 378 mapped · 0 unmapped
# → Passing 0 · Implemented 0 · Planned 378
# → FAIL: 378 requirements without a passing test
```

Rules the script enforces:

1. **Every requirement ID in `requirements.md` must appear in this matrix.** An ID present upstream and absent here fails the script — that is how a new requirement cannot be added without a test row.
2. **Every `covers()` ID must exist.** A typo'd or withdrawn ID fails, so annotations cannot silently drift.
3. **Every test must carry at least one `covers()`.** An unattributed test cannot move a row.
4. **A row is `Passing` only if every test named in it passed in the same run.** One failing test in a row of three sets the row back to `Implemented`.
5. **The report is per requirement.** It prints counts by status and by module, and lists the unverified rows by ID. That list is the phase gate.

### 13.2 Line and branch coverage — a secondary signal only

Conventional coverage is collected and thresholded, because a collapse in it usually means a whole area went untested. It **does not gate a phase**.

| Scope | Line | Branch |
|---|---|---|
| `web/**/domain`, `web/**/application` | 90% | 85% |
| `ai/**/domain`, `ai/**/application` | 90% | 85% |
| `web/**/adapters`, `ai/**/adapters` | 75% | 65% |
| Everything else | 60% | 50% |

Stated plainly: **the per-requirement report gates a phase; the line/branch report is diagnostic.** 100% line coverage with 200 unverified requirement rows is a failed deliverable, and the reverse is fine.

---

## 14. Gates

### 14.1 Standing gates — every commit, every slice, every release

Five gates run at every level, and none of them is skippable:

| Gate | Command | Fails on |
|---|---|---|
| **Tenant isolation** (§5) | `pnpm test:isolation` | Any case in the 34-case matrix, graph set included. `NFR-SEC-24`: a release with this suite unrun or failing is not a release |
| **No raw Cypher outside the graph adapter** | `pnpm lint:cypher` | A Cypher string literal — `MATCH`, `MERGE`, `CREATE`, `CALL db.` — anywhere outside `adapters/outbound/graph/`, in either runtime, tests and seed scripts included. ADR-0009 rule 2's mechanical half: it is what stops "the builder is mandatory" from decaying into a review convention (`NFR-SEC-25`) |
| **Prisma → SQLAlchemy drift** | `pnpm db:generate --check` | A non-empty diff after regeneration, or a hand-edited generated model. ADR-0005's sole protection against the two-migration-tool corruption scenario |
| **Token / style lint** | `pnpm lint:tokens` | A literal colour, radius, spacing, shadow or font-size in feature code; a direct primitive-token reference; a physical CSS direction property (`FR-THEME-02`, `FR-THEME-19`, `NFR-I18N-02`) |
| **Contrast** | `pnpm test:contrast` | Any shipped skin or default theme whose text token pair falls below WCAG 2.1 AA (`FR-THEME-16`, `NFR-A11Y-04`) |

**The same caveat applies to all five, and it applies hardest to the newest one.** `--no-verify` bypasses a pre-commit hook, and with no CI nothing else runs it (RISK-002, RISK-011, §15.3). For the drift check the consequence is a corrupt schema; for the Cypher check the consequence is an unscoped graph query on `main` with no infrastructure boundary behind it. The two are the same class of exposure and the second is newly created by ADR-0009.

Plus the structural gates: module-boundary check across all 17 modules (`NFR-OPS-11`), zero vendor imports in `domain/` and `application/` in both runtimes (`NFR-OPS-12`), no unscoped store client exported (`NFR-SEC-18`), no tenant parameter in application-layer signatures (`NFR-SEC-17`), no unbounded list endpoint (`NFR-PERF-07`).

### 14.2 Before a Phase B slice advances

A slice is one module or one vertical journey. It advances when:

1. Every requirement row owned by the slice is `Passing` in a recorded `verify` run — not `Implemented`.
2. The five standing gates pass.
3. The slice's cross-module wiring rows (§10) pass, if it touches a seam.
4. axe reports zero AA violations on any screen the slice added or changed, and the keyboard model is hand-tested for any new hard organism.
5. Its user-guide entry and screenshot exist and are current (`FR-GUIDE-03`, `FR-GUIDE-09`) — a page with no guide entry fails review.
6. `docs/` is updated in the same commit, including this matrix's status column.

### 14.3 Before release

Everything in 14.2 for every slice, plus:

1. **All 378 rows `Passing`.** The project cannot be declared done otherwise (§1).
2. The full isolation suite green against a Compose stack with at least two provisioned tenants — including all 16 graph cases, and with `GRAPH_QUERY_PATHS` reconciled against the `GraphStore` port so no path shipped without a negative test (§5.2).
3. k6 profiles within budget, **including** re-index-under-load, which is the demonstration ADR-0001 owes.
4. Security suite green; secret scan clean over repository, both images and the Helm chart.
5. Erasure and retention suites green across all four stores.
6. Guide coverage 100% of routes; no stale screenshot flags.
7. Evaluation trend reviewed and accepted by a human, with the Arabic numbers reported separately (§8.3).
8. RISK-001's residency position recorded — no production deployment carrying real citizen data without it.
9. **RISK-024 reviewed.** ADR-0009 makes it a standing risk reviewed at every release, not a one-off: confirm the graph query-path list is complete, the no-raw-Cypher gate ran, and the label/property reconciliation and cross-tenant-edge assertions (G11, G12) are green against production-shaped data.

---

## 15. CI-readiness and the no-CI reality

**There is no CI/CD.** The product owner declined it (ADR-0008). Pre-commit hooks plus a single `pnpm verify` / `make verify` are the only enforcement that exists. This section is deliberately honest about what that means.

### 15.1 The suite is written CI-ready anyway

Non-negotiable, per ADR-0008 rule 3 and `NFR-OPS-09`: **no manual steps, no interactive prompts, deterministic seeds, containerised dependencies.** Every suite runs unattended from a clean checkout. No test asks for a credential, opens a browser for a human, depends on a developer's local database, or requires a `.env` a person has to assemble by hand.

**The reason is specific:** adding a pipeline later must be a YAML file, not a suite refactor. A suite that assumes a human present is the single most expensive thing to retrofit, so it is respected now, while there is no pipeline to prove it. Concretely: containerised stores, a pinned seed epoch, a controllable clock, stubbed model providers, sharded Playwright with retries disabled by default, machine-readable JSON reports, and a single exit code.

### 15.2 What runs where

| Stage | Contents | Expected duration |
|---|---|---|
| **Pre-commit** (mandatory, `NFR-OPS-07`, present in the first commit) | format, lint, typecheck, token lint, module-boundary check, **Prisma→SQLAlchemy drift check**, **no-raw-Cypher check** (ADR-0009 rule 2), unit tests on changed packages | 45–90 s |
| **`pnpm verify` / `make verify`** (`NFR-OPS-08`) | everything in pre-commit + integration + contract + E2E + a11y + security + i18n + visual + data + observability + dependency and image scan + the per-requirement coverage report | 30–45 min on a developer machine |
| **On demand / before release** | k6 load profiles, the evaluation suite, per-tenant restore drill | 1–2 h |

`verify` returns one exit code. **"Green" has exactly one meaning** — that command passed. Nothing else may be called green.

### 15.3 The exposure: RISK-002

Stated without softening. `requirements.md` RISK-002 and ADR-0008 both record it:

> **A `git commit --no-verify` bypasses every gate.** A schema-drift change, a failing test, a boundary violation, a token-lint violation **or a raw Cypher query written outside the graph adapter** can land on `main`, and with no pipeline **nothing catches it**. The drift check is the *sole* protection against the two-migration-tool schema-corruption scenario ADR-0005 exists to prevent, and the no-raw-Cypher check is the *sole* mechanical protection for the graph's tenant boundary now that ADR-0009 has removed the infrastructure one. Both are one flag away from being skipped. Phase D's own requirement that E2E run "in CI with no manual steps" cannot be met, because there is no CI.

Contained today by there being one committer and by discipline. Not contained the moment there are two: with two committers, nothing tells the second that the first bypassed a hook, and the drift can sit undetected until a migration corrupts a schema.

**Recommendation, unchanged from ADR-0008:** adopt CI **before a second person commits to this repository.** The trigger is explicit and the work is small — `verify` already exists, the suite is already CI-ready, and Azure DevOps is the preferred target if hosting lands on Azure. Until then, the reviewer is trusted to run `verify` and paste its output on the change; a change without that output has not been verified, whatever its diff looks like.

---

## 16. Known testing gaps

Deliberate exclusions, stated so nobody assumes coverage that does not exist.

**16.1 The mock verification adapter — a green step-up suite is not proof that real verification works.** Stated plainly, as ADR-0006 requires. `VerificationProvider`'s mock implements all four assurance levels and is drivable to any state (`FR-VERI-08`), and the step-up suite genuinely proves that *SHJ3's* logic gates correctly: the ladder is enforced, the ordering is right, the refusals fire. What it cannot prove is that UAE PASS returns what we assume, in the shape we assume, with the latency we assume, and fails in the ways we assume. **Until UAE PASS is connected, the assurance guarantees are only as good as the mock.** `FR-VERI-09`'s boot-time refusal prevents the worst failure mode (a mocked verification path in front of real payments), but prevention is not verification. The payment journey cannot go live on the mock. RISK-004.

**16.2 Kiosk / IVR is configurable but unmocked.** The channel exists (`FR-CHAN-01`), ships `Disabled`, and Emirates ID scan remains a configurable verification method for it (`FR-VERI-01`). Neither rendered surface exists, so neither is tested beyond its configuration. L3 (document-verified) is therefore defined and testable against the mock but gates no seeded action (RISK-006). When kiosk ships, it needs its own E2E surface and its own a11y pass.

**16.3 Load testing runs against stubbed model providers.** Real providers cost real money per request, and a k6 ramp to 60 concurrent turns for 10 minutes is a bill, not a build step. Load profiles therefore run against a latency-injecting stub calibrated to observed provider p50/p95. The consequence: **our load numbers measure SHJ3, not the end-to-end citizen experience.** Provider latency and rate limits are a separate, smaller, manually-run soak — **[ASSUMPTION]** one 15-minute low-concurrency soak against real providers before each release, sufficient to catch a rate-limit ceiling or a gross latency regression, and not sufficient to characterise behaviour at peak.

**16.4 A green graph isolation suite is evidence about the query paths that were tested, and nothing more.** RISK-024, which replaces the now-closed RISK-003 (ADR-0009). This is the honest successor to the licensing gap that used to sit here, and it is a worse gap, not a better one.

There is no Neo4j Enterprise licence, so graph tenant isolation is enforced entirely in application code: a `:Tenant_<slug>` label, a `tenant_id` predicate, a mandatory query builder, a static ban on raw Cypher and a post-retrieval re-filter. Community edition provides **neither a database boundary nor fine-grained RBAC**, so unlike SQL Server — where ADR-0005's grant makes an AI-service write mistake fail *at the database*, whatever the code did — the graph has **no infrastructure or database-level fallback**. Nothing below the application catches a mistake above it.

The testing consequence follows directly, and it is the asymmetry that matters:

- For SQL Server, Qdrant and Redis, a passing isolation case generalises. The case proves a handle scoped to A cannot address B's unit, and that is true for every query anyone will ever write against that handle, including the ones written after this suite was.
- For the graph, a passing case generalises to **that query path and no further**. G1–G10 prove that ten specific paths were scoped on the day they ran. They say nothing about the eleventh.

Stated plainly: **a graph query path added later without a matching negative test is an untested leak.** Not a coverage gap to schedule — a path through which one tenant's entities may be quoted back to another tenant's citizen, with no boundary underneath and nothing but review standing between it and production. This is precisely why §5.2's convention is per query path rather than per store, why `GRAPH_QUERY_PATHS` is derived from the `GraphStore` port rather than hand-listed, and why G16 parametrises over the operation list — those three mechanisms are the only things that turn "remember to add a test" into "the suite fails". They are also, all three, inside the same codebase they are policing, and `--no-verify` skips the gate that enforces the third (§15.3).

Two honest bounds on the mitigation. First, the derived-store fact cuts one way only: the graph holds no system of record and is rebuildable by re-index (ADR-0003 rule 1), so **losing it is recoverable and leaking it is not** — rebuildability is no comfort here. Second, ADR-0009's own follow-up is the real long-term answer: if production traversals prove to be one or two hops, moving the graph into SQL Server restores physical isolation at little capability cost. Hop depth should be measured in UAT, and this gap should be re-read when that number exists.

**16.5 Other deliberate exclusions.**

- **Chaos and partial-failure engineering** beyond the specific injected failures named in this document (provisioning step failures, derived-write failure, audit-write failure, rerank outage, model error/timeout, breaker states). No systematic fault injection across store partitions.
- **Multi-region and residency-swap testing.** RISK-001's self-hosted BGE-M3 path is a spike measured on the Arabic parity set (§7.2), not a tested deployment.
- **Cross-browser breadth.** Chromium for the backoffice, plus Firefox for the citizen widget. No Safari or mobile-browser matrix; the widget's host portal is out of scope (`requirements.md` §4.1).
- **Bulk operations, ontology designer, prompt library, cost-management UI, general notification system** — deferred features (`requirements.md` §2.3), so untested by construction.
- **Restore drills are manual.** `NFR-DATA-10`'s per-tenant SQL Server restore is a runbook exercise verified before release, not an automated suite. Qdrant is not backed up at all — its recovery path is re-index, which *is* automated (`NFR-DATA-01`). Under ADR-0009 the graph joins Qdrant rather than SQL Server here: Community cannot restore one tenant out of a shared database, so graph recovery is re-index (`ai/knowledge/test_graph_rebuild_int.py`, §7.1) and a Neo4j backup is an optimisation rather than a tested dependency.
- **Visual regression baselines are human-approved.** A snapshot diff is a prompt for judgement, not a defect.

No item above is a TODO. Each is a decision, and each is the reason a specific claim in this document is bounded.
