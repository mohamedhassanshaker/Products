# QA Report — Agent Builder v2 Shell (Phase 16 regression)

**Verdict: PASS-WITH-CAVEATS.** The 9-tab shell itself is well-built and every golden path in scope works end-to-end against a real backend, with genuine persistence and a real successful publish — but this pass found and had to work around a **critical, pre-existing backend defect that leaves the public API unable to boot at all**, which would have blocked all three parallel QA passes, not just this one.

Screenshots: 45 PNGs, numbered/named by step, in this same folder — reusable as the visual basis for the user-guide document.

## 1. Environment

| Component | How it ran |
|---|---|
| Postgres 16 | disposable Docker `qa-v2-builder-pg`, `127.0.0.1:25732` — note: plain `postgres:16-alpine` failed migration `20260902202319_knowledge_rag` (`extension "vector" is not available`); swapped to `pgvector/pgvector:pg16`, which the Knowledge/RAG phases require |
| Redis 7 | disposable Docker `qa-v2-builder-redis`, `127.0.0.1:25779` |
| LiveKit | disposable Docker `qa-v2-builder-lk` (`--dev`), `127.0.0.1:25780` (not exercised directly — no live call in scope) |
| Schema/seed | real `prisma migrate deploy` (all 9 migrations), real `prisma/seed.ts` catalog seed |
| Public API | real `node dist/main.js`, `127.0.0.1:25701` — required a one-line source fix to boot at all (D-1) |
| Internal API | real `node dist/main-internal.js`, `127.0.0.1:25702` |
| Admin SPA | real `ng serve admin --proxy-config ... --port 25710`, `127.0.0.1:25710/admin/` |
| Browser | Playwright 1.62.1 / Chromium (scratchpad install), 1440×1000, driving the real dev server as an operator would |

Tenant/data seeded via real HTTP only: one operator admin, one tenant (`QA V2 Builder Tenant`, final id `93b10cb9-ad7d-4d55-96c6-ed67ef7c3cc2`), 5 real provider credentials (LiveKit/Deepgram/OpenAI/ElevenLabs/bitHuman — fake-but-well-formed refs, no real vendor calls). Two earlier tenants were created and discarded while chasing test-script timing issues (see §4).

**Teardown:** all 3 Docker containers and both Node backend processes stopped; `ng serve` stopped; scratchpad proxy config removed. Nothing left running. The one D-1 source fix was left in place in `apps/api/src/modules/hitl/hitl.module.ts` — without it the backend cannot boot at all, and the other two parallel QA passes share this same backend.

## 2. Traceability matrix

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Shell redirects to `/overview`; 9 tabs in A9.1 order | PASS | `01-shell-initial-overview.png` |
| 2a | Overview 4 cards show real configured data | PASS | `41-overview-final-configured.png` |
| 2b | Overview `[edit ▸]` links navigate correctly | PASS | navigated to `/pipeline`, `/reasoning` |
| 2c | Right rail shows turn budget/cost/validation | PASS | `42-overview-final-right-rail.png` |
| 2d | No Diff button, no Last Eval card | PASS (both counts 0) | `02-overview-initial-empty.png` |
| 3a | Pipeline validation errors on incomplete selection | PASS ("Select a provider for stt./tts.", 4 errors) | `04-pipeline-empty-with-errors.png` |
| 3b | Pipeline: set STT/TTS/Avatar + credentials | PASS (errors clear to 0, Save Draft works) | `05-pipeline-fully-configured.png` |
| 4a | Reasoning Core instructions (prompt+byte-counter, runtime, memory+window_turns) | PASS (persisted through save+reload, confirmed in published YAML) | `09-reasoning-core-instructions-filled.png` |
| 4b | Reasoning graph editor/inspector, 3-node LLM→Speak→End | PASS (confirmed via published config: `llm-1→speak-1→end-1`) | `13-reasoning-graph-wired.png` |
| 5 | Skills: create, publish, library reflects it | PASS | `19-skills-library-with-new-skill.png` |
| 6 | Tools: create, mark consequential, ack field appears | PASS (field count 0→1 across the toggle) | `21-tools-consequential-ack-field.png` |
| 7 | Knowledge sub-tabs render; upload a source | PASS | `25-knowledge-sources-with-upload.png` |
| 8 | Dynamics: all 5 field groups, save+reload persistence | PASS (`silence=900 reprompts=3 tokens=250` survives reload) | `31-dynamics-after-reload.png` |
| 9a | HITL: reviewer group + gate, all 6 R-H1 fields | PASS | `37-hitl-gates-list-with-gate.png` |
| 9b | whisper/post_hoc visibly-disabled with reason | PASS (disabled + "Coming soon" badge/tooltip) | `35-hitl-gate-dialog-gate-types.png` |
| 10a | Privacy shows Residency content, relabeled | PASS content / see D-3 relabel gap | `38-privacy-tab-residency-content.png` |
| 10b | Privacy: saving a setting works | PASS (server-confirmed `retain_transcripts_days: 45`) | `39-privacy-after-save.png` |
| 11 | 6 legacy URL redirects | PASS, all 6 | log lines, all 6 confirmed |
| 12a | Save Draft persists across reload | PASS | `43-overview-after-explicit-reload.png` |
| 12b | Publish blocked on incomplete config | PASS (button genuinely `[disabled]`) | `03-publish-disabled-incomplete-config.png` |
| 12c | Publish succeeds on complete config | PASS (server confirms `status: published`) | `45-overview-after-publish-attempt.png` |

