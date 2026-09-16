# SHJ3 — Documentation

An agentic government-services assistant for the Emirate of Sharjah, plus the backoffice that builds, governs and operates it.

`docs/` is a living deliverable, not a hand-off artefact. It is updated **in the same commit** as the change it describes. Undocumented work is unfinished work.

---

## Start here

| Document | What it answers |
|---|---|
| [`SHJ3-wireframes-guide.md`](./SHJ3-wireframes-guide.md) | **The functional baseline.** Screen-by-screen specification of the 17-screen clickable prototype — purpose, layout, components, seeded data, interactions and the business rules each screen encodes. Every other document traces back to this. |
| [`requirements/`](./requirements/README.md) | Validated requirements with stable IDs, scope boundaries, actors, non-functionals and open risks — split one file per module, plus the Pipeline Designer under `requirements/orchestration.md`. |
| [`architecture.md`](./architecture.md) | The binding architecture — two runtimes, 17 modules, layering, tenancy enforcement, data ownership, the agent runtime pipeline. |
| [`data-model.md`](./data-model.md) | Entities and relationships across all four stores, tenancy keys, the cross-store `chunk_id` contract, retention and erasure. |
| [`api.md`](./api.md) | The three API surfaces (citizen, backoffice, internal), the error model, and the ports that keep the domain vendor-agnostic. |
| [`design-system.md`](./design-system.md) | Design tokens, component library, the skin JSON schema, accessibility and RTL. |
| [`deployment.md`](./deployment.md) | Environments, container and Helm specifications, and the operational runbooks. |
| [`testing.md`](./testing.md) | Test strategy and the requirement → test traceability matrix. |

Delivery progress lives outside `docs/`, in [`../tasks/todo.md`](../tasks/todo.md).

---

## Decisions

Every architectural decision is an ADR in [`adr/`](./adr/). Decisions are not edited in place — changing one means writing a new ADR that supersedes it.

| ADR | Decision | Why it matters |
|---|---|---|
| [0001](./adr/0001-modular-monolith-across-two-runtimes.md) | Modular monolith across two runtimes | Resolves the tension between a monolith style and a polyglot stack. Caps the system at **exactly two** deployables. |
| [0002](./adr/0002-schema-per-tenant-isolation.md) | Schema-per-tenant, carried into all four stores | Neo4j and Qdrant have no schemas, so tenancy had to be defined per store. Isolation is infrastructure, not query discipline. |
| [0003](./adr/0003-polyglot-persistence.md) | Four stores, one role each | Prevents the failure where the same fact lives in two stores and they disagree. |
| [0004](./adr/0004-llm-gateway-and-retrieval-models.md) | OpenRouter chat, OpenAI embeddings, Cohere rerank | Model identity becomes configuration. Carries the open residency risk. |
| [0005](./adr/0005-prisma-owns-schema-sqlalchemy-reads.md) | Prisma owns the schema; SQLAlchemy is generated | Two ORMs on one database, one owner. Drift is mechanically impossible. |
| [0006](./adr/0006-identity-behind-a-port.md) | Local auth now, SSO later, port from day one | Makes "SSO later" one adapter instead of a rewrite, and makes step-up rules testable before UAE PASS exists. |
| [0007](./adr/0007-design-system-and-runtime-theming.md) | shadcn/ui + Tailwind, runtime CSS-variable tokens | The theming requirement is architectural; it rules out JS-object theming. |
| [0008](./adr/0008-deployment-targets.md) | Docker, Compose, Helm; no CI/CD yet | Records the accepted waiver of the project's own quality gate, and the weaker mitigation replacing it. |
| [0009](./adr/0009-logical-graph-partitioning.md) | Logical graph partitioning on Neo4j Community | Amends 0002 after the Enterprise licence was declined. States plainly that the graph's isolation is now a code property, and what defends it instead. |
| ~~[0010](./adr/0010-raw-sql-for-tenant-runtime-queries.md)~~ | Raw SQL for tenant queries | **Superseded same-day by 0011.** Kept for the record — correctly found that a unified Prisma file couldn't route tenant queries, but the fix it chose (drop the ORM for tenant data) was not the cheapest correct one. |
| [0011](./adr/0011-split-platform-and-tenant-prisma-schemas.md) | Split platform/tenant Prisma schemas, drop `multiSchema` | Found by testing the isolation suite against real containers: `getTenantDb()`'s per-tenant connection-string routing was silently broken by Prisma's `multiSchema` feature. Splitting into two plain schema files fixes it while keeping full ORM ergonomics for 107 of 112 tenant models. |

