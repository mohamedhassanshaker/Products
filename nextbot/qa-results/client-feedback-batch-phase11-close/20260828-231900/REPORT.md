# QA Report -- client-feedback-batch Phase 11 close-out (final review)

**Date:** 2026-08-28
**Scope:** Final, mechanical FieldHint tooltip rollout across the remaining admin
console screens (Phase 11 of `docs/plans/client-feedback-batch-plan.md`), verified
across all four batched implementation passes:
- Batch A -- Conversations / Escalations / Approvals / Channels
- Batch B -- Connectors / Tools / MCP Health
- Batch C -- remaining Agent Platform screens (Evals, Definitions, Model Gateway, Traces)
- Batch D -- Settings / Roles / Audit Log

This is a closing pass for the entire client-feedback-batch initiative (Phases 1-10
plus the user-authorized capability-group runtime-enforcement follow-up were already
independently QA-green per `docs/NEXUS_STATE.md`'s decision log). Only Phase 11
remained.

## Environment

- App stack: the project's own already-running `docker-compose.yml` stack (found via
  `docker ps` -- `nextbot-web-proxy`, `nextbot-web`, `nextbot-gateway`, `nextbot-worker`,
  `nextbot-postgres`, `nextbot-redis`, `nextbot-clickhouse`, all healthy, up ~2 hours
  with real seeded `demo`-tenant data). Used as-is, not restarted, and left running
  exactly as found.
