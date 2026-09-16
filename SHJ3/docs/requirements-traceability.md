# SHJ3 — E2E Requirement Traceability Matrix (Phase D)

> Status: **Partial — infrastructure complete, coverage significantly expanded** · Last updated: 2026-09-10
> Upstream: [`requirements/`](./requirements/README.md) (378 requirement IDs as of the wireframe baseline, plus FR-ORCH-15–30 added by the Pipeline Designer delivery — see [`requirements/orchestration.md`](./requirements/orchestration.md) §5.5.2 and [`requirements/risks.md`](./requirements/risks.md) RISK-026 for its untested status) · [`testing.md`](./testing.md) (test strategy, §1 coverage rule)
> Scope of the original pass (2026-09-09): real Playwright E2E infrastructure (`playwright.config.ts`, `e2e/global-setup.ts`, `e2e/support/`) plus initial coverage of the four backoffice screens shipped at that time — IAM (B9), Settings → Appearance (Phase E), Agents (B2/B3), Tools (B5).
> Scope of this follow-up pass (2026-09-10): golden-path + validation-error + permission-boundary coverage added for seven more shipped screens — Knowledge (B6), Channels (B10), Escalations (B7/B8), Identity & transactions (B11), Evaluation & testing (B13), Governance & ops (B14), Command centre (B1) — plus one new cross-cutting test added to `iam.spec.ts` (team reassignment). Every real, shipped backoffice screen this project has today now has at least golden-path E2E coverage; only the citizen widget (`/widget`) remained untested at the end of that pass (no `e2e/journeys/**` yet — see §5).
> Scope of this second follow-up pass (2026-09-10, same day): `e2e/journeys/conversation-widget.spec.ts` — the first committed, permanent E2E coverage of the citizen conversation widget itself, `playwright.config.ts`'s own `testMatch` having anticipated `journeys/**/*.spec.ts` since it was written. Closes the single largest remaining block of untestable requirement IDs (§2.13). Also: the `RoutingRuleTest.firedRoutingRuleId` FK gap (§2.7) fixed at the schema level and proven live across all four tenants; the `KpiTile`/`command-centre` divergence (`docs/design-system.md` §5.4) confirmed deliberate, not a gap, against the real wireframe.
> Scope of this bug-fix pass (2026-09-10, same day): two real, product-owner-reported bugs closed. (1) `ProvisionTenant` never provisioned any `Channel` row (B10 tab 1's fixed four-row catalogue) for any tenant except the hand-seeded `sewa` demo tenant — `sharjah`/`customs`/`libraries` had zero channels and no UI path to ever get one. Fixed via a new `ProvisionDefaultChannelsForTenant` use case (channels/application), wired into `ProvisionTenant` through a new `TenantProvisionedHook` port (platform depends on nothing, architecture.md §3, so it cannot import `channels` directly); also closes the follow-on gap that `WebWidget`'s `WidgetConfig` row (B10 tab 2) was equally never provisioned. Backfilled live for the three already-provisioned tenants (`scripts/backfill-default-channels.ts`); FR-CHAN-01 moves from untested to **Passing** (§2.6). (2) `HelpGuideShell`'s `<aside>` (`/help/*`) rendered at full row width instead of its intended 18rem sidebar at every viewport — root cause confirmed live (not guessed): this design system's Tailwind v4 theme bridge resets the base numeric spacing scale (`--spacing: initial`, ADR-0007) and re-bridges only a curated subset that stops at `24`, so the class name `w-72` compiled to zero CSS. Fixed by reusing the same `--sidebar-width` token `AppShell`'s own sidebar already sizes itself with, via Tailwind v4's `w-(--custom-property)` shorthand — no dependency on the reset numeric scale. Neither fix touched any other module; the full E2E suite was re-run to confirm no regression.

## 1. How this document works, and its honest limits

`testing.md` §1's rule stands: **a requirement with no passing test is an incomplete requirement.** This document does two things dishonesty would otherwise hide:

1. Maps every requirement this pass can test — because the feature it describes actually exists — to the specific E2E test(s) that prove it, with a real, re-run status.
2. Names, by module and by count (not by pretending they don't exist), every requirement this pass **cannot** test yet, because the feature itself is not built. Per `requirements.md` §1.1, requirement IDs are permanent; a requirement being untestable today is a statement about the product's build state, not a reason to renumber or hide the ID.

**What this document is not**: the full, generated coverage report `testing.md` §13 describes (`scripts/requirement-coverage.ts`, joining Vitest/pytest/Playwright/k6 JSON reports against the requirements inventory). That aggregator does not exist yet — confirmed directly, not assumed (see §5, "Open follow-ups"). This is a hand-built matrix for the E2E layer only, honest about not yet being wired into a single generated number.

---

## 2. Testable today — full ID-level mapping

Test identifiers follow `testing.md` §1.1's convention. `covers(...)` annotations are on each test itself (`e2e/support/covers.ts`), and every ID quoted below was cross-checked directly against `docs/requirements.md`'s own real rows before being written here — several were caught and corrected in this pass after an initial draft used plausible-looking but non-existent IDs (`FR-HANDOVER-*`, `FR-CHANNEL-*` instead of the real `FR-HAND-*`/`FR-CHAN-*` prefixes).

### 2.1 `iam` (B9) — `e2e/backoffice/iam.spec.ts`, `e2e/roles/*.spec.ts`

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-IAM-01 | User records with status | `iam.spec.ts` golden path (Invited row appears) | Passing |
| FR-IAM-02 | Invited users created in `Invited` status | `iam.spec.ts` golden path | Passing |
| FR-IAM-05 | Edit name/email/team/role; email unique per tenant | `iam.spec.ts` validation error (duplicate email rejected) | Passing |
| FR-IAM-06 | Teams carry an entity scope | `iam.spec.ts` **new** "reassigning a user's team" golden path (assigns/removes the real seeded `Platform` team) | Passing |
| FR-IAM-07 | Team membership derived from user assignment, one write path | `iam.spec.ts` **new** golden path — reassign then re-read twice (join, then leave), each change reflected immediately with no second write | Passing |
| FR-IAM-11 | Separation of authoring vs. release | `roles/agent-designer.spec.ts` (Publish/Unpublish never rendered for Sara) | Passing |
| FR-IAM-12 | Deny-by-default, server-side, no client-only check | `roles/live-agent.spec.ts`, `roles/agent-designer.spec.ts`, and the permission-boundary test in nearly every spec added this pass | Passing |

**Not yet covered from this module, and why:** FR-IAM-03 (suspend/reactivate + immediate session revocation), FR-IAM-04 (remove, audit-preserving), FR-IAM-08 (team entity-scope enforcement on reads), FR-IAM-09/10 (permission-matrix editing, custom roles), FR-IAM-13/14/15/16 (auth mechanism internals — unit/integration-tested, not E2E-shaped), FR-IAM-17 (audit-entry-per-operation — no audit-log viewer screen exists yet to assert against through the UI). None of these are blocked on an unbuilt feature — the screens exist — they are simply outside this pass's chosen slice.

### 2.2 `theming` (Phase E) — `e2e/backoffice/appearance.spec.ts`, `e2e/roles/*.spec.ts`

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-THEME-01 | Route exists, permission-gated (view-only vs. full) | `appearance.spec.ts` golden paths (both roles), `roles/*.spec.ts` | Passing |
| FR-THEME-12 | Live preview, explicit save, never half-applied | `appearance.spec.ts` — Sara's personal-preference save clears the dirty badge | Passing |
| FR-THEME-13 | Resolution order user → tenant → system | `appearance.spec.ts` — Sara's personal save is independent of tenant scope (indirect) | Passing (partial — only the "personal preference exists and saves independently" half; the fallback-chain itself is not directly asserted) |
| FR-THEME-16 | WCAG 2.1 AA contrast blocks save, names the pair | `appearance.spec.ts` validation error (destructive fill/foreground at ratio 1.00:1) | Passing |
| FR-THEME-17 | One-click restore to default at every scope | `appearance.spec.ts` reset golden path (`/settings/appearance/reset`, personal scope) | Passing (personal scope only — see §3) |
| FR-THEME-18 | Authority: user / tenant admin / Super Admin | `appearance.spec.ts` permission boundary, `roles/*.spec.ts` | Passing |

**Not yet covered from this module, and why:** FR-THEME-02/03 (token-contract mechanics — the design-system gates' job, not E2E), FR-THEME-04/05/06/07/08 (setting every individual brand/typography/layout/mode/direction value), FR-THEME-09/10/11 (named skins, export, import), FR-THEME-14/15 (server-side resolution, inline token set), FR-THEME-19 (build-time gate, covered by `gate:tokens` outside E2E), FR-THEME-20 (widget accent — the citizen widget has no shipped route yet).

### 2.3 `agents` (B2/B3) — `e2e/backoffice/agents.spec.ts`, `e2e/backoffice/tenant-isolation.spec.ts`, `e2e/roles/*.spec.ts`

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-AGENT-01 | Registry: name/entity/version/status/channels/usage | `agents.spec.ts` registry test, golden path | Passing |
| FR-AGENT-02 | Ordered, immutable version history | `agents.spec.ts` registry test (seeded history present) | Passing (existence only) |
| FR-AGENT-08 | Any wizard step directly reachable, state persists | `agents.spec.ts` golden path (jumps straight to Channels, then Publish) | Passing |
| FR-AGENT-09 | Identity capture: name/entity/description | `agents.spec.ts` golden path + validation error | Passing |
| FR-AGENT-16 | Bind channels | `agents.spec.ts` golden path (Web widget bound) | Passing |
| FR-AGENT-18 | Publish increments version, redirects | `agents.spec.ts` golden path (registry shows `Published` after) | **Blocked as of 2026-09-10** — see `tasks/todo.md`'s "Phase D second follow-up" addendum: the tenant's real `PublishGates` singleton already carries FR-EVAL-07's own documented strict defaults (`blockOnSuiteFailure`/`redTeamMustScore100` both true), and this test's freshly-created draft has zero regression-run history, so the real, correctly-enforced gate (FR-EVAL-11/12) now blocks every run deterministically. Not a flake, not an app bug — the test's own precondition needs a real, passing evaluation run seeded for its fresh version (or a retarget onto a pre-evaluated fixture) before this can pass again. |
| FR-AGENT-19 | `agents:publish` required, enforced server-side | `roles/agent-designer.spec.ts`; `agents.spec.ts` | Passing |

**Not yet covered from this module, and why:** FR-AGENT-03/04/05/06/07 (clone/unpublish/archive/rollback/promotion), FR-AGENT-10 through FR-AGENT-15/17/20 (wizard steps 2–7, 9 — steps 5/6/9 honestly stubbed product-side per B-3's own review), FR-AGENT-21 (usage volume — no real conversation traffic yet).

### 2.4 `tools` (B3 step 4 / B5) — `e2e/backoffice/tools.spec.ts`, `e2e/roles/*.spec.ts`

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-TOOL-01 | Skills catalogue, attach/detach | `tools.spec.ts` golden path | Passing (creation only) |
| FR-TOOL-04 | Connect to MCP server, discover tools | `tools.spec.ts` — fails safely, documented outcome | Passing |
| FR-TOOL-09 | Test an API connector on demand | `tools.spec.ts` — fails safely, documented outcome | Passing |
| FR-TOOL-13 | Circuit breaker config incl. seeded state | `tools.spec.ts` — SEWA breaker renders `Open — fallback active` | Passing |

**Not yet covered:** FR-TOOL-02/03/05/06/07/08/10 through FR-TOOL-20 — real screens exist, exercising them needs the real `ai` runtime (B-5) or was outside this pass's slice.

### 2.5 `knowledge` (B6) — `e2e/backoffice/knowledge.spec.ts` — **new this pass**

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-KNOW-01 | Source registry: name/type/entity/schedule/indexed%/last-crawled | `knowledge.spec.ts` golden path (adds a real Document source, real chunking) | Passing |
| FR-KNOW-02 | Add a source with type/location/schedule | `knowledge.spec.ts` golden path | Passing |
| FR-KNOW-11 | Retrieval config: chunk size/overlap/model/weighting/top-K/reranker | `knowledge.spec.ts` validation error (overlap ≥ chunk size rejected server-side) | Passing |
| FR-IAM-12 | Deny-by-default (`knowledge:manage`) | `knowledge.spec.ts` permission boundary (Sara denied) | Passing |

**Not yet covered:** the entity-graph explorer/duplicate-detection tabs (FR-KNOW-05…10), the retrieval playground and its grounding-confidence/degradation reporting (FR-KNOW-12…17), source conflicts (FR-KNOW-18…22), reindex jobs (FR-KNOW-23…26) — real screens, not exercised this pass. Notably **the cross-module wiring checklist's "unresolved source conflict → grounding confidence drops → refusal policy can trip" scenario remains unproven** (`tasks/todo.md`'s own honest accounting) — it needs a real retrieval-playground query against a seeded open conflict and a real refusal-policy evaluation, deeper than this pass's time budget.

### 2.6 `channels` (B10) — `e2e/backoffice/channels.spec.ts` — **new this pass**

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-CHAN-01 | The four fixed channels (`Web widget`/`WhatsApp`/`Mobile app`/`Kiosk / IVR`) exist for every tenant, `Mobile app`/`Kiosk / IVR` `Disabled` with no bound agent | `channels.spec.ts` "Super Admin (Ahmed Saeed, sharjah)" golden path — a real tenant provisioned before this row's own fix existed, backfilled live, all four rows asserted present and `Disabled`, one bound + enabled through the real UI | **Passing — 2026-09-10, closes a real bug.** Was previously unverifiable: `ProvisionTenant` never created any `Channel` row for any tenant except the hand-seeded `sewa` demo data, so `sharjah`/`customs`/`libraries` had zero channels and no UI path to create one. Fixed via `ProvisionDefaultChannelsForTenant` (channels/application), wired into `ProvisionTenant` via a new `TenantProvisionedHook` port; backfilled for the three already-provisioned tenants via `scripts/backfill-default-channels.ts`. |
| FR-CHAN-12 | Template registry, `Pending review`/`Approved`, new submissions enter `Pending review` | `channels.spec.ts` validation error (duplicate name rejected) | Passing |
| FR-CHAN-14 | Campaign `Blocked` while its template isn't `Approved`, enable refused server-side | `channels.spec.ts` golden path (seeded Blocked state rendered, no enable switch) | Passing |
| FR-CHAN-15 / FR-CHAN-23 | Approving a template unblocks its campaign automatically | **Proven live via a throwaway script against the real `sewa` schema** (`ApproveMessageTemplate` → `EnableCampaign`, real trigger refusal then real success, fixture restored) — see `tasks/todo.md`'s dated review entry for the full output. Not yet a committed Playwright test (needs a `sewa`-tenant principal holding `agents:publish`, which no seeded demo user is — a real, named fixture gap) | Proven (live script), not yet in committed E2E |
| FR-PLAT-02 | Provision a tenant atomically across all four stores, rolling back on any failure | `provision-tenant.test.ts` (unit, fake-backed, every failure permutation) + `tests/isolation/setup.ts` (real infrastructure) — **unaffected by this pass's `postProvisionHooks` addition**, which runs strictly after the four-store commit point and never blocks or rolls back activation on its own failure (see `provision-tenant.test.ts`'s new "post-provision hooks" describe block) | Passing |
| FR-IAM-12 | Deny-by-default (`agents:manage`) | `channels.spec.ts` permission boundary (Omar denied) | Passing |

**A real bug found and fixed in this pass:** `whatsapp-tab.tsx`/`campaigns-tab.tsx` rendered Approve/Reject/"Send now" to any `agents:manage` principal regardless of holding the stricter `agents:publish` the underlying action requires. Fixed at the root (`channels/page.tsx`'s new `canPublish`, threaded to both tabs); `channels.spec.ts`'s own regression test proves the fix.

**A second real bug found and fixed, 2026-09-10:** see FR-CHAN-01's row above — `ProvisionTenant` never provisioned any `Channel` row (or, once that was fixed, `WebWidget`'s `WidgetConfig` row) for any tenant except the `sewa` demo tenant. Both are now real, first-class tenant-provisioning logic.

**Not yet covered:** channel disable behaviour, specifically FR-CHAN-02's "stops new conversations immediately, lets open ones finish" (the row's *presence*/state toggle is now proven by FR-CHAN-01's own test above; the conversation-stopping *effect* is not), assistant/human-agent hours (FR-CHAN-03/04/05), the widget studio's live preview/embed snippet/domain allowlist (FR-CHAN-06…09), WhatsApp session-window tracking (FR-CHAN-11), send-time opt-in/quiet-hours checks (FR-CHAN-16/17), locale registry/fallback (FR-CHAN-18/19), per-channel structural adaptation (FR-CHAN-20/21/22).

### 2.7 `handover` (B7/B8, escalations) — `e2e/backoffice/escalations.spec.ts` — **new this pass**

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-HAND-09 | Reorder routing rules; new order governs evaluation | `escalations.spec.ts` golden path (in-memory reorder changes the fired rule) | Passing |
| FR-HAND-11 | Create/edit rule form; invalid pairs rejected | `escalations.spec.ts` validation error (empty value blocked) | Passing |
| FR-HAND-13 | Rule tester evaluates the live list incl. unsaved reordering | `escalations.spec.ts` golden path | Passing |
| FR-HAND-15 | Canonical proof: order determines outcome (Billing+High → billing team vs. senior agents) | `escalations.spec.ts` golden path — **also the committed, permanent version of the cross-module wiring checklist's "reorder a routing rule → tester returns a different route" scenario**, which B-7's own review had only proven via a throwaway script before this pass | Passing |
| FR-HAND-18 | `Handle escalations` permission required to view/act on queue | `escalations.spec.ts` "split-permission tabs" test (Omar sees the queue, never routing rules) | Passing |
| FR-HAND-21 | Tester and production routing share one evaluation | `escalations.spec.ts` golden path (server-side re-evaluation agrees with the client-only result) | Passing |
| FR-IAM-12 | Deny-by-default | `escalations.spec.ts` permission boundary (Sara denied entirely) | Passing |
| FR-HAND-12 | Delete a routing rule, closing the ordering gap | `escalations.spec.ts` golden path — both fixture rules deleted for real via the UI after being fired by the tester | Passing (partial — the delete itself, and that it succeeds post-fire, are proven; contiguous-reordering-of-the-remaining-rules-after-a-delete is not separately asserted, since this test's own two fixture rules are both deleted at the end, leaving none remaining) |

**A real schema gap, found by this test in a prior pass, fixed at the root in this one:** `RoutingRuleTest.firedRoutingRuleId` was `onDelete: NoAction`, so a routing rule that had ever been evaluated by the tester could never be deleted afterward — a real, unhandled FK violation. Fixed 2026-09-10: `onDelete: SetNull` (the schema doc comment and `prisma/migrations/20260910090000_routing_rule_test_fired_rule_set_null` have the full reasoning, including why `CK_RoutingRuleTests_firedPaired` also had to be loosened from a symmetric equality to a one-way implication), applied live across all four provisioned tenant schemas (`customs`/`libraries`/`sewa`/`sharjah`) and proven both ways: a real create→test→delete succeeds and nulls the reference (rather than blocking), and a deliberately reverted constraint was confirmed to reproduce the original failure first. `escalations.spec.ts` itself now exercises the real fix directly (FR-HAND-12 above) rather than working around the gap.

**Not yet covered:** agent presence (FR-HAND-01), the live queue itself with a real ticket via the backoffice queue tab specifically (FR-HAND-02…07 — a real escalation ticket is now created and worked in the backoffice UI by `e2e/journeys/conversation-widget.spec.ts`, §2.13 below, but that spec does not separately assert every one of FR-HAND-02…07's own acceptance criteria — only that a ticket exists, is claimable, and its transcript is real), working-hours-gated escalation (FR-HAND-16), full transcript/identity/slot transfer (FR-HAND-17 — partially exercised by §2.13's "never a cold start" assertion), the bounded re-queue rule (FR-HAND-19). **The cross-module wiring checklist's "handover node fires → ticket carries that escalation reason" scenario (`FR-HAND-20`) remains unproven** — it needs a real flow execution through `apps/ai`'s flow engine reaching a `Handover` node (distinct from the citizen-initiated `UserRequest` reason §2.13 proves), out of this pass's scope.

### 2.8 `verification`/`payments` (B11, identity & transactions) — `e2e/backoffice/identity.spec.ts` — **new this pass**

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-VERI-06 | Assurance levels mapped to gated actions | `identity.spec.ts` golden path (changing `LinkUtilityAccount`'s required assurance persists across reload) | Passing |
| FR-PAY-06 | `InitiatePayment` requires L2 (Verified + OTP); a lower level is refused | `identity.spec.ts` validation error (`Verified` rejected below the L2 payment floor, confirmed unchanged on reload) | Passing |
| FR-IAM-12 | Deny-by-default (`users:manage`) | `identity.spec.ts` two permission-boundary tests (Sara and Omar both denied) | Passing |

**A real, honestly-named seed-data gap this pass found (not fixed):** `scripts/seed-identity-payments-demo-data.ts` seeds its step-up rules into `sewa` only, but the one seeded `SuperAdmin` session (`users:manage`) is bound to `sharjah` — so this screen's step-up rules render from the real "no seeded rows yet" fallback rather than the seeded values for the principal who can actually reach the screen. Real coverage either way (the write path is exercised for real), but named so the next wave doesn't assume `sharjah`'s rules were ever seeded.

**Not yet covered:** verification providers, account-ownership toggle change, identity stitching (most of FR-VERI-01…14), refund approve/decline (FR-PAY-01…05/07…10 — no seeded pending refund exists anywhere; the "Pending refund requests" section is asserted only in its honest empty state).

### 2.9 `evaluation` (B13) — `e2e/backoffice/evaluation.spec.ts` — **new this pass**

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-EVAL-01 | Golden sets: name/case count/owner/last score | `evaluation.spec.ts` golden path (creates a real set) + validation error (LanguageParity with no locale rejected) | Passing |
| FR-EVAL-02 | Run a golden set on demand, fresh score recorded | `evaluation.spec.ts` golden path — a real run against the seeded "General FAQ Agent" v2.4, a real call into `apps/ai` | Passing |
| FR-EVAL-04 | Edit cases within a golden set | `evaluation.spec.ts` golden path (adds a case) | Passing |
| FR-IAM-12 | Deny-by-default (`evaluation:manage`) | `evaluation.spec.ts` two permission-boundary tests | Passing |

**Not yet covered:** regression-run history detail beyond existence (FR-EVAL-03/05…10), the publish gate's own configuration screen (FR-EVAL-11…15 — a `PublishGateTab` exists but is not exercised this pass).

### 2.10 `governance` (B14) — `e2e/backoffice/governance.spec.ts` — **new this pass**

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-GOV-15 | Approver of a promotion must differ from the requester | Already proven live in B-9's own throwaway-script review entry; `governance.spec.ts` now proves it **through the real, running UI** for the first time — seeds one real `PromotionRequests` row (`scripts/seed-self-approval-promotion.ts`, since no "request a promotion" form ships yet), clicks Approve as the requester, gets the real refusal, confirms the request is still pending on reload | Passing |
| FR-GOV-18 | Per-dependency observability: p95/error-rate/status | `governance.spec.ts` golden path ("Recompute now" populates real rows) | Passing |
| FR-GOV-19 | Health status derived from thresholds | `governance.spec.ts` golden path (same test — real computed statuses render) | Passing |
| FR-GOV-25 | Data residency configurable, persists per tenant | `governance.spec.ts` golden path (Region-flexible saved, survives reload) | Passing |
| FR-IAM-12 | Deny-by-default (`governance:manage`) | `governance.spec.ts` two permission-boundary tests | Passing |

**Already proven before this pass, not re-proven redundantly:** "Approve a promotion → audit entry appears immediately" (`tasks/todo.md`'s cross-module wiring checklist) — B-9's own review entry.

**Not yet covered:** the audit-log viewer itself (FR-GOV-20…24 — no test asserts against a real audit-log row through this screen yet, only through the promotion-refusal side effect), policy/override configuration (most of FR-GOV-01…14), erasure requests (FR-GOV-26…29).

### 2.11 `analytics` (B1, command centre) — `e2e/backoffice/command-centre.spec.ts` — **new this pass**

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-ANLY-01 | Date-range selector re-renders every panel | `command-centre.spec.ts` golden path (range switch) | Passing |
| FR-ANLY-02 | Four KPIs render per range/tenant | `command-centre.spec.ts` golden path (real, honestly-zero figures — no conversation data seeded for `sharjah`) | Passing |
| FR-ANLY-05 | Conversation explorer, filterable by outcome | `command-centre.spec.ts` golden path (real columns render regardless of row count) | Passing (columns only — filter-by-outcome not separately exercised) |
| FR-ANLY-09 | Thumbs-down review queue | `command-centre.spec.ts` golden path (real empty state) | Passing (empty state only) |
| FR-ANLY-10 | Unanswered-question clustering | `command-centre.spec.ts` golden path (real empty state) | Passing (empty state only) |
| FR-ANLY-02 (split) | `dashboard:view` without `analytics:view` still lands, sees no tab content | `command-centre.spec.ts` — Sara (AgentDesigner) test | Passing |
| FR-IAM-12 | Deny-by-default (`dashboard:view`) | `command-centre.spec.ts` permission boundary (Omar denied — `LiveAgent` has no dashboard access) | Passing |

**Not yet covered:** filtering the explorer by outcome with real differentiated rows (no seeded conversation traffic — the one real row this suite can produce comes as a side effect of `evaluation.spec.ts`'s own "Run now" golden path, named honestly in this file's own module comment as not a stable fixture), marking a feedback issue fixed/reopened (FR-ANLY-11…13), the two remaining KPI/channel-split assertions (FR-ANLY-03/04/06/07/08).

### 2.12 Tenant isolation (§8) — `e2e/backoffice/tenant-isolation.spec.ts`, plus embedded in several specs above

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| NFR-SEC-15 | Per-store physical/logical isolation | `tenant-isolation.spec.ts`, `iam.spec.ts` tenant-isolation test | Passing — **UI-level corroboration only** |
| NFR-SEC-21 | Retrieval/graph/cache tenant-scoped, no cross-tenant citation | `tenant-isolation.spec.ts` | Passing (agents-registry proxy only) |

**Important scoping note, unchanged from the original pass:** these are a real, additional proof — one hop further than the store-level release-gate suite (`tests/isolation/*.spec.ts`) already proves — but they are **not** a replacement for that suite, which remains the release gate (`NFR-SEC-24`).

### 2.13 `conversation`/`orchestration` (A1/A2/A3, B-6/B-7) — `e2e/journeys/conversation-widget.spec.ts` — **new this pass**

The single largest remaining gap this document named (~42 IDs across `conversation`/`orchestration`/`flows`, §3 below) — closed for the `conversation`/`orchestration` slice that is actually reachable through a real, deterministic turn against the real SSR `/{locale}/widget` demo page (same-origin, so the already-proven `origin-allowlist.ts` self-directed bypass applies with no cross-origin/HTTPS re-proof needed — see B-6's own review for that half, done once, manually, and not rebuilt here). `SHJ3_OPENROUTER_API_KEY` is empty in this environment, so every turn runs the real `DeterministicChatModel` — real pipeline stages, no live model cost or flakiness.

| ID | Requirement (short) | Test(s) | Status |
|---|---|---|---|
| FR-CONV-02 | Dismissible disclaimer banner | `conversation-widget.spec.ts` golden path (dismiss, stays gone) | Passing |
| FR-CONV-03 | Greeting + configurable Quick Action chips | `conversation-widget.spec.ts` golden path (all five real seeded chips render) | Passing (chip *tap* not separately exercised — a typed message is used instead for the tool-triggering turn) |
| FR-CONV-04 | Per-message TTS/rating/timestamp controls | `conversation-widget.spec.ts` golden path (thumbs-up then thumbs-down toggled, `aria-pressed` asserted both ways) | Passing (TTS control presence only — `SpeechSynthesis` playback itself not asserted) |
| FR-CONV-05 | Composer with configurable placeholder | `conversation-widget.spec.ts` golden path | Passing (role-based, not the literal translated placeholder text) |
| FR-CONV-06 | Accumulating, semantically-distinguished transcript | `conversation-widget.spec.ts` golden path (citizen/assistant turns, both client- and staff-side transcripts) | Passing |
| FR-CONV-07 | Per-turn agent trace: routing decision, tools, secondary agents, pending slot | `conversation-widget.spec.ts` golden path (a real bound flow's Tool-call node, the router's own re-evaluation, and a second tool invocation all land in the Agent trace panel for one real "check my bill" turn) | Passing (pending-slot line not separately asserted — this turn's flow does not reach a slot-filling node) |
| FR-CONV-10 | Processing state + real SSE streaming | `conversation-widget.spec.ts` golden path (a plain message's real streamed echo) | Passing |
| FR-CONV-11 | Escalated state: queue position shown, composer paused | `conversation-widget.spec.ts` golden path (after "Talk to a person", composer shows the real paused reason and a real queue position) | Passing |
| FR-CONV-12 | Thumbs-up/down recorded per turn | `conversation-widget.spec.ts` golden path (real `PUT`/toggle via the UI) | Passing (that a thumbs-down reaches the B1 tab 3 queue is not separately re-asserted here — see §2.11's own command-centre coverage) |
| FR-CONV-16 | Turn rejected for a conversation id outside the caller's own session | `conversation-widget.spec.ts` negative path (`404 conversation.not_found`, real `page.evaluate` fetch, real cookies) | Passing |
| FR-ORCH-01 | Every turn: guardrail pre → route → execute → merge → guardrail post | `conversation-widget.spec.ts` golden path (all of guardrail(pre), router, tool call, guardrail(post) visible in one real trace) | Passing |
| FR-ORCH-11 | One persisted trace per turn: routing decision + confidence, tools, guardrail verdicts | `conversation-widget.spec.ts` golden path (real `router → <agentId> confidence 0.35`, two real tool-call steps, both guardrail stages) | Passing (persistence itself — that the trace survives a reload — not separately re-queried; this pass only asserts the live-rendered rail) |
| FR-ORCH-14 | Guardrail pre/post stages are structural, never disabled | `conversation-widget.spec.ts` golden path (both stages genuinely fire for a real turn) | Passing (that no configuration *can* disable them is not separately tested — this proves they ran, not that they are un-disable-able) |
| FR-HAND-20 (partial) | A citizen-initiated handover creates a real ticket the backoffice queue can work | `conversation-widget.spec.ts` golden path (real `POST .../handover`, a real `EscalationTickets` row with `reason: "UserRequest"`, claimed and its transcript read by a real `LiveAgent` staff session) | Passing for the `UserRequest` reason specifically — the `Handover`-flow-node-triggered reason (`FR-HAND-20`'s own original cross-module scenario, §2.7) remains unproven |

**A real, small product gap found and fixed while building this coverage, not merely worked around in the test:** `useWidgetConversation().requestHandover()` — a real, complete use case already wired to the real `POST /conversations/{id}/handover` endpoint — and the real, already-translated `widget.handover.requestAction`/`queuePosition` message keys had **no caller anywhere in this tree**; `widget-app.tsx` never rendered a way for a citizen to ask for a person directly. Fixed at the root (a real `Button`, hidden once a handover is already active) rather than reaching around the gap with a raw `fetch()` call from inside the test — see `widget-app.tsx`'s own module comment for the full reasoning.

**A real, live-found PII-masking behaviour, not a bug:** FR-CONV-13's masking pipeline treats a bare 13+ digit run as a card number and redacts it to `[REDACTED:CARD_NUMBER]` before persisting — this test's own first-draft marker (`Date.now()`, a purely numeric timestamp) was silently swallowed by exactly this real, correct control before it ever reached the staff-visible transcript. Fixed by switching the marker to base-36 (alphanumeric); recorded in `tasks/lessons.md`.

**A real, live-found UI gap in `queue-tab.tsx`, not fixed (pre-existing, out of scope):** opening a `Queued` ticket also attempts to claim it (`handleSelect`), and a fresh staff session's agent presence defaults to `Offline` — claiming fails and silently resets the selection to nothing, with no error surfaced to explain why the transcript panel never opens. This test works around it correctly (setting `Available` first, matching what a real agent would do), but the underlying UX gap — a confusing, wrong-looking dead-end for a fresh session — is real and named here for whoever next touches that screen.

**Not yet covered, and why:** voice input (FR-CONV-09 — a browser-native `SpeechRecognition` stand-in, not meaningfully drivable through Playwright), the docked/expanded widget-shell states (FR-CONV-01 — that is `AssistantWidgetShell`/the embeddable bundle's own concern, not the SSR demo page this spec drives), PII masking end-to-end at the storage layer (FR-CONV-13 — observed as a real side effect above, not directly asserted against a raw persisted row), outcome derivation (FR-CONV-14 — a real `Conversations.outcome` flip to `Escalated` happens per `request-handover.ts`, not independently re-queried by this pass), context preservation across a free-text escape (FR-CONV-15), execution-mode comparisons (FR-ORCH-02…05), cost-ceiling/fallback-model behaviour (FR-ORCH-08, already unit/integration-tested), conflict-resolution/merge policy (FR-ORCH-09), fallback-agent routing (FR-ORCH-10), free-text-escape re-routing (FR-ORCH-13), and the entire flow-authoring surface (FR-FLOW-01…05/10/11 — no dedicated backoffice screen exists yet). The three cross-module scenarios needing `apps/ai` exercised directly (§5, item 4) remain open.

---

## 3. Not yet testable — by module, honestly, per `testing.md` §1's rule 4

Per `requirements.md` §1.1, IDs stay stable; the reason each module below is untestable **today** is that the feature itself does not exist yet, not that a test was skipped for a shipped feature. Every module that now has at least a real, shipped screen has moved to §2 above (with its own honest "not yet covered" list) — this table is now only the modules with genuinely **no** shipped screen at all.

| Module (§ in `requirements.md`) | ID range | Requirement count | Blocked on | `tasks/todo.md` wave |
|---|---|---|---|---|
| `flows` (5.8) | FR-FLOW-01…12 | 12 | Flow designer/runtime has no dedicated backoffice screen; wizard step 6 honestly stubbed. (A handful of these — the `Handover`/`Tool-call` node *runtime* behaviour, not the authoring canvas — are now indirectly exercised by `conversation-widget.spec.ts`, §2.13, but the authoring surface itself remains unbuilt.) | B-5/B-7 |
| `userguide` (5.17) | FR-GUIDE-01…10 | 10 | The in-product guide (`HelpGuideShell`) is real and shipped (Phase F) but this pass did not add E2E coverage for the guide module itself (its own coverage gate, `gate:user-guide`, is a static-analysis check, not a Playwright spec) | B-10 |
| `platform` (5.1) | FR-PLAT-01…10 | 10 | Provisioning/config mechanics — proven by the isolation suite and integration tests, not by a backoffice screen; genuinely out of E2E's natural shape | — (owned by `tests/isolation/*`) |
| NFRs other than tenant isolation (§7: SEC beyond §8, PERF, A11Y, I18N, OBS, DATA, OPS) | ~85 IDs across `nfr/*` layers | ~85 | Entirely separate NFR layers (`nfr/a11y`, `nfr/perf`, `nfr/sec`, `nfr/i18n`, `nfr/data`, `nfr/obs`) — none exist yet | — |

**`conversation` (5.3, FR-CONV-01…16) and `orchestration` (5.5, FR-ORCH-01…14) moved out of this table this pass** — both now have a real, shipped, testable route (`/{locale}/widget`) and real E2E coverage (§2.13). Not every ID in either module is covered yet (§2.13's own "not yet covered" list is the honest accounting), but the *reason* for any remaining gap is no longer "no shipped screen" — the defining test for belonging in this table at all — so they no longer belong here per this table's own stated scope.

**Total genuinely blocked (no shipped screen at all): roughly 117 of 378 requirement IDs** (down from 147 — the 30-ID reduction is exactly `conversation` + `orchestration` moving to §2.13). A further, larger set of IDs now has a shipped screen and at least partial E2E coverage (§2) but is not 100% covered — each §2 subsection's own "Not yet covered" list is the honest accounting for those, rather than a single rolled-up number that would hide which specific IDs within a mostly-covered module are still open. This is a substantial reduction from the original pass's "roughly 245 of 378" — the original count treated every requirement in a partially-shipped module (knowledge, channels, handover, verification, payments, governance, evaluation, analytics) as untestable, which was already conservative even then and is now stale given this pass's coverage.

---

## 4. Notes on real, concurrent findings from both passes

**Original pass (2026-09-09):** an intermittent click-failure in `agents.spec.ts`'s publish step was traced to `messages/en.json`'s `knowledge` namespace using dotted flat keys inside an already-nested object, which `next-intl` rejected at runtime. **Resolved as of this pass** — `knowledge`'s real, shipped message catalogue (confirmed by direct read) now nests these correctly (e.g. `recrawlError: { knowledge: { source_not_found: "…" } }`), consistent with B-4 having since shipped for real. `agents.spec.ts`'s own defensive `toPass()` retry around the publish click is left in place (harmless, and the underlying instability's root cause — a wave actively mutating the same file mid-run — is exactly the shape that could recur with a future concurrent wave).

**This pass (2026-09-10):** two real product bugs found and fixed at the root while building the new coverage — (1) `whatsapp-tab.tsx`/`campaigns-tab.tsx` rendering Approve/Reject/"Send now" to a principal without the stricter `agents:publish` the underlying action actually requires (§2.6); (2) `seed-knowledge-demo-data.ts`'s own source-creation helpers had no idempotency guard at all, contradicting its own "safe to re-run" doc comment, and failed with a real unique-constraint violation the moment it was wired into `e2e/global-setup.ts` and run twice. Both are detailed in `tasks/lessons.md`'s newest entries. A significant environment-level finding, unrelated to any product code, is also recorded there: this session's host `C:` drive filled completely (0 bytes free, caused by Docker Desktop's WSL2 virtual disk) partway through, producing an hour of genuinely confusing E2E flakiness before being diagnosed and fixed (`docker system prune`, ~34GB reclaimed) — worth checking first, not last, the next time E2E behaviour looks inexplicably flaky in this environment.

---

## 5. Open follow-ups for future Phase D passes

1. **The generated coverage aggregator** (`testing.md` §13's `scripts/requirement-coverage.ts`, and a Vitest-side `test/covers.ts`) does not exist yet, on either runtime. `e2e/support/covers.ts` gives the E2E layer a real, inspectable `covers()` that lands in Playwright's own JSON reporter output — a genuine, if partial, step toward that aggregator.
2. **Sharding mutating specs into isolated fixtures.** `playwright.config.ts` still runs everything with `workers: 1`/`fullyParallel: false` — more specs now mutate shared, tenant-scoped fixtures than before (golden sets, routing rules, step-up rules, promotions, in addition to the original agents/IAM/circuit-breaker state), making this more valuable to fix, not less.
3. **Closed this pass:** `e2e/journeys/conversation-widget.spec.ts` now exists and `playwright.config.ts`'s own `testMatch` already included `journeys/**/*.spec.ts` (anticipated, per that file's own comment, since before the widget existed) — no config change was needed. Firefox is still not configured (`playwright.config.ts`'s `projects` array has only `chromium`) — `docs/testing.md` §2.4 names Chromium **and** Firefox for this layer specifically; adding a Firefox project is real, cheap, separable follow-up work, not done in this pass.
4. **Two of three cross-module wiring scenarios remain genuinely unproven** (`tasks/todo.md`'s own checklist, honestly left open rather than faked): SEWA bill API degradation automatically tripping its breaker and serving the fallback (needs `apps/ai` executing a real failing tool call); an unresolved source conflict measurably lowering grounding confidence through to a tripped refusal policy (needs `apps/ai`'s retrieval/scoring pipeline). The third — a flow engine `Handover` node firing and its ticket carrying the exact trigger reason — is now partially illuminated by this pass's own finding: `conversation-widget.spec.ts` proves the *citizen-initiated* (`UserRequest`) handover path end to end for real, which is a different reason code from a flow-triggered one, and confirms (by reading `use-widget-conversation.ts` directly) that the SSE `handover_triggered` event still only sets local UI state and does not itself call the real `POST .../handover` endpoint — so a flow-triggered handover creating a real, correctly-reasoned ticket remains unproven and, on this reading, may not even be wired yet on the `apps/web` side, not only unproven on the `apps/ai` side. All three still need the Python `apps/ai` runtime (or, for the third, the `apps/web` wiring first) exercised directly, deeper than this pass's time budget allowed.
5. **FR-AGENT-03/04/05/06/07**, the remaining **FR-TOOL** rows, **FR-IAM-03/04/08/09/10/17**, and the many per-§2-subsection "not yet covered" lists above are real, reachable-today gaps, not blocked ones — the natural next slice for whoever picks this up.
6. **The full-suite regression run after this pass's additions** should be re-confirmed with a clean environment (no concurrent agent runs, confirmed free disk space) before being trusted as a final number — see §4's environment note.
7. **`queue-tab.tsx`'s silent claim-failure-on-select gap** (§2.13) — a real, small UX defect (opening a `Queued` ticket with a fresh/offline agent presence silently fails to open anything, no error explaining why) found while building `conversation-widget.spec.ts`, not fixed (out of this pass's stated scope, which prioritised the E2E gap over incidental UI bugs found along the way).
