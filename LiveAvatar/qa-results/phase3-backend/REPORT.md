# QA Report - Phase 3 Backend (BL-010 to BL-012)

Date: 2026-08-19
Scope: apps/api/src/modules/transport, sessions, public, internal, jobs; internal-app.module.ts / main-internal.ts; additive Prisma Session.tabKey.
Frontend (Angular conversation SPA) explicitly out of scope - covered by the parallel QA pass.

## Environment

- Docker/Postgres/LiveKit dev-mode unreachable in this sandbox (docker version timed out after 20s) - same environment gap as every prior phase in this project, reconfirmed directly, not taken on faith.
- No live backend server was started (no reachable Postgres). Instead:
  - Ran the real, unmodified regression suite directly against source.
  - Built a from-scratch integration harness (apps/api/qa-probe.ts, written, run, then deleted - not reusing the devs own mocks/tests) wiring the real IssueConversationTokenUseCase, EndSessionUseCase, ApplySessionEventUseCase classes against fresh fake in-memory ports.
  - Exercised the real livekit-server-sdk v2.17.0 crypto primitives (AccessToken, TokenVerifier, WebhookReceiver) directly and via a byte-for-byte replication of LiveKitClientAdapter.verifyWebhooks actual call shape, to get a live, non-mocked verdict on the webhook-signature claim (see D-1, the headline finding).
  - Could not do a true end-to-end round-trip against a running LiveKit server (Docker unreachable) - same disclosed gap the dev log carries forward from Phase 1. Given D-1 below, this gap is now more consequential than previously assessed (see Caveats).

## Regression / QC results

