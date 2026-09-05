# QA Report (Retry 1) - Phase 2 Admin SPA (BL-009 + provider-registry UI)

**Date:** 2026-08-19
**Tester:** nexus-qa
**Scope:** Angular admin SPA re-verification of D-1/D-2/D-3 from `qa-results/phase2-admin-spa/REPORT.md`, plus targeted regression. Backend (`apps/api`) is out of scope - covered by a parallel QA agent.

## Environment

**Evidence directory:** `qa-results/phase2-admin-spa/20260819-retry1-evidence/` (screenshots in `shots/`, plus JSON captures of the actual `PUT /tenants/:id/config` request bodies and a console-error dump).

- Docker/Postgres are still unreachable in this sandbox: `docker info`/`docker version` returned no output before timing out, and the only reachable `localhost:5432` and `localhost:3000`/`:8080` ports belong to unrelated pre-existing services on this machine (a Flowise instance and a bare nginx welcome page respectively), not this project's backend. This is the same, already-disclosed environment gap as every prior QA pass in this project (Phase 1 x3, Phase 2 backend, Phase 2 admin SPA original pass) - no live backend could be started, confirmed freshly this pass rather than taken on faith.
- Admin SPA: a real Angular dev server was already running (`ng serve admin --serve-path=/admin/`, Vite-based Angular 20) at `http://localhost:4200/admin/`, confirmed serving current compiled source (200 responses, live-reloadable).
- Because no live backend was reachable, all browser scenarios were driven with real Chromium (Playwright 1.62.1, headless, via `qa-results/phase2-admin-spa/run-qa.mjs`) against the real compiled SPA, with the network boundary stubbed at the documented `/api/*` routes only. Every stub response uses the real wire shapes from `packages/contracts/src` (ProviderCredentialDto, ProviderDefinitionDto, ValidateConfigResponseDto, DeploymentConfigDto, TokenPairDto, etc.) - same disclosed-stub methodology accepted in every prior pass. One correction versus the original pass's assumption: the SPA's AuthStore keeps the access token in memory only (by design, per its own doc comment) and restores a session via POST /api/auth/refresh + GET /api/auth/me on every full page navigation, so /api/auth/refresh had to be stubbed for direct-URL navigation to work without bouncing to /login - this is a harness detail, not a product defect.
- Independently re-ran, against the real repo: frontend Jest, ESLint, ng build admin, ng build conversation. Backend regression was not re-run here (parallel agent's scope) but no backend files were touched by this dev pass (confirmed by reading the actual files: agent-builder-page.component.ts/.html, provider-catalog-page.component.html/.scss, provider-credentials-page.component.html/.scss only).

## Regression (independently re-run)

| Check | Result |
|---|---|
| Frontend `pnpm run test:cov` (apps/web) | **231/231 tests, 36/36 suites green** - matches dev's claimed numbers exactly |
| Frontend ESLint | Clean (exit 0, no output) |
| `ng build admin` | Clean (only the pre-existing, unrelated `@liveavatar/contracts` CommonJS-optimization-bailout warning, unchanged from every prior pass) |
| `ng build conversation` | Clean |
| Console/network errors during every browser scenario below | None (console-errors.txt = "(none)") |

## Defect-by-defect re-verification

### D-1 (was BLOCKING) - Agent Builder credential_ref wiring - FIXED, both single- and multi-credential cases

Code review (agent-builder-page.component.ts/.html): confirmed all seven provider-selection handlers now call a new autoCredentialRef(providerKey) helper that resolves the tenant's single matching ProviderCredential.credential_ref and writes it into the draft alongside provider; a new hasMultipleCredentials()/credentialsFor() pair drives a secondary "Credential" mat-select per layer (onSttCredential, onLlmPrimaryCredential, onLlmFallbackCredential, onTtsCredential, onAvatarCredential) that is shown only when a provider has more than one tenant credential - this directly implements UX_GUIDELINES section 10.5/10.10 rather than continuing to no-op the question.

Live browser evidence, single-credential case (tenant with exactly one credential per provider - Example A: deepgram/openai/fish-speech/bithuman/livekit):
- Built the config end-to-end via the real dropdowns, saved a draft, and published.
- No secondary Credential dropdown rendered anywhere (count=0) - correct per section 10.5's "exactly one credential is selectable directly."
- Captured the actual PUT /tenants/:id/config request body sent by the client (not just the preview) - see 20260819-retry1-evidence/example-a-published-body.json and the extracted example-a-credential-refs.json:

```json
{ "stt": "cred-deepgram-1", "llm_primary": "cred-openai-1", "tts": "cred-fish-1", "avatar": "cred-bithuman-1" }
```

Every credentialed layer carries the correct credential_ref. Screenshot shots/05-example-a-after-publish.png shows the same values live in the redacted-YAML preview pane.
- This directly closes the original defect: the prior pass's Example A/B publish produced zero credential_ref keys anywhere; this pass's Example A publish produces the correct key on every layer that has one.

Live browser evidence, multi-credential case (gave the tenant 2 credentials for openai: "OpenAI prod" / cred-openai-1 and "OpenAI staging" / cred-openai-2):
- Selecting OpenAI as the LLM primary provider correctly surfaced the secondary "Credential" dropdown (shots/07-multi-credential-dropdown-appears.png), which was absent in the single-credential run.
- Opening it (shots/08-multi-credential-options-open.png) lists both tenant credentials by their real display_label ("OpenAI prod", "OpenAI staging") - confirming the dropdown is genuinely wired to credentialsFor(), not a static placeholder.
- Picked "OpenAI staging" (the non-default, second credential), saved and published. The captured PUT body (multi-credential-published-body.json) shows llm.primary.credential_ref: "cred-openai-2" - the explicit selection, not the first/default credential - confirming the picker's value is what actually reaches the published config.

Verdict: D-1 is genuinely fixed for both the single-credential auto-resolution path and the previously-unbuilt multi-credential picker path. This was the blocking defect from the prior pass and it is closed.

### D-2 (was blocking a UX requirement) - Provider Registry phone stacked-card layout - FIXED

Code review: both provider-catalog-page.component.scss and provider-credentials-page.component.scss now carry a @media (max-width: 767px) block that reuses the Phase-1 deployments-list stacked-card pattern verbatim (display:block/height:auto overrides on table/tbody/row/cell, data-label ::before pseudo-elements, word-break/white-space handling) - both .html templates now set data-label on every td[mat-cell].

Live browser evidence at 375px (6 catalog rows across 3 categories; 4 credential rows):
- shots/02-catalog-375px.png: clean stacked cards, label/value pairs for Provider/Hosting/Interface/Enabled, the Enabled toggle fully visible and reachable (previously cut off past the viewport edge).
- shots/03-credentials-375px.png: clean stacked cards for Provider/Display label/Endpoint/Secret/Connection/Actions, the three-dot Actions menu now visible and reachable (previously entirely off-screen).
- Measured via getBoundingClientRect on every td[mat-cell] and every tr[mat-row] (same method used to catch the original Phase-1 D-6/D-7 and this phase's D-2): zero cells extend past the 375px viewport edge on either page, and zero row-to-row vertical overlaps on either page.

Verdict: D-2 is genuinely fixed on both pages, confirmed both visually and via the same programmatic measurement that caught the original defect.

### D-3 (was Low) - Publish button "Published" disabled state - FIXED, including the revert-on-edit case QA additionally checked

Live browser evidence (continuing the Example A single-credential session):
- Immediately after a successful publish with configStatus() === 'published' and no further edits, the button text became "Published" with a check_circle icon (shots/05-example-a-after-publish.png) and isDisabled() confirmed true programmatically.
- Edited a field afterward (STT language, to en-GB - a value not already set, guaranteeing dirty() flips true) and re-measured: the button reverted to the enabled "Publish" label (disabled=false), confirming the state machine correctly tracks hasUnpublishedChanges() in both directions rather than only handling the fresh-publish moment.

Verdict: D-3 is fixed, and the additional revert-after-edit case the dispatch asked for was also verified working.

## Traceability matrix (this retry's scope)

| Item | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| D-1, single-credential auto-resolution | Example A end-to-end build/save/publish; inspected actual PUT request body | PASS | example-a-published-body.json, example-a-credential-refs.json, shots/04-05 |
| D-1, multi-credential secondary dropdown | 2-credential tenant fixture; dropdown appearance, option listing, explicit selection, inspected actual PUT request body | PASS | multi-credential-published-body.json, shots/07-09 |
| D-2, catalog page phone layout | 375px, getBoundingClientRect on every cell/row | PASS | shots/02, results.json |
| D-2, credentials page phone layout | 375px, getBoundingClientRect on every cell/row | PASS | shots/03, results.json |
| D-3, Publish-to-Published transition | Post-publish button state + disabled check | PASS | shots/05 |
| D-3, Published-to-Publish revert on edit | Edited STT language post-publish, re-measured button | PASS | shots/06 |
| Regression: login flow | Real login form to deployments list | PASS | shots/01 |
| Regression: deployments list renders | Row count check post-login | PASS | results.json |
| Regression: ng build/ESLint/Jest | Independently re-run | PASS | terminal output above |
| Spot-check: probe/CRUD logic untouched | Code-diff confirms provider-credentials-page.component.ts (probe/CRUD handlers) was not touched by this dev pass - only its .html/.scss changed for D-2 - and the 375px screenshot shows Secret/Connection/Actions render correctly in the new layout | PASS (code review + screenshot, not a full re-drive) | provider-credentials-page.component.ts (read, unchanged), shots/03 |

No untested requirements in this retry's scope - it was scoped to D-1/D-2/D-3 plus proportional regression, per the dispatch.

## Deviations / caveats disclosed

- Backend/Docker unreachable, as in every prior pass in this project - this is an environment gap, not a code defect, and does not affect the verdict on the frontend work re-verified here.
- Probe flow, credential CRUD dialogs, and deployments pause/activate were not re-driven end-to-end this pass (only spot-checked via code-diff + the 375px screenshot) because this dev pass's file footprint did not touch their .ts logic and the prior pass already verified them in depth; re-driving them fully would not be proportional to a narrowly-scoped D-1/D-2/D-3 retry.

## Overall verdict: PASS

All three defects from the prior pass (qa-results/phase2-admin-spa/REPORT.md) are confirmed fixed with concrete evidence: D-1 (blocking) now populates credential_ref correctly in both the single-credential auto-resolve path and the newly-built multi-credential picker path, verified against the actual request body sent to the backend, not just the preview pane; D-2 (blocking a UX requirement) now renders a working phone stacked-card layout on both Provider Registry pages, verified with the same measurement method that caught the original defect; D-3 (low) now shows the correct disabled "Published" state and correctly reverts to enabled "Publish" on further edits. Full regression (231/231 tests, ESLint, both builds) is clean and matches dev's claims. No new defects found in this retry's scope. Recommend the orchestrator advance Phase 2's admin-SPA portion (BL-009 + provider-registry UI) toward closure, pending the parallel backend QA agent's own sign-off.