- Base URL: `http://localhost:3000` (nginx proxy in front of `nextbot-web`).
- Credentials: seeded `admin@demo.nextbot.local` / `NextbotDemo!2026`, tenant slug
  `demo` (from `scripts/seed.ts`'s `DEMO_PASSWORD`/`SEED_USERS`).
- Browser automation: Playwright (Chromium) + `@axe-core/playwright`, installed ad hoc
  into this session's scratchpad, never added to the repo's own `package.json`.
  Deleted after verification.

## 1. Full repo-wide regression (fresh, whole workspace -- not just Phase 11's files)

| Check | Result |
|---|---|
| `pnpm turbo run typecheck` | Clean. 31/31 workspace packages green. |
| `pnpm run lint` | Clean. `eslint . --max-warnings=0`, 0 warnings/errors. |
| `pnpm run lint:boundaries` | Clean. 0 dependency-cruiser violations (1890 modules, 4697 dependencies cruised). |
| `pnpm vitest run --project unit` (full workspace) | Clean. 206 test files / 1258 tests, all passing, no regressions. |

No regressions anywhere in the workspace across Phases 1-10, the capability-group
runtime-enforcement follow-up, or Phase 11's ~150 FieldHint additions across the ~17
files the four batches touched.

(Integration/isolation suites were not re-run this pass -- not requested by this
dispatch's scope, and Phase 11 is a client-side-only, additive UI change with no
schema/repository/service-layer touches; the last integration-suite baseline remains
the one recorded against Phase 17's own QA-relevant dispatch.)

## 2. Live browser pass -- one representative screen per batch

Sampled: Conversations filters (Batch A), the Connector Wizard (Batch B), Evals
(Batch C, including its "+ New Eval Suite" dialog -- a second Base UI primitive,
Dialog, exercised alongside Tooltip), and PII & Guardrails (Batch D).

**FieldHint rendering (hover):** every sampled hint (5 per screen, 20 total) rendered
its claimed one-sentence, field-behavior-accurate copy on hover, e.g.:
- Conversations "Status" filter: "Restricts the list to conversations currently in
  this lifecycle state (e.g. Escalated hides everything the AI already resolved or
  that was handed to a human) -- combines with the other filters below."
- Connector Wizard "Transport": "How the platform's MCP client opens the connection to
  this server -- Stdio via Gateway Agent isn't available..."
- PII & Guardrails "Entity type": "Which category of PII this detection rule matches
  -- choose Custom to define your own regex pattern by hand..."
- Evals "Pass threshold" (inside the New Eval Suite dialog): "The minimum percentage
  of cases that must pass for a run of this suite to be marked Passed -- this is..."

All 20/20 sampled hints found (correct, stable, caller-supplied `id`s -- e.g.
`conversations-filter-status-hint`, matching the required convention fixed in the
earlier tooltip-hydration retry pass) and rendered a visible tooltip popup with
non-empty, on-topic content. Screenshots (end-state, one per screen) in this same
results directory: `Conversations-filters-BatchA.png`, `Connector-Wizard-BatchB.png`,
`Evals-BatchC.png`, `PII-Guardrails-BatchD.png`.

**Hydration-mismatch console check** (the documented recurring bug class across
`FieldHint`/`Tooltip`, `SidebarSection`/`Collapsible`, and generically audited across
6 Base-UI-wrapping primitives earlier in this batch): ran each of the 4 sampled
screens through 10 fresh, hard-navigation loads (brand-new browser context per load,
reused login session storage state, real HTTP GET, not a client SPA transition) --
0/10 hydration-mismatch console warnings on all four screens (Conversations,
Connector Wizard, Evals, PII & Guardrails). Also 0 other console errors/warnings and
0 pageerror events across all loads and both the plain-load and dialog-open (Evals)
states.

**Live axe-core scan (wcag2a/wcag2aa):** 0 violations on all four sampled screens,
both in their default state and with the Evals "New Eval Suite" dialog open.

## 3. Spot-check of deliberately-skipped fields

- `apps/web/app/(admin)/tools/[id]/permissions/ToolPermissionRules.tsx` -- read in
  full. Confirmed: every field in this screen (Ordinal, Effect, Required tier,
  Enabled) is a per-row table-column control identified via `TableHead` column
  headers and a direct `aria-label` on the control itself (e.g. `Effect for rule
  ${i + 1}`) -- there is no `<Label htmlFor>` anywhere in this file for any field a
  FieldHint could sit beside. The skip is genuine, not silently missed work.
- `apps/web/app/(admin)/roles/RoleCheckboxList.tsx` -- read in full. Confirmed: each
  `Checkbox` is wrapped in an unlabeled-`htmlFor` `<Label>` (native implicit
  label-wrapping -- no separate `id`/`htmlFor` pair to attach a hint beside), and the
  accessible name is the role's own display name (e.g. "Read-Only (System)"), which
  is already self-explanatory -- there is no separate explanatory copy this field
  would need beyond the role name itself. The skip is genuine, not silently missed
  work.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Phase 11 mechanical FieldHint rollout (Batch A: Conversations/Escalations/Approvals/Channels) | FieldHint renders correct copy on hover; live in real browser | PASS | Conversations-filters-BatchA.png; hover-copy log above |
| Phase 11 rollout (Batch B: Connectors/Tools/MCP Health) | Connector Wizard FieldHints render; ToolPermissionRules skip spot-checked | PASS | Connector-Wizard-BatchB.png; source read of ToolPermissionRules.tsx |
| Phase 11 rollout (Batch C: remaining Agent Platform screens) | Evals list + New Eval Suite dialog FieldHints render | PASS | Evals-BatchC.png |
| Phase 11 rollout (Batch D: Settings/Roles/Audit Log) | PII & Guardrails FieldHints render; RoleCheckboxList skip spot-checked | PASS | PII-Guardrails-BatchD.png; source read of RoleCheckboxList.tsx |
| No hydration-mismatch regression (cross-batch seam risk) | 10x fresh hard-navigation loads per sampled screen | PASS (0/10 all four) | hydration repro run log above |
| Accessibility (cross-batch) | Live axe-core wcag2a/wcag2aa scan per sampled screen, incl. dialog-open state | PASS (0 violations all four) | axe run log above |
| Full-repo regression (Phases 1-10 + capability-group enforcement untouched) | typecheck/lint/lint:boundaries/full unit suite | PASS | logs above (31/31, 0 warnings, 0 boundary violations, 1258/1258 tests) |
| Deliberate skips are genuine, not missed work | Source read of both flagged files | PASS | quotes above |

No requirement in scope was left untested.

## Defects

None found.

## Verdict

PASS -- final close-out for client-feedback-batch Phase 11, and for the entire
11-phase `docs/plans/client-feedback-batch-plan.md` initiative (Phases 1-10, Phase 11,
and the user-authorized capability-group runtime-enforcement follow-up) are all
QA-green. No blocking defects. Nothing outstanding in this initiative's scope.