| Check | Claimed | Independently confirmed |
|---|---|---|
| jest --runInBand | 85/85 suites, 500/500 tests | Confirmed exactly: 85 suites, 500 tests, all passing |
| jest --coverage | 98.16%/94.01% | Per-file coverage numbers consistent with claim (livekit-client.adapter.ts 100%/94.44%, issue-conversation-token.use-case.ts 98.18%/91.17%); full aggregate line truncated by tooling but no evidence contradicting the claim, and 85/85 suites still green |
| ESLint | clean | Confirmed: eslint on src and test exits clean, zero output |
| prisma generate && nest build | clean | Confirmed: both commands complete with no errors |
| AI/vendor-SDK boundary | only LiveKitClientAdapter imports livekit-server-sdk | Confirmed by grep of all apps/api/src - the only other two hits are a comment in ports.ts and the ESLint zone config itself. No AI vendor SDK (OpenAI/Anthropic/LangChain) imported anywhere in apps/api |
| ESLint zone enforcement | import/no-restricted-paths blocks livekit-server-sdk outside transport/infrastructure | Live-probed: added a deliberate violation (sessions/probe-zone-violation.ts importing RoomServiceClient), confirmed it fires, then removed it - tree confirmed clean |
| ADR-001 data-locality decision | must be explicit | Confirmed: ADR-001 section 6 states it explicitly (residency modes, snapshot-at-start, build_payload enforcement, residual-risk disclosure for remote TTS/avatar) |

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-AUTH-4 (token issuance only via POST /public/sessions) | Golden path mint; grep for any other token-minting route/controller | PASS | public.controller.ts is the only caller of IssueConversationTokenUseCase; harness run below |
| FR-AUTH-4 (paused tenant rejected) | execute against a paused tenant slug | PASS | Harness: paused tenant rejected -> TENANT_PAUSED (403) |
| FR-AUTH-4 (token TTL <= 2h, room-scoped) | Inspected tokenTtlSeconds/DEFAULT_MAX_DURATION_SECONDS; harness measured expires_at | PASS | Math.min(7200, maxDurationSeconds); harness measured expires_at approx now+7200s; grant sets roomJoin/room (not global) |
| FR-AUTH-4 (tab-key idempotency) | Two POST /public/sessions calls, same tab_key, before join | PASS | Harness: previous session flips to abandoned, its room is deleted, exactly one pending session remains for that tab-key |
| EndSessionUseCase identity/room-match claim | Presented a token minted for a different session/room against the target sessions end-call | PASS | Harness: mismatched-token end-session rejected -> AUTH_UNAUTHORIZED (401); correct token accepted and ends the session; duplicate end-call idempotent (status ended, no second summary token) |
| ApplySessionEventUseCase illegal-transition no-op | Drove ended to active directly | PASS | Harness: status stays ended, function returns the unchanged record, no error thrown - confirmed genuinely a no-op |
| Secrets never logged (public app :8080) | Read PINO_REDACT_PATHS in app.module.ts; traced logger call sites in transport/sessions | PASS with a real gap next to it | Redaction list covers req.headers.authorization, res.body.token, etc. No call site logs the raw LiveKit API key/secret directly. See D-3 for the internal-app gap |
| Secrets never in response body | Read PublicSessionResponseSchema, PreflightResponse, PublicSessionEndResponseSchema | PASS | Only the users own room-scoped token is ever returned to the browser (by design, FR-AUTH-4); agent token never leaves the cluster |
| Webhook HMAC verification before DB write, valid webhook processed correctly | Constructed a genuinely valid, correctly-signed LiveKit webhook (real AccessToken-signed sha256 claim) and an invalid one, replicated LiveKitClientAdapter.verifyWebhooks exact (unawaited) call shape | FAIL - BLOCKING | See D-1 below. Neither valid nor invalid webhooks are ever processed; this is not verify-then-drop-on-failure, it drops everything, and can crash the internal process on malformed input |
| prisma.withBypass scoping on public/internal id-only lookups | Read every withBypass call site in prisma-session.repository.ts and residency reader | PASS, with one low-severity note | Every mutating call still carries an explicit tenantId from the resolved tenant, never from a client-supplied value; id-only reads are inherently unscoped by design (UUID session ids, unguessable) and the only consumer of findById result data (EndSessionUseCase) gates on LiveKit-token verification before it can act - no cross-tenant data is returned. See D-4 for a minor enumeration nit |
| FR-TRANSPORT-1..4 session lifecycle | Read session-status.ts transition table against LLD section 8.1/FR-TRANSPORT-4; webhook participant_joined/room_finished wiring | PASS on the transition table itself; FAIL on webhook wiring (D-1); gap on max_duration sweep (D-2) | Transition table itself is correct and exhaustive; but the webhook safety net that is supposed to drive active/ended via LiveKit events is inert (D-1), and LLD section 8.8's active-past-max_duration-to-ended sweep half is simply not implemented (D-2) |
| ADR-001 media/WebRTC boundary (control plane never touches media) | Grepped apps/api for any WebRTC/SFU logic beyond token/room/dispatch calls | PASS | TransportModule/LiveKitClientAdapter only calls RoomServiceClient/AgentDispatchClient/AccessToken/TokenVerifier/WebhookReceiver - no media frames touched, matching FR-TRANSPORT-3 |
| NFR-6 browser support | Out of scope (frontend) - not tested here | Untested (by design) | Parallel frontend QA pass covers this |

## Defects

### D-1 - CRITICAL / BLOCKING: LiveKit webhook is never actually processed; can crash the internal process (transport module, LiveKitClientAdapter.verifyWebhook)

What was claimed: the LiveKit webhook is signature-verified before any DB write and silently drops on failure, and the dispatch asked to confirm a validly-signed webhook is processed correctly.

What actually happens: LiveKitClientAdapter.verifyWebhook is a plain, non-async method that calls this.webhookReceiver.receive(body, authHeader) and returns the result directly, wrapped in a try/catch. WebhookReceiver.receive() in livekit-server-sdk@2.17.0 is declared async and returns Promise<WebhookEvent> (confirmed by reading the SDK source at node_modules/.pnpm/livekit-server-sdk@2.17.0/.../WebhookReceiver.ts lines 60-65). The adapter method never awaits the call. Consequences, all independently reproduced with real SDK calls, not mocks:

1. The returned value is always a pending Promise object, which is always truthy, so InternalController.webhook()'s if (!event) return guard never fires, valid or invalid signature alike.
2. Reading event.room?.name off a Promise object is always undefined, so roomName is always undefined and the handler always falls through to its own if (!roomName) return early-return.
3. Net effect: no webhook of any kind, valid or forged, ever updates Session.status. The participant_joined-to-active and room_finished-to-ended transitions LLD section 8.3 calls the authoritative safety net never happen via this path. This is a functional break of FR-TRANSPORT-4's webhook-driven lifecycle, not a fail-safe outcome.
4. Because the rejected promise from an invalid or forged signature is never awaited or caught, it becomes an unhandled promise rejection in the internal Node process. Reproduced directly: a process-level unhandledRejection handler caught the real rejection reason, Invalid Compact JWS. Modern Node 15-plus terminates a process on an unhandled rejection unless a global handler is installed (none exists in main-internal.ts or internal-app.module.ts), meaning a single malformed or forged POST to /internal/livekit/webhooks can crash the internal :8081 application, which is meant to be a durable, cluster-reachable listener that will also host agent-facing routes from Phase 4 onward. This is a live availability/DoS concern, not just a correctness bug.

