# QA Report — Phase 6 (BL-019): Alibaba LiveAvatar second avatar adapter

**Verdict: PASS-WITH-CAVEATS**

## Scope tested
IAvatarProvider contract compliance and pipeline lifecycle wiring for
apps/agent/src/avatar_agent/adapters/avatar/alibaba_liveavatar.py; error-handling
mapping; AI-boundary (websockets) isolation; the FR-AVATAR-2 feature-gap
copy end to end (spec, seed, API, real Agent Builder UI); registry wiring;
hop-metric recording; full regression (pytest/ruff/mypy/import-linter, backend
jest/ESLint, frontend jest/ESLint/ng build).

The invented, single-file-scoped Alibaba LiveAvatar wire-protocol assumption
(WebSocket to {endpoint_url}/v1/render/stream, bearer auth, JSON control plus
binary PCM/RGB24 frames) was NOT re-litigated as a blocking finding -- this
was already surfaced and accepted by the orchestrator. It is carried forward
here only as a caveat, not counted against the verdict.

## Environment
- Docker was reachable in this sandbox for the first time in this project's
  QA history (all five prior QA rounds recorded Docker/Postgres/LiveKit as
  unreachable). Host ports 5432/6379/8080 were already occupied by unrelated
  local projects (nextbot-*), so a disposable Postgres 16 container
  (liveavatar-pg-qa, port 5433) was used instead of docker-compose.dev.yml's
  default; LiveKit ran via the compose file on its default ports.
- Backend: apps/api built (tsc -p tsconfig.build.json) and run directly
  (node dist/main.js) against the disposable Postgres, real `prisma db push`
  plus `prisma/seed.ts`, on http://localhost:18090 (non-default port to avoid
  the host conflict).
- Frontend: `ng serve admin` (via `npx ng serve admin --proxy-config ...`) on
  http://localhost:4200/admin/, proxying /api to the backend above.
- Driven with a one-off Playwright script from the QA scratch directory (not
  added to the repo), a real Chromium instance, a real seeded
  qa-phase6@example.com operator account, a disposable tenant, and a real
  alibaba-liveavatar provider credential -- all created and torn down
  entirely inside the disposable Postgres container, which was removed at
  the end of this pass. All local env files (apps/api/.env) and
  apps/api/src/app.module.ts were restored to their original committed state
  after this pass (diffs verified clean); no repo file was left modified.
- Python: apps/agent/.venv (existing), full suite run in place.

## Traceability matrix