---

## The stack, in one table

| Layer | Choice |
|---|---|
| Architecture | Modular monolith, two deployables |
| Web / BFF | Next.js App Router, TypeScript, Node 22 |
| AI runtime | Python 3.12, FastAPI, Google ADK |
| System of record | SQL Server — schema per tenant |
| Knowledge graph | Neo4j **Community** — single database, logical tenant partitioning (ADR-0009) |
| Vector index | Qdrant — collection per tenant |
| Ephemeral | Redis — key prefix per tenant, not backed up |
| Data access | Prisma (schema owner) · SQLAlchemy 2.0 (generated, read-mostly) |
| Chat models | OpenRouter via LiteLLM via ADK |
| Embeddings | OpenAI `text-embedding-3-large` (3072-dim) |
| Reranking | Cohere `rerank-v3.5` |
| UI | shadcn/ui + Tailwind, runtime CSS-variable tokens |
| Auth | Local accounts behind a port; OIDC / UAE PASS later |
| Deployment | Docker · Docker Compose · Kubernetes (Helm) |
| CI/CD | None — pre-commit hooks and `verify` are the gate |

---

## Open risks

Twenty-five tracked, of which two are closed (RISK-003, RISK-025) and five are decided. Two registers, one numbering space:

- **[`requirements/risks.md`](./requirements/risks.md)** — product and requirements risks (RISK-001–010, 022–026), each with impact, likelihood, mitigation and **who must decide**.
- **[`deployment.md` §17](./deployment.md)** — operational risks (RISK-011–021), each with severity, source, mitigation and owner. It also restates 001–010 so the numbering is unambiguous in one place.

Review cadence: RISK-001–004 and 010–012 at every release; the rest monthly.

### Stack and delivery risks

| ID | Risk | Blocks |
|---|---|---|
| **RISK-001** | Chat, embeddings and reranking send citizen text to OpenRouter, OpenAI and Cohere — conflicting with the *UAE — Sharjah data centre* residency default the product itself exposes (B14 tab 4). Needs a signed exception or a swap to self-hosted BGE-M3. | Production |
| **RISK-002** | No CI/CD, so nothing enforces lint, typecheck or tests on a shared branch — including the schema-drift check that is the sole protection against the ADR-0005 corruption scenario. | Revisit before a second committer |
| ~~**RISK-003**~~ | Neo4j Enterprise licence. **Closed 2026-09-08 — resolved negative.** No licence available, so ADR-0002's database-per-tenant is amended by [ADR-0009](./adr/0009-logical-graph-partitioning.md). Replaced by RISK-024. | Closed |
| **RISK-024** | **Graph tenant isolation is enforced in application code with no infrastructure or database-level fallback.** Community has neither multi-database nor RBAC, so unlike the other three stores there is no second line if the query builder is defeated. A standing risk for the life of the system, reviewed every release — not a decision awaiting an answer. | — |
| **RISK-004** | UAE PASS onboarding is long-lead procurement, independent of code readiness. Should start now. | Real citizen verification |
| **RISK-010** | Four stores × N tenants with no pipeline makes tenant onboarding a runbook rather than an operation — and a half-provisioned tenant is the one state where the isolation reasoning breaks down. | — |
| **RISK-011** | `git commit --no-verify` defeats the Prisma→SQLAlchemy drift check, which with no CI is the *only* enforcement of ADR-0005's schema-ownership rule. | — |
| **RISK-012** | Payment idempotency keys were specified as Redis content, but Redis is deliberately unbacked — a flush mid-payment could permit a double charge. **Closed:** the durable key now lives on the SQL transaction row (ADR-0003 amended). | Closed |
| **RISK-013**–**RISK-021** | Operational: half-provisioned tenants, partially applied N-tenant migrations, unverified backups between drills, embedding-dimension mismatch, self-hosted Neo4j, manual secret rotation across 25 secrets, image provenance, the WhatsApp 24-hour window under a BSP outage, and per-tenant connection-pool multiplication. | — |
| ~~**RISK-025**~~ | `001_constraints.sql`'s idempotency guards checked constraint names unscoped by schema — since a name is unique per schema, not per database, the **second** provisioned tenant silently skipped pre-existing constraints the first tenant already had. Found while implementing ADR-0011; that fix's own 5 new constraints were scoped correctly, which is what exposed 311 pre-existing unscoped guards. **Closed 2026-09-08 — resolved.** All 311 rewritten to scope by `parent_object_id`; proven by provisioning two probe tenants directly via `SqlStoreProvisioner` and confirming identical constraint sets (311/311 checks, 163/163 FKs). | Closed |

