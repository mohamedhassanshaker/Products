# QA Report — Phase 2 Admin SPA (BL-009, provider-registry UI parts of BL-005/006/007)

**Date:** 2026-08-19
**Tester:** nexus-qa
**Scope:** Angular admin SPA — Provider Registry (catalog + per-tenant credentials) and Agent Builder. Backend (`apps/api`) exercised only as a dependency.

## Environment

**Evidence directory:** `qa-results/phase2-admin-spa/20260819-evidence/` (screenshots in `shots/`, redacted-YAML/console-log text captures alongside).

- `docker version` / `docker info` / `docker compose up` all hang past 90s in this sandbox despite `com.docker.backend.exe` and `docker context ls` both responding — the Docker daemon itself is unreachable, identical to every prior QA pass in this project's history (see `docs/NEXUS_STATE.md` decision log, Phase 1). The only reachable Postgres (`localhost:5432`) is a pre-existing instance with different credentials (`password authentication failed`), not this project's. **No live backend could be started.** This is an environment blocker, not a code defect, and is now the fourth consecutive QA pass in this project blocked by it.
- Admin SPA: a real Angular dev server was already running (`ng serve admin --serve-path=/admin/`, Vite-based Angular 20), reachable at `http://localhost:4200/admin/`. Used as-is (confirmed genuinely serving the current compiled source, not a stale build).
- Because no live backend was reachable, browser scenarios were driven with real Chromium (Playwright 1.62.1, headless) against the real compiled SPA, with the network boundary stubbed at the documented `/api/*` routes only. Every stub response uses the **actual wire envelope** verified from `apps/api/src/common/errors/app-exception.filter.ts` (`{ error: { code, message, details } }`) and the actual DTOs from `packages/contracts/src`. This is the same disclosed-stub methodology used and accepted in every prior Phase 1 QA pass.
- Independently ran, against the real repo (no stubbing possible or needed): frontend Jest, ESLint, `ng build admin`, `ng build conversation`, backend Jest, backend ESLint. Backend e2e (`test:e2e`) was attempted and — as in every prior pass — times out in a testcontainers `PostgreSqlContainer(...).start()` hook because Docker is unreachable; this is unchanged from the existing, already-disclosed environment gap and not new to this phase.

## Regression (independently re-run, not taken on faith)

