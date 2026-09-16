---
name: saas-develop
description: Use when the user wants to build or extend a feature end-to-end from the specs in docs/ using SHJ3's actual stack — Next.js/React (apps/web) and Python (apps/ai) — following the domain/application/ports/adapters layering already in use, with a gate check (pnpm verify) before each phase advances. Triggers on "implement the spec," "build this feature per the docs," "next phase," "phase gate," or requests to autonomously carry a documented feature from spec to tested, working code.
---

# SHJ3 spec-driven builder

Turns a written spec in `docs/` into working, tested, security-audited, documented code
against SHJ3's real stack — Next.js 15/React 19/TypeScript in `apps/web`, Python in
`apps/ai` — through small phases that each end at a hard gate: `pnpm verify --staged`.
Never skip the gate to "keep momentum"; a red gate — including a security finding —
blocks the next phase, full stop.

This is a project-scoped override of the global `saas-develop` skill (which assumes
NestJS + Angular). It exists because that assumption is wrong for this repo — SHJ3 has
no NestJS modules, no Angular feature modules, and no `PRODUCT_SPECIFICATION.md`/
`PHASED_DELIVERY_PLAN.md`. Use this version whenever working inside SHJ3.

## 0. Before writing any code

1. Read every file in `docs/` relevant to the requested feature: `docs/requirements.md`
   (plus `docs/requirements/*.md` for the agents/iam/platform/conversation subsystems),
   `docs/architecture.md`, the relevant `docs/adr/NNNN-*.md` entries, `docs/data-model.md`,
   `docs/api.md`, `docs/design-system.md`. For anything in `tasks/lessons.md` or
   `tasks/todo.md` (both very large — 293KB / 681KB), use the `shj3-docs-lookup`
   subagent to pull the relevant excerpt rather than reading either file wholesale.
2. Read the current codebase structure relevant to the feature — existing modules under
   `apps/web/src/modules/*` or `apps/ai/src/shj3_ai/*`, existing Prisma schema
   (`prisma/platform/`, `prisma/tenant/` — ADR-0011), existing Neo4j graph builder
   (`apps/ai/src/shj3_ai/adapters/outbound/graph/` — the *only* place Cypher may exist,
   ADR-0009). A spec describes intent, the codebase is ground truth; reconcile explicitly
   and call out contradictions to the user rather than silently picking one.
3. Check `tasks/todo.md` for an existing phased plan for this feature. If one exists and
   is still accurate, resume it — don't re-plan from scratch.
4. If the user hasn't named a specific feature, run a gap analysis first: walk each major
   requirement area and classify it Done / Partial / Missing against the actual codebase
   (domain + application + adapter + UI must all be present to count as Done). Present a
   short status table plus a ranked shortlist before producing a phased plan. Don't
   silently choose a feature on the user's behalf.

## 1. Produce the phased plan

Write (or update) a plan doc in `tasks/todo.md` (this repo's existing convention — not a
new `docs/plans/*.md` file) before any implementation. Each phase must be small enough to
implement, test, and gate in one sitting. For each phase, record:

- **Goal** — one sentence, observable outcome.
- **Scope** — files/modules touched, explicitly listing what's *out* of scope.
- **Deliverables** — concrete artifacts (a module's domain/application/adapter files, a
  migration, a doc update).
- **Exit gate** — `pnpm verify --staged` green, plus any feature-specific acceptance
  criteria from the plan.

Order phases so each one leaves the system working — no phase should require a later
phase to compile or pass tests. Present the phase list once before starting phase 1, then
proceed autonomously except where §5 requires a pause.

## 2. Architecture rules

Layer every module the same way, under `apps/web/src/modules/<feature>/` and
`apps/ai/src/shj3_ai/<feature>/` respectively (architecture.md §4) — resist collapsing
layers for a "simple" feature; consistency is what keeps the codebase navigable:

- `domain/` — entities/value objects and pure domain logic. No Next.js/framework
  imports, no Prisma/SQLAlchemy imports, no HTTP concepts.
- `application/` — use-cases orchestrating domain logic, depending on `ports/`
  interfaces for anything crossing a boundary (repository, external API, clock, id
  generator). Depend on ports, never on a concrete adapter.
- `ports/` — the interfaces `application/` depends on.
- `adapters/` (`inbound/`, `outbound/`) — concrete implementations: Prisma repositories,
  the Neo4j graph builder, HTTP clients, the AI-service client. Nothing outside this
  layer imports an ORM type or issues raw Cypher (ADR-0009 rule 2, enforced by
  `gate:cypher`).
- `testing/` — fakes for the module's ports, used by both this module's and consuming
  modules' unit tests.

Module boundaries are enforced by `eslint-plugin-boundaries` (TS side) and
`import-linter` (`apps/ai` side, `py:arch` in `pnpm verify`) — a module reaching into
another module's `adapters/` instead of its exported `application/` service is a
boundary violation the gate catches, not just a review nit.

### Frontend (`apps/web`)

- Server Components by default; Client Components only where interactivity requires it.
- No hardcoded colors, spacing, radii, or fonts in feature code — consume the tokens in
  `packages/tokens` (ADR-0007). `gate:tokens`/`gate:token-refs`/`gate:tailwind-theme`
  enforce this; a literal that's genuinely unavoidable needs a same-line
  `design-gate-allow: <reason>` comment, not a silent bypass.
- No hardcoded user-facing strings — i18n via the existing `apps/web/messages/{en,ar}.json`
  convention (`gate:i18n-strings`).