### Contradictions found in the wireframe itself

Writing the requirements surfaced six places where the source specification disagrees with itself. Four are resolved as `[ASSUMPTION]` and need confirmation; two are closed by requirement but recorded because a naive implementation would reproduce the defect.

| ID | Contradiction | Status |
|---|---|---|
| **RISK-005** | The 60% grounding threshold drives two different behaviours at the same value — B12 refuses and offers a human, B7 escalates automatically — with no precedence rule. | **Decided:** escalate when a handover node exists and agents are staffed; refuse otherwise. |
| **RISK-006** | Assurance levels are inconsistent — B11 lists four gated actions across three levels; Emirates ID scan gates nothing. | Assumed: four levels L0–L3. **Confirm.** |
| **RISK-008** | Containment and deflection rates are reported but never defined, and the seeded figures invert some common definitions. | Assumed: deflection is a subset of containment. **Confirm.** |
| **RISK-022** | Retention is configured twice over the same rows — B14 offers up to 7 years, B11 caps at 1. Stricter-of-two makes B14's 7-year option unreachable. | **Decided:** B11's `memoryRetentionDays` is retired. B14 tab 4 is the single retention authority; B11 tab 5 keeps only its scope control. |
| **RISK-023** | The tool catalogue is called "platform-wide" but registers one entity's mTLS credentials. Global would put SEWA's secrets in Customs' reach. | **Decided:** per-entity ownership; "platform-wide" reads as estate-wide within the entity. |
| **RISK-007** | "Arabic readiness" is two separate numbers (82% translated, 71% accuracy); both block publish, but B13 surfaces only one reason. | Closed by requirement — the gate must name *every* failing condition. |
| **RISK-009** | B2 shows General FAQ v3.0 `Published` while B14 shows Production on v2.4. Publish (registry state) and deploy (environment state) are conflated. | Closed by requirement — publishing must not bypass promotion approval. |

---

## Conventions

- **Requirement IDs** — `FR-<MODULE>-<nn>` / `NFR-<AREA>-<nn>`. Permanent; never reused or renumbered.
- **Screen references** — the wireframe's own identifiers: `A1`–`A3` for the assistant, `B1`–`B14` for the backoffice, with tab or step where relevant (`B6 tab 3`, `B3 step 4`).
- **`[ASSUMPTION]`** — marks a decision made where the source material was silent. Each one is a question worth asking the product owner, not a defect.
- **Sample data is illustrative.** Names, figures and transcripts in the wireframe were chosen to make behaviour legible. They are not content requirements.