| Check | Result |
|---|---|
| Frontend `pnpm run test:cov` (apps/web) | **225/225 tests, 36/36 suites green**, 94.09% stmts / 83.9% branches — matches dev's claimed numbers exactly |
| Frontend ESLint | Clean (0 problems) |
| `ng build admin` | Clean (only a pre-existing, unrelated `@liveavatar/contracts` CommonJS-optimization-bailout warning) |
| `ng build conversation` | Clean |
| Backend `pnpm run test:cov` (apps/api) | **411/411 tests, 72/72 suites green** — matches dev's claimed numbers |
| Backend ESLint | Clean |
| Backend e2e (`test:e2e`) | Times out in testcontainers `PostgreSqlContainer.start()` — Docker-unreachable, pre-existing/disclosed gap, not attributable to this phase |
| AI-boundary grep (`openai`/`@anthropic-ai`/ADK literals) | No real SDK imports found in `apps/api/src/modules/providers`, `apps/api/src/modules/deployment-config`, or the admin SPA — all matches are provider-key string literals in fixtures/specs, as expected (AI subsystem is out of this phase's scope by design) |
| Dependency additions | `tsx`, `bullmq`, `@nestjs/bullmq`, `yaml` (api) and `yaml` (web) — matches dev's disclosed list; `tsx` is the one not named in ADR-001's table but is a maintained, MIT dev-only seed-runner dependency, consistent with the ADR's maturity bar (as dev's own log already flagged) |

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PROVIDER-1 (catalog never empty, operator enable/disable, `PROVIDER_CATEGORY_EMPTY`) | Load catalog; disable a non-last provider (succeeds); disable the last-enabled provider in a category (blocked) | **PASS** | `shots/02`, `shots/03`, `shots/04` |
| FR-PROVIDER-2 (credential CRUD, no raw secrets) | Add-credential dialog; secret-shaped value (`{"api_key":"sk-live-..."}"`) in Extra settings → `400 PROVIDER_SECRET_IN_BODY` | **PASS** | `shots/08`, `shots/09` |
| FR-PROVIDER-3 (probe, always 200) | Row action → Test connection → chip updates to Healthy + "Checked just now" | **PASS** | `shots/10` |
| FR-PROVIDER-6 (hosting badges) | Verified on catalog and credentials list and Agent Builder dropdown options/resolved list | **PASS** | `shots/02`, `shots/06`, `shots/13` |
| FR-PROVIDER-7 / FR-CONFIG-2 (`credential_ref` never a raw secret; canonical schema) | Inspected redacted YAML for Example A/B | **FAIL (see D-1)** — no secret leaked (good), but `credential_ref` is never populated at all for **any** layer, not just kept redacted | `example-a-redacted-yaml.txt`, `example-b-redacted-yaml.txt` |
| FR-CONFIG-1 (Agent Builder editor, empty state) | Fresh tenant load: all dropdowns "Select…", 4 inline `CONFIG_INCOMPLETE` errors, resolved list "Not configured yet" | **PASS** | `shots/12` |
| FR-CONFIG-3 (validate/save, draft vs publish, `If-Match`/`CONFIG_CONFLICT`) | Built Example A and B end-to-end, both validated `valid:true`, both published successfully; triggered a stale-`If-Match` conflict server-side (confirmed via server log line, `409` observed) | **PASS-WITH-CAVEAT** — conflict banner's rendered position could not be re-confirmed by screenshot this pass because the harness had scrolled the page (test-tooling limitation, not a product defect); the store/template code (`agent-builder.store.ts` `conflict` flag + template `role="alert"` banner + Reload confirm-dialog) was independently read and matches spec exactly, and the `409` was observed to actually reach the client without a crash | `console-errors.txt` (409 line), code review |
| FR-CONFIG-4 (live preview, debounced validate, resolved stack + hosting + `has_secret`) | Watched preview update after each dropdown/field change on both examples | **PASS** | `shots/13`, `shots/15` |
| FR-CONFIG-5 (Deployments row click-through to Builder) | Confirmed `routerLink`/`Open builder` menu action target `/tenants/:id/builder`; `Manage provider credentials` action targets `/admin/tenants/:id/provider-credentials` | **PASS** (static verification — no live tenants list to click through since backend unreachable) | code review, `apps/web/.../deployments-list-page.component.html` |
| UX_GUIDELINES §9.7/§9.14 (phone stacked-card layout, Provider Registry) | Both `/admin/providers` and `/admin/tenants/:id/provider-credentials` at 375px | **FAIL (see D-2)** | `shots/05`, `shots/11` |
| UX_GUIDELINES §10.4 (phone tab-split fallback, Agent Builder) — flagged deviation | `/admin/tenants/:id/builder` at 375px | **PASS** — genuinely a clean single-column stack, no overlap/illegibility; the disclosed "no tab-split" simplification does **not** reproduce Phase 1's D-6 overlap bug | `shots/18` |
| UX_GUIDELINES §10.5 (multi-credential-per-provider dropdown) — flagged "unconfirmed invented pattern" | Reviewed `agent-builder-page.component.ts`/`.html` for the credential-selection mechanism | **FAIL (see D-1)** — not merely "single-credential-only, simplified" as dev's log claims; **no** credential is ever associated with a selected provider, single or multiple | code review, confirmed live via `example-a/b-redacted-yaml.txt` |
| WCAG 2.2 AA — inline error announcement, icon+text, autofocus | Login autofocus (regression re-check), `PROVIDER_CATEGORY_EMPTY` inline row alert, secret-in-body dialog error, empty-catalog/empty-config states | **PASS** | `shots/04`, `shots/09`, `shots/12` |
| Security spot-check (auth guards, tenant re-derivation, secret handling) | Read `save-config.use-case.ts`, `providers.controller.ts` route guards, `validate-config.use-case.ts` | **PASS** — `AdminJwtGuard`/`RolesGuard` present, tenant access re-derived server-side, secrets never round-tripped, `containsSecretKey` shared between the two guard sites as claimed | code review |

## Defects

### D-1 — **BLOCKING.** Agent Builder never sets `credential_ref` on any layer (Phase 2 dev, `agent-builder-page.component.ts`)