| # | Requirement / claim | Scenario(s) tested | Result | Evidence |
|---|---|---|---|---|
| 1 | IAvatarProvider contract shape matches bitHuman's (Phase 5) | Read both adapters side by side: start_session(), push_audio_frame(pcm), flush(), frames() -> AsyncIterator[VideoFrame], close(), first_frame_ms property -- identical signatures | PASS | adapters/avatar/alibaba_liveavatar.py, adapters/avatar/bithuman.py |
| 2 | Adapter plugs into pipeline.py's crash-recovery/degrade lifecycle correctly; no adapter-specific variant of the Phase 5 self-cancellation bug | Traced _attempt_avatar_recovery/_cancel_avatar_pump/_pump_avatar_frames: the lifecycle is generic over self._avatar: IAvatarProvider, with zero isinstance/adapter-specific branching anywhere; the asyncio.current_task() comparison Phase 5 QA's fix introduced applies identically regardless of which adapter is wired, so it cannot regress per-adapter | PASS | orchestration/pipeline.py lines 483-596 |
| 3 | AvatarError (AVATAR_NOT_FOUND vs AVATAR_UNAVAILABLE) raised correctly and consistently with bitHuman's pattern | Reviewed and independently re-ran the adapter's own 26-test suite: missing credential -> AVATAR_UNAVAILABLE; missing avatar_id -> AVATAR_NOT_FOUND; vendor error control message with code=avatar_not_found -> AVATAR_NOT_FOUND (mirrors bitHuman's ModelNotFoundError mapping), any other vendor error code -> AVATAR_UNAVAILABLE; WebSocketException/OSError at connect time -> AVATAR_UNAVAILABLE; malformed/non-dict control JSON -> AVATAR_UNAVAILABLE; mid-stream error message or dropped connection during frames() -> AVATAR_UNAVAILABLE | PASS | tests/adapters/avatar/test_alibaba_liveavatar.py (26 tests, 100% adapter coverage, all independently re-run) |
| 4 | AI-boundary: websockets isolated to this one adapter file | Ran lint-imports clean (3/3 kept, 86 files/255 deps -- matches dev's claim exactly); live-probed with a deliberate violation (appended `import websockets` to telemetry/hops.py) -- correctly caught (Vendor SDKs only inside adapters BROKEN); reverted, re-confirmed clean | PASS | terminal transcript, see Full regression section |
| 5a | Seed data (apps/api/prisma/seed.ts) matches FR-AVATAR-2's exact required sentence | Read docs/PRODUCT_SPECIFICATION.md FR-AVATAR-2 verbatim: "LiveAvatar: idle motion and custom upload may differ from bitHuman. Lip-sync and LiveKit publish are required." Confirmed byte-identical in seed.ts's alibaba-liveavatar row, and confirmed byte-identical in the real seeded Postgres row (select feature_gaps from provider_definition where key='alibaba-liveavatar') | PASS | docs/PRODUCT_SPECIFICATION.md FR-AVATAR-2, apps/api/prisma/seed.ts lines 105-119, direct psql query |
| 5b | Agent Builder UI genuinely renders this text when Alibaba LiveAvatar is selected | Drove the real UI in a real Chromium: logged in as a real seeded operator, created a real tenant plus a real alibaba-liveavatar provider credential via the real API, navigated to /admin/tenants/:id/builder, opened the Avatar provider dropdown (real mat-select), selected "Alibaba LiveAvatar" (real click, not a signal hand-set), confirmed the data-testid="avatar-feature-gap" note renders the verbatim sentence, confirmed the same text is present as the option's matTooltip, confirmed zero browser console/page errors during the flow | PASS | qa-results/phase6-alibaba-liveavatar/screenshots/04-alibaba-selected.png (also 01-03) |
| 6 | Registry wiring: selecting alibaba-liveavatar resolves to the real adapter, not a leftover FactoryLoadError | Read registry.py's _avatar_factories()/resolve_avatar -- both AVATAR_BITHUMAN and AVATAR_ALIBABA map to real adapter classes, no placeholder remains; confirmed via the adapter's own constructor tests and via the live API/UI pass above (GET /api/provider-definitions returns a real, enabled alibaba-liveavatar row with the correct feature_gaps) | PASS | registry/registry.py lines 191-210 |
| 7 | Hop metrics: avatar hop recorded the same way as bitHuman's | _publish_avatar_video/_attempt_avatar_recovery call the same shared HopRecorder/control_plane.send_hops with hop="avatar", provider_key=self._avatar.key -- adapter-agnostic, unchanged from Phase 5's own hop-recording code path; no new adapter-specific hop logic was added or needed | PASS | orchestration/pipeline.py lines 507-556 |
| 8 | Full regression: Python pytest/ruff/mypy/import-linter | Independently re-ran all four | PASS | see below |
| 9 | Full regression: backend jest | Independently re-ran | PASS | see below |
| 10 | Full regression: frontend jest, ESLint, ng build admin/ng build conversation | Independently re-ran all four | PASS | see below |

## Full regression -- independently re-run, all matching the dev's claims exactly

- Python (apps/agent, `pytest -q --cov=avatar_agent`): 237/237 passed, coverage 94.39% (adapters/avatar/alibaba_liveavatar.py 100%, adapters/avatar/bithuman.py 100%). `ruff check .`: clean. `mypy` whole-project: 22 errors in 6 files, all pre-existing (Phase 4 tool-calling pipeline.py typing gaps, Google adapter/pydantic-ai typing friction) -- none in alibaba_liveavatar.py or registry.py (scoped mypy run on those two files: 0 errors). `lint-imports`: 3/3 contracts kept, 86 files/255 dependencies -- matches dev's claim exactly; live-probed as described above (deliberate `import websockets` added to telemetry/hops.py, correctly caught as BROKEN, reverted, re-confirmed clean).
- Backend (apps/api, `jest --runInBand`): 577/577 passed (99 suites). `eslint "src/**/*.ts" "test/**/*.ts"`: clean.
- Frontend (apps/web, `jest --coverage`): 296/296 passed (43 suites). `eslint "projects/**/*.ts"`: clean. `ng build admin`: clean (pre-existing CommonJS warning on @liveavatar/contracts, unrelated to this phase). `ng build conversation`: clean (same pre-existing warning).

## Cross-cutting / seam checks (Phase 5 to Phase 6)
- Confirmed the shared avatar lifecycle in pipeline.py required zero changes for the second adapter -- this is the actual proof of FR-AVATAR-2's abstraction claim, verified by reading the lifecycle code itself (no adapter-type branching exists anywhere in pipeline.py) rather than trusting the decision log's assertion.
- Confirmed the Phase 5 self-cancellation defect class (D-1, qa-results/phase5-agent-bithuman/REPORT.md) cannot recur per-adapter, since the fix lives entirely in adapter-agnostic pump/recovery code, not anything this phase touched.
- Confirmed the feature-gap UI addition (Agent Builder) is a genuine, previously-missing seam between Phase 2's schema/DTO (which always had feature_gaps) and the UI layer -- closed correctly by this phase, verified rendering end to end against the real backend contract (packages/contracts/src/providers/schemas.ts's feature_gaps field).

## Non-blocking finding

F-1 (new, cross-cutting, NOT attributable to Phase 6 -- discovered incidentally): apps/api's root AppModule provides PrismaService directly in its own providers array without marking it @Global() and without a dedicated exporting PrismaModule. Per NestJS's module-scoping rules, a provider declared only in the root module is not automatically visible to descendant modules unless re-declared locally (as ToolsModule/TransportModule do) or imported from a module that exports it. Booting the real app for the first time in this project's QA history (Docker was unreachable in every prior sandbox) reproduced this: NestFactory.create(AppModule) throws UnknownDependenciesException resolving PrismaInviteRepository inside AdminUsersModule (and, by the same defect class, likely TenantsModule's PrismaTenantRepository and any other module whose repository injects PrismaService without a local re-declaration or a PrismaModule import) -- the real production app cannot start at all as currently wired. This is why every prior phase's controller/integration jest tests still pass: they instantiate modules via Test.createTestingModule({...}) with PrismaService supplied directly alongside the module under test, bypassing the real module tree's DI boundary -- the same "tests bypass real wiring" pattern flagged in Phase 4's original QA report. To finish this QA pass and drive the real UI (item 4/5b above), a diagnostic-only @Global() PrismaModule wrapper was added locally, used to complete the pass, then fully reverted (confirmed via git status/diff -- no repo file was left modified). This defect long predates Phase 6 (the module skeleton dates to Phase 1) and is unrelated to the Alibaba LiveAvatar adapter's own correctness; it does not gate this phase's verdict, but it is a severity: blocks-all-real-deployment finding that should be routed to nexus-dev as its own fix (add a @Global() PrismaModule exporting PrismaService, remove the per-module re-declarations, add a real NestFactory.create boot smoke test to CI) before any environment beyond unit/integration tests is attempted.

## Overall verdict

PASS-WITH-CAVEATS for Phase 6 / BL-019 (Alibaba LiveAvatar second avatar adapter). Every in-scope item (contract compliance, lifecycle wiring, error-code mapping, AI-boundary isolation, feature-gap copy end to end including a real rendered-UI pass, registry wiring, hop metrics, full regression) passed with independently-gathered evidence, no defects found in this phase's own code. The pre-existing, invented wire-protocol assumption remains an accepted, already-surfaced caveat per the orchestrator's prior decision, not counted against this verdict. One new, non-blocking-for-this-phase but high-severity cross-cutting finding (F-1, PrismaService DI-scoping bug blocking real app boot) was discovered incidentally and should be routed to nexus-dev separately, attributed to Phase 1's original module skeleton, not Phase 6.