Why the dev's own tests didn't catch it: livekit-client.adapter.spec.ts's verifyWebhook tests mock receive as synchronous (mockReturnValue, or a synchronous throw), which does not match the real SDK's async signature. The mock shape hid the bug; every other SDK method the spec mocks (verify, createDispatch, etc.) is correctly mocked as mockResolvedValue/mockRejectedValue, making receive's synchronous mock an isolated, easy-to-miss inconsistency.

Repro (harness, not reusing dev's mocks): a script replicating LiveKitClientAdapter.verifyWebhook exactly was called with (a) a body plus a garbage signature, and (b) a body plus a genuinely valid AccessToken-signed sha256 header built independently with the same devkey/devsecret pair docker-compose.dev.yml uses. Both cases produced the identical broken outcome: typeof result is object, an unresolved Promise, truthy, and result.room is undefined. Awaiting WebhookReceiver.receive() directly, the correct fix, on the same valid header correctly decodes the real event with room.name equal to the expected room.

Fix required: mark verifyWebhook async and return the awaited result of this.webhookReceiver.receive(body, authHeader), so the existing try/catch can actually catch the rejection; update LiveKitClientPort.verifyWebhook's signature to return a Promise; update InternalController.webhook() to await it (already async, just needs the await added); fix the unit test's mock shape to mockResolvedValue/mockRejectedValue so this class of bug cannot recur silently.

Originating phase: Phase 3 development (transport module - LiveKitClientAdapter).
Severity: Blocks FR-TRANSPORT-4 and the webhook half of LLD section 8.3 entirely; also a process-crash/availability risk. This is the single defect that should gate this phase.

### D-2 - Medium: session-sweeper only implements half of LLD section 8.8's spec (sessions/jobs modules)

LLD section 8.8 defines the session-sweeper job as: pending older than 15 min becomes abandoned plus room deleted; active past max_duration becomes ended. SweepAbandonedSessionsUseCase (and its only caller, listAbandonable) implements only the first half - it queries status pending with startedAt older than the cutoff and abandons those. There is no code path anywhere (SessionRepositoryPort has no method for it, SweepAbandonedSessionsUseCase does not call one) that finds active sessions past their maxDurationSeconds and force-ends them. Combined with D-1 (the webhook safety net that would otherwise catch some of these via room_finished also being inert), a session whose browser never calls /public/sessions/{id}/end and whose LiveKit room somehow never fires room_finished (or does, but the webhook cannot process it) has no server-side mechanism at all to reach a terminal state at max_duration. This is a real gap against LLD section 8.8, not a hypothetical.

Originating phase: Phase 3 development (sessions/jobs modules).
Severity: Medium (rough edge that compounds with D-1's severity - not independently blocking, but should be fixed in the same pass).

### D-3 - Medium: internal app (:8081) has zero logging/redaction wiring - the never-logged security claim does not hold there

The public app (main.ts/app.module.ts) wires nestjs-pino's LoggerModule with a redaction denylist and bridges it via app.useLogger(app.get(Logger)). The internal app (main-internal.ts/internal-app.module.ts), the process that hosts the exact route (InternalController.webhook) and adapter (LiveKitClientAdapter, instantiated in a separate DI container for this second Nest application) whose error paths are most likely to see raw LiveKit SDK error payloads, imports neither nestjs-pino's LoggerModule nor calls app.useLogger(...). Confirmed by grep: zero references to Logger/Pino in either file. This means every logger.warn/error call inside the internal app's instance of LiveKitClientAdapter goes through Nest's plain built-in ConsoleLogger, completely bypassing the PINO_REDACT_PATHS denylist, because that denylist is never wired into this process at all, not because redaction correctly decided nothing needed masking. Today no call site logs the raw API key/secret directly as a top-level field, so there is no currently demonstrated leak, but the claim that the LiveKit API key/secret was added to the Pino redaction denylist and never logged is only true for the public app; the internal app has no redaction mechanism whatsoever, so any future log call there (including ones Phase 4+ adds to the same module) inherits zero protection by default.

Originating phase: Phase 3 development (internal-app.module.ts/main-internal.ts bootstrap).
Severity: Medium (latent, not currently exploited, but a real gap in a security control the dev's own review claimed was in place platform-wide).

### D-4 - Low: session-id 404-vs-401 split is a minor enumeration signal (sessions module)

EndSessionUseCase.execute looks up the session by id first (404 SESSION_NOT_FOUND if absent) before verifying the presented token (401 AUTH_UNAUTHORIZED if identity/room mismatch). Since session_ids are random UUIDs, effectively unguessable, this is very low practical risk, but it does let a caller distinguish an existing UUID from a non-existent one without presenting a valid token for it, which is a minor information-disclosure nit (cross-tenant existence, not cross-tenant data). Not blocking; batchable with the next pass.

Originating phase: Phase 3 development (sessions module).
Severity: Low.

### D-5 - Low: PublicSessionEndRequestSchema validation failure surfaces as AUTH_UNAUTHORIZED (public module)

PublicController.end() wires the TypeBoxValidationPipe for the end-session body with AUTH_UNAUTHORIZED as the default validation-failure code. A body missing token entirely, a schema/shape problem, therefore returns the same error code as a real auth failure (bad/mismatched token), rather than a validation-specific code. Functionally harmless (both are rejections), just semantically confusing for a client trying to distinguish a malformed request from a wrong token. Not blocking.

Originating phase: Phase 3 development (public module).
Severity: Low.

## Not independently verified (disclosed gap, not a code defect)

- Live LiveKit server round-trip. Docker was unreachable in this sandbox (reconfirmed with a direct docker version call that timed out after 20s), so RoomServiceClient.createRoom/deleteRoom, AgentDispatchClient.createDispatch, and checkReachable's real HTTP calls were not exercised against a live server, only their token-mint/verify/webhook-signature counterparts (which are pure local crypto, no network) were. This is the same carried-forward gap the dev log discloses. Given D-1 was found by exercising the SDK directly rather than trusting the mocked unit tests, this gap is now materially more important to close before production sign-off than it was in Phase 1/2 - a live-server pass would very plausibly have caught D-1 itself (the webhook path is the one piece of this module the mock-based tests could not validate).
- Full aggregate coverage percentage line for the backend jest --coverage run was truncated by the terminal capture tool; per-file figures for every file touched this phase are consistent with the claimed 98.16%/94.01%, and the safer signal (85/85 suites, 500/500 tests, all green) was captured in full from a separate run.

## Overall verdict: FAIL

D-1 is a blocking defect that directly contradicts the two explicitly-named verify-immediately webhook claims in this dispatch (signature verified before DB write; valid webhook processed correctly) - in reality, no webhook of either kind is processed, and a forged one can crash the internal listener process. This must go back to nexus-dev before Phase 3 can close. Recommend a narrowly-scoped retry covering:

1. D-1 (blocking) - fix the missing await in LiveKitClientAdapter.verifyWebhook, correct the port's return type to a Promise, fix InternalController.webhook()'s call site, and fix the unit test's mock shape so this class of bug cannot recur silently.
2. D-2 (Medium) - implement LLD section 8.8's active-past-max_duration-to-ended sweep half.
3. D-3 (Medium) - wire nestjs-pino/redaction, or an equivalent deliberately-scoped logging setup, into the internal app so the secrets-never-logged claim actually holds platform-wide, not just on :8080.
4. D-4/D-5 (Low) - can batch with the next pass, not urgent.

Everything else in scope - token TTL/room-scoping, paused-tenant rejection, tab-key idempotency, ApplySessionEventUseCase's illegal-transition no-op, prisma.withBypass tenant-scoping reasoning, the AI/vendor-SDK boundary, ADR-001's media boundary and data-locality decision, and the full regression suite (85/85 suites, 500/500 tests, ESLint, build) - is genuinely correct and independently re-verified with fresh harnesses, not just re-reading the dev's own tests.