**Expected:** FR-CONFIG-2's canonical schema requires `credential_ref` on transport/stt/llm.primary/llm.fallback/tts/avatar. UX_GUIDELINES §10.5 is explicit: *"A provider with exactly one tenant credential is selectable directly; selecting it sets both `provider` and `credential_ref` in the draft."* The Phase 2 dev log itself claims: *"the dropdown currently assumes one credential per provider per tenant, matching what `PROVIDER_CREDENTIAL_EXISTS` actually enforces today."*

**Actual:** None of the seven provider-selection handlers (`onSttProvider`, `onLlmPrimaryProvider`, `onLlmFallbackProvider`, `onTtsProvider`, `onAvatarProvider`, and transport, which is fixed/non-interactive) ever write `credential_ref` into the draft — only `provider`. Confirmed two ways:
1. **Code:** `grep -n credential_ref` inside `features/agent-builder/` only matches the type definition in `agent-config-draft.model.ts`; it is never assigned anywhere in `agent-builder-page.component.ts`.
2. **Live browser evidence:** built both spec examples end-to-end (Example A: `openai`+`deepgram`+`fish-speech`+`bithuman`+`livekit`; Example B: `anthropic`+`faster-whisper`+`elevenlabs`+`alibaba-liveavatar`+`livekit`) against a tenant with real credentials configured for every one of those providers. Both validated `valid: true` and both **published successfully** — but the redacted YAML preview (`example-a-redacted-yaml.txt`, `example-b-redacted-yaml.txt`, also visible live in `shots/13`–`16`) shows **zero `credential_ref` keys anywhere**, for either example.

**Why validation doesn't catch it:** the backend's combination rule (`combination-rules.ts` `credentialExistsRule`) and the preview's `has_secret` resolution (`validate-config.use-case.ts` `resolveLayer`/`hasCredential`) both check *whether the tenant has any credential for that provider key* — neither reads `config.*.credential_ref` at all. So the UI's preview honestly-but-misleadingly shows "has_secret: true" per layer while the underlying persisted config has no way to actually resolve which secret to use. `save-config.use-case.ts` persists exactly what the client sent (`stringifyAgentConfig(gateA.config)`), so this isn't masked at save time either — the actually-published YAML is missing the field.