Zero unexpected browser console/page errors across the entire walkthrough.

## 3. Defects (by severity)

**D-1 — Public API (`main.js`) fails to boot at all (Critical/Blocking).** Not Phase-16 code (it's Phase 14 HITL), but it blocks every other consumer of the public listener, including both other parallel QA passes, since they share this backend. `HitlModule` provided `HITL_DEFERRED_FOLLOWUP_QUEUE_PORT` but never exported it; `JobsModule` (wired only into the public `app.module.ts`, not `internal-app.module.ts` — which is why `main-internal.js` booted fine all along) injects that token into `HitlSlaSweepProcessor` and crashes on every boot with `UnknownDependenciesException`. No test anywhere boots the real `AppModule` end-to-end, so the 1290 passing Jest tests never caught it. **Fix applied and disclosed:** added the missing token to `HitlModule`'s `exports` array (one line, `apps/api/src/modules/hitl/hitl.module.ts`). Re-verified: `nest build` clean, `tsc --noEmit` clean, `jest --runInBand hitl jobs` (6 suites/20 tests) green, `main.js` now boots correctly. Left in the working tree.

**D-2 — Overview tab's Media Pipeline rows show raw lowercase keys ("transport"/"stt"/"tts"/"avatar"), not display labels (Low-Moderate).** Genuinely new Phase 16 code (`overview-tab.component.ts`'s `pipelineRows()`), and the third recurrence of a bug class this project already flagged twice before (Phase 7 D-1 Dashboard "Stt"/"Llm"/"Tts"; Phase 7 D-2 GPU role labels) — no display-name map exists for this new component despite the fix pattern already being established. Evidence: `41-overview-final-configured.png`.

**D-3 — Privacy tab's embedded content keeps stale "Data residency" chrome (Low).** The tab strip correctly reads "Privacy," but the embedded page's own header still reads "· Data residency" and its back-link still says "Back to deployments" (exits the tenant entirely) instead of "Back to Agent Builder" like every other embedded tab. `residency-page.component.ts`'s `backToDeployments()`/title binding were never updated for the new context. Evidence: `38-privacy-tab-residency-content.png`.

**D-4 — HITL gate dialog's "Attachment kind" shows raw lowercase "tool" (Low, pre-existing Phase 14, incidental).** Same missing-label-mapping pattern as D-2; template only special-cases `graph_node`. Out of primary Phase 16 scope, noted for completeness. Evidence: `35-hitl-gate-dialog-gate-types.png`.

## 4. Test-tooling notes (ruled out as product bugs, not filed as defects)

Two Playwright pacing issues briefly looked like real bugs and were root-caused before being ruled out: (1) opening a second node-inspector dialog immediately after applying the first intermittently dropped a "Next node" selection — reproduced as a script-timing artifact only; driven at normal pace with a wait for dialog-close, wiring persists correctly every time. (2) clicking a `mat-slide-toggle`'s wrapper instead of its inner `button[role="switch"]` didn't always register — confirmed a Playwright-targeting nuance, not a product bug.

## Verdict

PASS-WITH-CAVEATS. Defect count by severity: 1 Critical/Blocking (D-1, fixed and left in place — affects the whole product, not just this shell), 1 Low-Moderate (D-2), 2 Low (D-3, D-4).
