# CLAUDE.md

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions) , for planning use opus model,for execution use sonnet
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution
- For anything sourced from `docs/requirements.md`, `docs/design-system.md`,
  `tasks/lessons.md`, or `tasks/todo.md` (177KB–681KB — too large to read wholesale),
  use the `shj3-docs-lookup` subagent (`.claude/agents/shj3-docs-lookup.md`) with a
  specific question instead of reading the file directly

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
- Mechanically enforced, not just advisory: `.claude/settings.json`'s Stop hook runs
  format/lint/the static gates against whatever files you touched this session and
  blocks the turn on a real violation (scoped to touched files — pre-existing repo
  issues elsewhere don't block you). Still run `pnpm verify --staged` yourself before
  declaring a whole feature/phase done — the hook is a per-turn safety net, not a
  substitute for verifying the full scope of what you built

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

---

## New Project Intake (blocking — no code before this is done)

> **SHJ3 already completed this intake.** Modular monolith across two runtimes
> (`docs/adr/0001`), schema-per-tenant isolation (`docs/adr/0002`), Next.js/React +
> Python stack, and the design system/theming approach in `docs/adr/0007` are decided
> and recorded — see `docs/adr/` for the full set (0001–0011) and `docs/design-system.md`.
> Don't re-ask Steps 1–5 below for this repo; they apply when starting a genuinely new
> project from this template. For building a feature *within* SHJ3, use the
> project-scoped `saas-develop` skill (`.claude/skills/saas-develop/SKILL.md`) instead —
> it reflects the stack actually in use here, not the generic NestJS/Angular default.

### Step 0: Requirement Review & Documentation
- Read and review ALL input requirements before proposing anything
- Restate requirements back in your own words; list ambiguities and open questions
- Create and maintain a `docs/` folder from day one:
  - `docs/requirements.md` — validated requirements, in/out of scope
  - `docs/architecture.md` — chosen architecture, component map, data flow
  - `docs/adr/NNNN-title.md` — one ADR per decision (context, options, decision, consequences)
  - `docs/data-model.md` — entities, relationships, tenancy keys
  - `docs/api.md` — endpoints/contracts
  - `docs/deployment.md` — environments, pipelines, runbook
  - `docs/testing.md` — test strategy and requirement→test traceability matrix
- `docs/` is a living deliverable. Update it in the same commit as the change it describes

### Step 1: Architecture Decision (ASK — do not assume)
Ask the user to select one, and record it as an ADR:
- **Monolith** — single deployable, fastest to ship, simplest ops
- **Modular Monolith** — enforced module boundaries in one deployable (default recommendation unless scale demands otherwise)
- **Microservices** — independently deployable services, only when team size / scaling / isolation justify the ops cost

State the trade-offs before the user chooses. Once chosen, enforce the boundaries in code review.

### Step 2: Tenancy Model (ASK)
- **Single tenant** — one deployment/DB per customer
- **Multi-tenant** — shared deployment; then also ask: shared DB w/ tenant column, schema-per-tenant, or DB-per-tenant
- Multi-tenant is a cross-cutting concern: tenant isolation must be enforced at the data-access layer, never left to individual queries. Add a test that proves cross-tenant leakage is impossible.

### Step 3: Backend Stack (ASK)
Options: `Next.js` | `NestJS` | `.NET` | `Python (FastAPI/Django)` | `Java (Spring Boot)`
- Confirm runtime version, package manager, ORM/data-access, and auth approach at the same time

### Step 4: Frontend Stack (ASK)
Options: `Next.js` | `React` | `Angular`
- Confirm rendering strategy (SSR/CSR/SSG), routing, and state management at the same time

### Step 5: UI Library & Design System (ASK)
Options: `Chakra UI` | `shadcn/ui` | `Tailwind CSS` | `Material UI` | `Ant Design` | `PrimeNG (Angular)`
- The frontend MUST be built on a solid, explicit design system — not ad-hoc styling:
  - Design tokens first: color, spacing, typography, radius, shadow, z-index, breakpoints
  - Themeable: light/dark and brand override supported from day one
  - A documented component library (atoms → molecules → organisms) with variants and states
  - No hardcoded colors, spacing, or font sizes anywhere in feature code — tokens only
  - RTL/i18n and accessibility (WCAG 2.1 AA) considered in the base components, not retrofitted
- **The generated system must be themable and skinnable by design** — tokens are resolved at runtime (CSS variables / theme provider), never compiled in. Ask at this step: how many themes ship by default, who is allowed to change them (admin only / per tenant / per user), and whether white-labelling per tenant is required.
- Document the system in `docs/design-system.md`

**Gate:** Steps 0–5 must be answered and written to `docs/` before the first line of implementation code.

---

## Code Quality Rules (strict, non-negotiable)

- **Clean code**: meaningful names, small functions, single responsibility, no dead code, no commented-out code left behind
- **Commented code**: every module, public function/class, and non-obvious block carries a comment explaining *why*, not *what*. Public APIs get full doc comments (JSDoc/XML docs/docstrings/Javadoc)
- **Agnostic design**: business logic must not depend on framework, database, cloud provider, or UI library
  - Depend on interfaces/ports; put frameworks and vendors behind adapters
  - No SDK calls, ORM entities, or HTTP objects leaking into the domain layer
  - Swapping the database, cloud, or UI library must not require touching domain code
- **Consistency**: linter + formatter + pre-commit hooks configured in the first commit; CI fails on lint, type, or test errors
  - SHJ3: no CI exists (ADR-0008) — `pnpm verify` is the single definition of "passing." `pnpm hooks:install` wires the git pre-commit hook; `.claude/settings.json`'s Stop hook additionally checks touched files after every Claude Code turn
- **No laziness**: root causes only. No temporary fixes, no silent catches, no `any`, no magic numbers
- **Secrets**: never in code or docs — config/env only
  - SHJ3: mechanically enforced by `gate:secrets` (`scripts/gates/no-secrets.mjs`), run at pre-commit, in `pnpm verify`, and as a blocking `.claude/settings.json` PreToolUse hook on every Edit/Write

---

## Delivery Phases

Every project runs through these phases in order. Each phase is a checklist in `tasks/todo.md` and is not "done" until proven.

### Phase A — Intake & Design
Complete New Project Intake (Steps 0–5) and populate `docs/`.

### Phase B — Implementation
Build against the documented requirements, following the Code Quality Rules.

### Phase C — Deployment (ASK, multi-select)
Ask the user which targets to support, then implement all selected:
- `Docker` (Dockerfile, multi-stage, non-root)
- `Docker Compose` (local + staging parity)
- `Kubernetes` (manifests or Helm chart, probes, resource limits, secrets/config maps)
- `Serverless` (Lambda/Azure Functions/Cloud Run)
- `Bare VM / IIS / systemd`
- `CI/CD` (GitHub Actions / Azure DevOps / GitLab CI)

Deliverables: reproducible build, environment config strategy, migration strategy, rollback plan, and a runbook in `docs/deployment.md`.

### Phase D — Strict End-to-End Testing Against Requirements
- Build a traceability matrix: every requirement in `docs/requirements.md` maps to at least one automated test
- Test layers: unit → integration → **E2E against the real running stack** (Playwright/Cypress for web, contract tests for services)
- Cover happy path, validation errors, permissions/roles, and — for multi-tenant — tenant isolation
- Seed deterministic test data; tests must run in CI with no manual steps
- **A requirement with no passing test is an incomplete requirement.** Report coverage per requirement, not just per line
- Do not declare the project done while any requirement row is unverified

### Phase E — Theming & Skinning Module (in-product, mandatory)
Ship theming as a real module inside the application, not a build-time config file:
- Reachable from **Settings → Appearance** (and, where roles allow, an admin/tenant branding screen)
- Everything themable is driven by runtime design tokens (CSS custom properties or a theme provider). Changing a token repaints the whole app — no per-component overrides, no rebuild, no redeploy
- The module must let an authorised user control at minimum:
  - **Brand**: primary/secondary/accent colors, semantic colors (success, warning, danger, info), logo (light + dark variants), favicon, app title
  - **Typography**: font family, base size, scale, weight
  - **Layout**: corner radius, spacing density (compact / comfortable), shadow depth, sidebar style
  - **Mode**: light / dark / system
  - **Direction**: LTR / RTL, tied to language selection
- **Skins**: named, saveable theme presets. Ship at least a default and a dark skin; users can duplicate, edit, export (JSON), and import a skin
- **Live preview**: changes render immediately with an explicit Save / Reset to default; never leave the app in a half-applied state
- **Persistence & scope**: resolve in the order *user preference → tenant/organisation theme → system default*. For multi-tenant systems, tenant branding is stored per tenant and applied on load — a tenant must never see another tenant's branding
- **Validation**: reject color combinations that break WCAG 2.1 AA contrast; warn before saving, and keep a one-click restore to default
- Enforcement: any component that hardcodes a color, radius, spacing, or font instead of consuming a token fails review — that is the rule that keeps the system skinnable
  - SHJ3: mechanically enforced by `gate:tokens`/`gate:token-refs`/`gate:tailwind-theme` (`pnpm verify`, and the touched-file equivalent in `.claude/settings.json`'s Stop hook)
- Document tokens, presets, and the JSON skin schema in `docs/design-system.md`

### Phase F — User Guide Module (in-product, mandatory)
Build the user guide as a real module inside the application, not an external PDF:
- Reachable from a persistent **Help icon** in the app header
- Opens a Help/User Guide module containing:
  - **Side menu** listing every application module → submodule → page, mirroring the real app navigation
  - **One entry per page in the system**, each containing:
    - Screenshot of the page (kept current with the UI)
    - Purpose of the page in plain language
    - Walkthrough of every feature, button, filter, and field on it
    - Step-by-step "how to" for the main tasks, written for a non-technical user
    - Notes on permissions/roles that change what the user sees
- Requirements for the module itself: searchable, deep-linkable, i18n-ready (EN/AR where applicable), and versioned with the app
- **Maintenance rule:** any PR that adds or changes a page must add or update its user-guide entry and screenshot in the same PR. A page with no guide entry fails review.
  - SHJ3: the "has an entry" half is mechanically enforced by `gate:user-guide` (`pnpm verify`, and the touched-file equivalent in `.claude/settings.json`'s Stop hook) — screenshot currency still needs a human/reviewer check

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections
7. **Sync Docs**: Update `docs/` and the user-guide entry alongside the code change

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Only touch what's necessary. No side effects with new bugs.
- **Ask, Don't Assume**: Architecture, tenancy, stack, UI library, and deployment targets are the user's decisions — surface the trade-offs and wait for an answer.
- **Documented by Default**: Undocumented work is unfinished work.