- No hand-assembled `<table>` — use the shared DataTable pattern (`gate:table`).
- Every page needs a `docs`-driven user-guide entry under
  `apps/web/src/modules/userguide/content/` (`gate:user-guide`, Phase F's maintenance
  rule) in the same change that adds or changes the page.

### Backend data access

- Tenant-scoped stores only — no store client may be constructed unscoped
  (`gate:clients`, ADR-0002 rule 3). Prisma owns the schema; SQLAlchemy reads
  (ADR-0005) — a schema change updates both sides or `gate:drift` fails
  (`pnpm db:models` regenerates the Python models from the Prisma schema).
- Raw Cypher only inside `apps/ai/src/shj3_ai/adapters/outbound/graph/` — everything
  else goes through the tenant-aware query builder (ADR-0009, RISK-024: Neo4j Community
  has no RBAC and no database boundary, so this is the only isolation control).

### Both sides

- SOLID, especially dependency inversion at layer boundaries — `application/` is
  testable with an in-memory fake from `testing/`, not a real DB or HTTP call.
- No god services/classes; split a constructor needing more than ~4-5 collaborators.
- Comments only where the code can't explain itself — match this repo's existing
  comment convention (see any file under `scripts/gates/` for the house style: a doc
  comment on *why* a rule/module exists, not *what* the code does).

## 3. Testing — required per phase

- **Unit tests** (`pnpm test:unit`, vitest project `unit`): every `application/`
  use-case tested against fakes from `testing/`, no real DB/HTTP. Co-located as
  `*.test.ts` next to the file under test (this repo's convention, not `*.spec.ts`).
- **Integration tests** (`pnpm test:integration`): adapters against real stores in
  containers — a release-gate concern, not run on every `pnpm verify --staged`.
- **Isolation tests** (`pnpm test:isolation`): ADR-0002's release gate — proves tenant A
  cannot reach tenant B across all four stores, including forged-tenant payloads. Any
  phase touching data access needs isolation coverage for its new query paths.
- **E2E** (`pnpm test:e2e`, Playwright): golden path per feature phase against the real
  running stack.
- **Python side** (`apps/ai`): `pytest`, `ruff`, `mypy --strict`, `import-linter` —
  mirrored stages in `pnpm verify`, same rigor as the TypeScript side (ADR-0001: two
  deployables, one gate).

Write tests as you implement each phase, not as a separate later phase.

## 4. Security audit — part of every gate

Any phase adding/changing an HTTP endpoint, auth/authz, data access, file/object
storage, external API calls, or user input handling runs a security review before §5's
gate can pass. Use the `security-review` skill if available; otherwise self-review
scoped to what the phase touched, with SHJ3's own named risks always in view:

- **RISK-002** — `--no-verify` bypasses every gate; with no CI (ADR-0008), a phase must
  never be declared done on the strength of a skipped or bypassed gate.
- **RISK-011** — Prisma and SQLAlchemy reading the same schema from two ORMs; any schema
  change must keep both sides in sync (`gate:drift`, `pnpm db:models`).
- **RISK-024** — Neo4j Community has no RBAC and no database-level tenant boundary; the
  query builder is the only isolation control (ADR-0009).
- Standard checklist otherwise: explicit auth guard on every new endpoint scoped to the
  acting user against the *specific resource* (not just "is logged in"); input
  validation at the boundary; no raw string-concatenated SQL/Cypher; secrets via env
  only (`gate:secrets`); no accidental data exposure in API responses; rate limiting on
  expensive or auth-related endpoints.

Findings get fixed in the same phase, same as a failing test. A pre-existing issue
outside this phase's scope gets surfaced to the user, not silently fixed.

## 5. The gate — check before declaring a phase complete

Run, and require green, before moving to the next phase or reporting a phase done:

1. `pnpm verify --staged` — format, lint, typecheck, all static gates, unit tests, both
   runtimes. This is ADR-0008's single definition of "passing"; there is no CI, so this
   command *is* the gate. (`.claude/settings.json`'s Stop hook already runs the touched-file
   equivalent of this after every turn — but still run the real command yourself before
   declaring a phase done, since the hook is a per-turn safety net, not a substitute for
   deliberately verifying the phase's full scope.)
2. Full `pnpm verify` (adds integration/isolation/e2e) before declaring the *feature*
   (not just a phase) done, or before anything touching tenant isolation.
3. Security audit from §4, scoped to what this phase touched.
4. The phase's feature-specific acceptance criteria from the plan (§1) — verify each
   explicitly.
5. Update `tasks/todo.md`: mark the phase done, note any scope deviation and the
   security review outcome.

If a gate fails: fix it within the current phase. Do not carry a red gate forward.

## 6. Autonomy — where to proceed vs. where to stop

Proceed without asking, phase to phase, as long as gates stay green and the plan from §1
covers what you're doing. Stop and ask (AskUserQuestion) when:

- The spec is silent or ambiguous on a decision that changes behavior.
- A phase would require a destructive or hard-to-reverse action (schema migration
  dropping/altering existing columns, deleting existing data, a breaking API change).
- A gate fails in a way that implies the plan itself was wrong.

## 7. Documentation output

- `tasks/todo.md` — the phased plan from §1, updated per §5.5.
- `docs/adr/NNNN-title.md` — only for a real architectural trade-off this feature
  introduces; not for routine CRUD.
- Update `docs/requirements.md`, `docs/architecture.md`, `docs/data-model.md`,
  `docs/api.md`, or `docs/design-system.md` if implementation revealed the doc was wrong
  or incomplete — these stay true descriptions of the system, not historical artifacts.
- A new or changed page also gets its `apps/web/src/modules/userguide/content/` entry in
  the same change (Phase F's maintenance rule, `gate:user-guide`).
