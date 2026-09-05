# QA Retry 1 - Phase 3 Backend (BL-010 to BL-012)

Date: 2026-08-19
Scope: re-verification of D-1..D-5 from qa-results/phase3-backend/REPORT.md, plus full regression and a light regression sweep of transport/sessions/public. Frontend (conversation SPA) explicitly out of scope - covered by the parallel QA pass.

## Environment

- Docker/Postgres/LiveKit dev-mode still unreachable in this sandbox (docker version timed out, reconfirmed directly, same carried-forward gap as every prior phase).
- No live backend server started. Instead:
  - Ran the real, unmodified regression suite directly against source.
  - Built fresh, from-scratch harnesses (not reusing the dev's own mocks/tests), written/run/deleted: (1) a webhook probe instantiating the real, unmodified LiveKitClientAdapter class against the real livekit-server-sdk@2.17.0 (AccessToken/WebhookReceiver), not a mock, with both a garbage signature and a genuinely validly-signed webhook; (2) a sweeper probe wiring the real SweepAbandonedSessionsUseCase/ApplySessionEventUseCase classes against fresh fake in-memory ports, exercising a single sweep, a sequential re-run, and a genuinely concurrent double-run (Promise.all) of two sweep executions racing on the same session - not just the dev's own "applyStatus returns null" race simulation.
  - Read every touched source file directly rather than trusting the dev's decision-log description.

## D-1 (CRITICAL) - re-verification: FIXED, genuinely enforced against the real SDK

Read the full call chain: LiveKitClientAdapter.verifyWebhook (apps/api/src/modules/transport/infrastructure/livekit-client.adapter.ts lines 140-152) is now async and does an awaited call to this.webhookReceiver.receive(body, authHeader) inside a try/catch; LiveKitClientPort.verifyWebhook (transport/domain/ports.ts line 74) now types the return as Promise<LiveKitWebhookEvent | null>; InternalController.webhook() (internal/interface/internal.controller.ts line 37) does an awaited call to this.liveKit.verifyWebhook(...). All three call sites are consistently async/await, no gaps.

Live-proved against the real SDK, not the dev's own (now-corrected) mock, using two independent probes:

1. Raw-crypto probe - built a garbage-signature case and a genuinely valid one (real WebhookReceiver/AccessToken from the installed livekit-server-sdk@2.17.0, with a real sha256 claim over the raw body): invalid signature resulted in a caught rejection with reason "Invalid Compact JWS" (no unhandled rejection observed with a process.on('unhandledRejection', ...) listener attached); valid signature produced a genuine decoded WebhookEvent object with room.name equal to acme_s1, not a pending Promise.
2. Real-class probe - instantiated the actual, unmodified LiveKitClientAdapter class (via tsx, real env vars, real SDK) and called adapter.verifyWebhook(...) directly:
   - Invalid signature: logged "LiveKit webhook signature verification failed" via the adapter's own logger.warn, method returned null. The unhandledRejection listener never fired.
   - Valid signature: method returned a real, fully-decoded WebhookEvent (event: room_finished, room.name: acme_s1) - i.e. exactly the shape InternalController.webhook() needs to resolve roomName and call applyEvent.execute(session, 'ended').

This is the same class of exercise the original QA pass used to catch the bug (real SDK, not a mock), and it now produces the correct outcome on both branches. The unit test's mock shape is also confirmed corrected: livekit-client.adapter.spec.ts now uses receive.mockResolvedValue(...)/receive.mockRejectedValue(...) (was mockReturnValue), matching the SDK's real async signature, plus a new named regression-guard test ("verifyWebhook awaits receive() so a rejection cannot escape as an unhandled rejection").

Defense in depth also confirmed present: main-internal.ts now wires nestjs-pino's Logger via app.useLogger(app.get(Logger)) (previously absent) and installs a process-level process.on('unhandledRejection', ...) handler that logs and survives rather than crashing.

Verdict: D-1 is genuinely fixed. The webhook signature check is now unambiguously enforced end-to-end against the real SDK - a forged/garbage signature is rejected before any DB write (no session lookup, no applyEvent.execute call is reached, confirmed by reading InternalController.webhook()'s early-return-on-null guard, which now actually fires because event is a real resolved value, not an always-truthy pending Promise), and a validly-signed webhook decodes correctly and reaches the Session.status write path. No unhandled rejection is produced by either case.

## D-2 (Medium) - re-verification: FIXED, with one overstated sub-claim (Low)

SweepAbandonedSessionsUseCase.execute() (sessions/application/sweep-abandoned-sessions.use-case.ts) now runs both halves: sweepAbandonedPending() (unchanged) and a new sweepExpiredActive(), backed by the new SessionRepositoryPort.listActiveJoined() (active status plus joinedAt IS NOT NULL), implemented in PrismaSessionRepository.listActiveJoined().

Live-proved with a fresh fake-port harness (real use-case classes, not the dev's mocks):

- Golden path: a session active since 3 minutes ago with maxDurationSeconds of 60 is correctly transitioned to ended on a single sweep run, and liveKit.deleteRoom('acme_s1') is called exactly once.
- Sequential re-run: running the sweep again immediately afterward is a genuine no-op (0 sessions swept, 0 additional deleteRoom calls) - the DB re-query (listActiveJoined() only returns rows still status active) is what prevents a second sweep pass from re-processing an already-ended session.
- Genuine concurrency (this dispatch's specific ask): ran two sweep.execute() calls truly concurrently (Promise.all) against a single still-active, past-max_duration session. Result: deleteRoom was called twice for the same room (both executions independently read the session as active via their own listActiveJoined() call before either wrote the ended status, so both computed wasAlreadyEnded as false and both passed the guard). This does not throw or produce an unhandled rejection - LiveKitClientAdapter.deleteRoom() was already designed, pre-existing this fix pass, to swallow all errors as best-effort/idempotent (try/catch that only logs a warning), so a second delete call against an already-deleted room is absorbed silently, not thrown. But the decision log's specific claim - "a race guard against double room-deletion" - is not accurate as an in-process concurrency guard; the code's wasAlreadyEnded check only protects against re-processing on a sequential re-run (via the DB re-query), not against two genuinely overlapping executions. The dev's own unit test for this ("does not delete the room when applyStatus lost a concurrent race") only simulates applyEvent.execute returning an unchanged record via a mock, which is a different, narrower scenario than the actual overlapping-fetch race demonstrated here.

Verdict: D-2's core requirement (LLD section 8.8's active-past-max_duration-to-ended half) is genuinely implemented and correct. The "race guard" sub-claim is overstated - true concurrent double-processing is not prevented at the application layer, only masked by deleteRoom's pre-existing idempotent design. Not blocking (no throw/crash, no incorrect Session.status results - both racing executions still end with the same correct final ended status), downgraded here to a Low-severity documentation/robustness nit, not a functional regression.

## D-3 (Medium) - re-verification: FIXED

common/logging/pino-redact-paths.ts now exports a shared PINO_REDACT_PATHS array, imported by both app.module.ts (public, unchanged) and the new internal-app.module.ts, which now imports LoggerModule.forRoot with redact set to PINO_REDACT_PATHS - previously entirely absent. main-internal.ts now calls app.useLogger(app.get(Logger)), matching the public app's bootstrap pattern.

Live-proved the redaction is real, not just present as config: ran a real pino logger instance configured with the exact same PINO_REDACT_PATHS array and logged an object shaped like the pino-http request/response fields this app actually redacts (req.headers.authorization, res.body.token) - both values were replaced with the literal string Redacted in the emitted JSON log line, confirmed byte-for-byte in the captured stdout.

One residual, pre-existing (not new, not scoped to D-3) observation: the redact list only covers named field paths (req.headers.authorization, res.body.token, etc.), not arbitrary text embedded inside a logged Error object's message/stack (confirmed with the same probe: an Error whose message string itself contained a fake apiKey/apiSecret pair passed through unredacted). This is identical behavior on the public app today too (not a regression introduced by this fix pass) and no current LiveKitClientAdapter call site constructs an error message containing the raw secret value, so it is not a demonstrated leak - noting it as a carried-forward, out-of-scope observation rather than a new defect.

Verdict: D-3 is genuinely fixed. The internal app now has the same redaction wiring as the public app, live-proven to mask the same named fields (Authorization header, response token) it protects on port 8080.

## D-4/D-5 (Low) - re-verification: FIXED

Read EndSessionUseCase.execute() (sessions/application/end-session.use-case.ts): it now verifies the presented token's identity claim (claims.identity not equal to userIdentity(sessionId)) before any DB lookup, throwing AppError.unauthorized('AUTH_UNAUTHORIZED') on mismatch; the subsequent session lookup collapses both "session id does not exist" (session is null) and "room mismatch" (claims.roomName not equal to session.roomName) to the exact same AppError.unauthorized('AUTH_UNAUTHORIZED') call - identical error code, and (confirmed by reading AppError.unauthorized's single call signature/status mapping) identical HTTP status and response body shape for both. A caller can no longer distinguish "no such session id" from "wrong token for a real session" by response shape alone.

PublicController.end()'s body-validation pipe now uses a dedicated AUTH_TOKEN_REQUIRED code (TypeBoxValidationPipe with PublicSessionEndRequestSchema and AUTH_TOKEN_REQUIRED), distinct from AUTH_UNAUTHORIZED, so a malformed/missing-token request body is no longer miscoded as a real auth failure.

Verdict: D-4 and D-5 are both genuinely fixed.

## Full regression - independently re-run

| Check | Claimed | Independently confirmed |
|---|---|---|
| jest --runInBand | 86/86 suites, 510/510 tests | Confirmed exactly: 86 suites, 510 tests, all green |
| jest --coverage | 98.14%/94.08% | Confirmed: 98.19%/94.08% line/branch (statements/branches/functions/lines: 98.19/94.08/94.01/98.49) - consistent with claim, no regression |
| ESLint (pnpm run lint inside apps/api, the project's actual lint script) | clean | Confirmed: exit 0, zero output |
| prisma generate and nest build | clean | Confirmed: both commands complete with no errors |

(Note: running eslint directly at the apps/api root, outside the project's own lint script, surfaces 2 unrelated no-undef errors on jest.config.cjs and test/jest-e2e.config.cjs - CommonJS config files not covered by the project's own lint script and its env config. Not a real defect; the actual lint command this project defines and the dev ran is clean.)

## Spot-check: no other regressions in transport/sessions/public

- public.controller.ts unchanged in shape (POST /public/sessions, POST /public/sessions/:id/end) beyond the AUTH_TOKEN_REQUIRED pipe-code change already covered under D-5.
- SessionRepositoryPort/PrismaSessionRepository additions (listActiveJoined) are additive only - every other method (create, findById, findByRoomName, findPendingByTabKey, applyStatus, setSummaryToken, listAbandonable) is unchanged from the prior pass's reviewed shape, still uses withBypass with an explicit tenantId on every write.
- ApplySessionEventUseCase (single writer of Session.status) is unchanged - still the sole write path for both the webhook and end-call fast path, still a no-op on an illegal transition.
- No new AI/vendor-SDK imports; livekit-server-sdk still only imported in livekit-client.adapter.ts (grep re-confirmed).

## Traceability matrix (this retry's scope)

| Requirement / defect | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| D-1: webhook signature verified before DB write, valid webhook processed | Real-SDK garbage-signature and real valid-signature probe against the actual LiveKitClientAdapter class; read InternalController.webhook()'s guard | PASS | See D-1 section above |
| D-1: no unhandled rejection on forged/malformed webhook | Same probes, unhandledRejection listener attached | PASS | Zero unhandled rejections observed in either probe |
| D-2: active-past-max_duration to ended, room deleted | Fresh fake-port harness, single sweep run | PASS | Session transitioned active to ended, deleteRoom called once |
| D-2: sequential re-run is a no-op | Same harness, immediate second execute() call | PASS | 0 additional sweeps, 0 additional deleteRoom calls |
| D-2: concurrent double-run doesn't throw/crash | Same harness, genuinely concurrent Promise.all of two execute() calls | PASS (no throw), with a caveat | deleteRoom called twice (not prevented), but neither call threw or produced an unhandled rejection - absorbed by deleteRoom's pre-existing idempotent design. Race guard claim overstated - see D-2 section |
| D-3: internal app secrets genuinely redacted in log output | Real pino instance with the actual shared redact-paths array, logged req/res-shaped test data | PASS | Both fields replaced with the literal string Redacted in captured output |
| D-4: nonexistent session id and mismatched-token both resolve to identical AUTH_UNAUTHORIZED | Code read of EndSessionUseCase.execute(), confirmed single shared throw call for both branches | PASS | Byte-identical AppError.unauthorized('AUTH_UNAUTHORIZED') call site for both |
| D-5: end-session body validation failure resolves to dedicated AUTH_TOKEN_REQUIRED, not AUTH_UNAUTHORIZED | Code read of PublicController.end()'s validation pipe | PASS | TypeBoxValidationPipe with PublicSessionEndRequestSchema and AUTH_TOKEN_REQUIRED |
| Regression: full suite / coverage / lint / build | Independently re-run, not re-reading dev's own numbers | PASS | See regression table above |
| Regression: transport/sessions/public module shape | Spot-read of unchanged call sites | PASS | See spot-check section above |

## New/residual findings this retry

- New-Low (non-blocking): D-2's "race guard against double room-deletion" does not hold under genuine concurrent overlap. Two truly concurrent sweep executions on the same session both call deleteRoom for the same room (proven above). This does not throw, crash, or corrupt Session.status (both executions still converge on the correct final ended state) - it is masked entirely by LiveKitClientAdapter.deleteRoom()'s pre-existing best-effort/swallow-all-errors design, not by anything new this fix pass added. Recommend either correcting the code comment/decision-log claim to describe the actual guarantee (idempotent-by-virtue-of-deleteRoom, not a true mutex/CAS), or - if a stronger guarantee is desired for a future phase where deleteRoom might stop being silently idempotent - adding an actual compare-and-swap (an UPDATE with a WHERE status equals active clause and a check on affected-row-count) at the repository layer. Not blocking this phase.
- Residual, out-of-scope, not new: Pino redaction only covers named field paths, not secrets that might appear embedded inside an Error.message/stack string. No current call site demonstrates this as an actual leak; carried forward as an observation, not a defect requiring action this phase.

## Overall verdict: PASS-WITH-CAVEATS

All five prior defects (D-1 through D-5) are genuinely fixed and independently re-verified against real code paths and, for D-1, the real unmocked livekit-server-sdk:

- D-1 (the headline defect): FIXED and unambiguous. The LiveKit webhook signature check is now genuinely enforced end-to-end - proven against the real SDK class exactly as the original defect was caught, not against the dev's own (now-corrected) unit-test mock. A forged/garbage signature is rejected before any DB write and produces no unhandled rejection; a validly-signed webhook is correctly decoded and reaches the Session.status write path via InternalController.webhook() then ApplySessionEventUseCase.
- D-2: FIXED (the required LLD section 8.8 behavior is correct), with the race guard sub-claim overstated (Low, non-blocking, documented above).
- D-3: FIXED, live-proven with a real redacting pino instance.
- D-4/D-5: FIXED, confirmed by code read of the exact shared throw/pipe-code call sites.

Full regression is clean and matches the dev's claimed numbers exactly (86/86 suites, 510/510 tests, approximately 98.19%/94.08% coverage, ESLint clean, prisma generate and nest build clean). No new blocking defects found. The single new observation (D-2's race-guard wording/robustness) is Low severity and does not gate this phase - recommend it be corrected or accepted as-is at the orchestrator's discretion, batchable with any future pass rather than requiring an immediate retry.

Recommendation: Phase 3 backend (BL-010-BL-012) can close from the backend side. This verdict is independent of the parallel conversation-SPA QA pass, whose own sign-off the orchestrator should confirm separately before closing the phase as a whole.