**Impact:** this defeats the entire purpose of the Provider Registry ↔ Agent Builder relationship for any future consumer of `DeploymentConfig.yaml_text` (the Phase 4+ agent runtime is the obvious one, per LLD's cross-language contract) — it would have a provider name but no pointer to which credential to actually use. This is not the "multiple credentials, unconfirmed pattern" simplification the dev log describes; it is broken for the *single-credential* case too, i.e. the one case the dev log claims is intentionally supported.

**Repro:** `/admin/tenants/:id/builder` → select any provider with ≥1 tenant credential in any of the five credentialed layers → inspect the YAML in the preview pane (or `GET /tenants/:id/config` after Save Draft/Publish) → `credential_ref` is absent.

**Severity:** Blocks the requirement (FR-CONFIG-2, FR-PROVIDER-5 in spirit). **Originating phase:** Phase 2 dev (Agent Builder UI, `agent-builder-page.component.ts`).

### D-2 — **Blocks a UX requirement, non-crashing.** Provider Registry has no phone responsive layout at all (Phase 2 dev + Phase 2 UX gap)

**Expected:** UX_GUIDELINES §9.7 (global catalog) and §9.14 (per-tenant credentials) both explicitly require a stacked-card phone/tablet layout below 1280px, matching the pattern already built and QA-verified for Deployments in Phase 1 (D-6/D-7 fixes).

**Actual:** at 375px, both `/admin/providers` (`shots/05`) and `/admin/tenants/:id/provider-credentials` (`shots/11`) render the **unmodified desktop `mat-table`**. Consequences, confirmed by screenshot:
- On the catalog page, the "Enabled" column (the only interactive control on the page) is cut off past the right edge of the viewport — an operator cannot see or reach the toggle without horizontal scroll, and the `PROVIDER_CATEGORY_EMPTY` inline alert text wraps into an illegible single-character-per-line column at the cut-off edge.
- On the per-tenant credentials page, the Secret / Connection / Actions columns (health status, "Test connection"/"Edit"/"Delete") are entirely off-screen — none of the row actions are reachable without horizontal scrolling, which the desktop table does not make discoverable (no visible scroll affordance in the screenshot).

This is a different failure mode than Phase 1's D-6 (row/paginator vertical overlap) but the same class of defect the orchestrator's dispatch specifically asked QA to re-check for at 375px given "Phase 1's history there" — it reproduces the spirit of that history (a genuinely unusable phone layout), just via horizontal overflow instead of vertical overlap.

**Repro:** set viewport to 375×800, navigate to `/admin/providers` or `/admin/tenants/:id/provider-credentials`.

**Severity:** Blocks the requirement (UX_GUIDELINES §9.7/§9.14 are explicit, non-optional responsive specs for this phase — unlike the Agent Builder tab-split, which dev explicitly flagged as a disclosed simplification, this was never flagged as a deviation). **Originating phase:** Phase 2 dev (`provider-catalog-page.component.scss` / `provider-credentials-page.component.scss` — no phone media query was written at all, as opposed to Agent Builder where one was deliberately omitted and disclosed).

### D-3 — Low. Agent Builder "Publish" button gives no visual affordance change after a successful, in-sync publish

**Expected:** UX_GUIDELINES §10.3 "Published, in sync": *"Publish button becomes 'Published' (disabled, checkmark) or hidden in favor of a `status-chip` 'Published' near the header."*

**Actual:** after a successful publish with no further edits, the Publish button in `shots/14`/`shots/16` remains labeled "Publish" and enabled (matches `[disabled]="!store.canPublish() || ..."`, and `canPublish()` stays `true` since the last validate result is still valid). The header-area "Published" `status-chip` **does** render correctly per the template (`la-builder-chip--published`) — this was not re-confirmed by screenshot this pass (viewport was scrolled past it), so this finding is scoped only to the button itself, not the whole "Published, in sync" state.

**Severity:** Rough edge — re-publishing an unchanged, already-published config is harmless (FR-CONFIG-3's idempotency clause even expects this to be a safe no-op), and the header chip likely already covers the "system status" requirement. Cosmetic-only. **Originating phase:** Phase 2 dev, `agent-builder-page.component.html`.

## Deviations reviewed and found acceptable (not defects)

- **No mobile tab-split for the builder:** confirmed at 375px — genuinely a clean single-column stack, all fields reachable in order, no overlap or truncation. Does not reproduce Phase 1's D-6. Acceptable as a disclosed scope simplification.
- **No route-leave guard on unsaved builder changes:** confirmed this is a scope gap only — no corrupted state was observed leaving the page dirty (the store's `dirty`/`ifMatch` are page-lifetime signals with no attempt at cross-navigation persistence, so there is nothing to corrupt, only unsaved work to lose with no warning). Acceptable severity-wise as a rough edge, though worth prioritizing before general release given it is explicitly called for in UX_GUIDELINES §10.2 step 9.
- **No two-level multi-credential dropdown:** the dev log's framing ("single-credential case supported, multi-credential case simplified away") is **not accurate** — see D-1. The dropdown doesn't handle the single-credential case correctly either, so this item is superseded by D-1 rather than being a separate, smaller gap.

## Overall verdict: **NOT READY — PASS-WITH-CAVEATS is not appropriate here; recommend retry nexus-dev**

D-1 blocks FR-CONFIG-2/FR-PROVIDER-5 in a way that would silently corrupt every published deployment config's usefulness to any downstream consumer (the credential can never actually be resolved from the published YAML) — this is not a cosmetic or edge-case gap, it is the core wiring the whole Provider Registry ↔ Agent Builder feature exists to provide, and it fails on the very "golden path" (Examples A and B) the task asked QA to drive. D-2 independently blocks an explicit, non-optional UX requirement for this phase. Recommend nexus-dev retry scoped to: (1) set `credential_ref` (resolved from the tenant's single matching `ProviderCredential` per provider) on every provider-selection handler in `agent-builder-page.component.ts`, re-decide/confirm the multi-credential UX per §10.10 rather than silently no-op'ing it, and (2) add the phone stacked-card layout to both Provider Registry pages per §9.7/§9.14. D-3 can batch with the next pass; the "acceptable deviations" above need no further action beyond keeping them disclosed.
