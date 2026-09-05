# QA Re-verification - Phase 4 apps/api /internal extensions, retry 1

Scope: re-verify D-1/D-1b fix (date-time/uri TypeBox format registration), the new
tool_definitions[] field on AgentRuntimeConfigDto (GetRuntimeConfigUseCase,
packages/contracts/src/internal/schemas.ts), a spot-check of InternalTokenGuard, full
regression (jest/ESLint/nest build), and the TS side of the cross-language contract
test. Prior report: qa-results/phase4-api-internal/REPORT.md.

Environment: same disclosed, unchanged carried-forward limitation as every prior pass -
Docker/Postgres/LiveKit unreachable in this sandbox. All verification below is against
the real compiled TypeScript/NestJS DI graph, real @nestjs/testing + supertest HTTP
requests (guard + TypeBoxValidationPipe + controller all genuinely wired, nothing
stubbed at that boundary), and direct Value.Check/Value.Errors calls against the real,
built @sinclair/typebox runtime output (packages/contracts/dist), not static reading.
Jest/ESLint/nest build/contracts tsc all run directly in this sandbox against the
actual repo.

## Overall verdict: PASS-WITH-CAVEATS

D-1/D-1b are genuinely fixed - independently reproduced with a fresh test file and
fresh payloads, then deleted (test hygiene, no residue left in the repo). Full
regression matches the dev claimed numbers exactly. One new, currently-latent
structural defect found while verifying the new tool_definitions[] field schema
coherence (D-4, below) - not blocking (nothing in the current codebase calls
Value.Check/Value.Decode against the schema it affects, same class of "will bite the
moment anything validates it" gap as the pre-existing D-1b note), but real and worth
fixing opportunistically.

## Traceability matrix (this retry scope only - see original report for the full
Phase 4 matrix, all of which still stands unless noted below)

| # | Check | Result | Evidence |
|---|---|---|---|
| R1 | date-time format now registered | PASS | packages/contracts/src/agent-config/formats.ts now sets FormatRegistry.Set for date-time with an RFC3339 pattern requiring an explicit Z/offset; confirmed via direct Value.Check against the built dist/internal/schemas.js |
| R2 | uri format now registered | PASS | Same file, FormatRegistry.Set for uri; confirmed via direct Value.Check |
| R3 | Dev own new HTTP-pipeline spec (agent-internal.controller.http.spec.ts) passes | PASS | Ran directly: 4/4 tests green |
| R4 | Independent fresh HTTP-pipeline probe (different payloads from the dev own test) | PASS | Wrote a temporary sibling spec (__qa_retry1.http.spec.ts, deleted after the run - no residue), 8 new cases, all green: (a) valid events with a +02:00-offset, microsecond-precision timestamp -> 204; (b) events with at as a JS number (wrong type) -> 400 INTERNAL_PAYLOAD_INVALID, use case not invoked; (c) events with an invalid type enum value -> 400; (d) multi-item utterances batch, mixed roles, one item omitting optional ended_at -> 204; (e) utterances batch with a malformed ended_at (space instead of T, no offset) -> 400, use case not invoked; (f) utterances with a negative seq (schema-level boundary) -> 400; (g) hops batch (route the original bug never touched) still 204, sanity check nothing regressed; (h) correct-length-but-wrong X-Internal-Token still 401, confirming the guard is unaffected by the schema/format change |
| R5 | Fix does not work by disabling validation | PASS | R4(b)/(c)/(e)/(f) above are all genuine rejections of genuinely-invalid payloads through the real pipe - the fix registers real accept/reject functions, not a bypass. Also directly reproduced: Value.Check on SessionEventRequestSchema/UtteranceBatchRequestSchema rejects a date with a space instead of T and a date with no timezone as false, accepts a valid fractional+offset timestamp as true |
| R6 | tool_definitions[] tenant scoping | PASS | GetRuntimeConfigUseCase.execute derives enabledApiRefs from the session own resolved structured.agent.tools, then calls toolDefinitions.listEnabledByApiRefs with session.tenantId and enabledApiRefs - session.tenantId always comes from the SessionRepositoryPort.findById row, never client input. PrismaToolDefinitionRepository.listEnabledByApiRefs issues a findMany filtered by tenantId, enabled true, apiRef in the given list - a tenant-B ToolDefinition row can never surface in tenant-A runtime-config response, confirmed both by reading the Prisma query and by the existing unit test asserting listEnabledByApiRefs is called with exactly t1 (the session tenant), never a request-supplied value (there is no request-supplied tenant id on this route at all) |
| R7 | tool_definitions[] shape matches what the Python agent consumes | PASS | Compared ToolDefinitionDtoSchema (TS) field-for-field against ToolDefinitionDto BaseModel in apps/agent/src/avatar_agent/contracts/runtime_config.py: api_ref/name/description/method/url/credential_ref/args_schema all present on both sides with matching optionality (description/credential_ref optional on both). Python AgentRuntimeConfig(AgentConfig) extends via subclassing (Pydantic inheritance), which is why it has no equivalent of the TS-side structural issue in D-4 below |
| R8 | No raw secret leaks via tool_definitions[] | PASS | Confirmed credential_ref is a reference string only (matches the pre-existing endpoints pattern) - read GetRuntimeConfigUseCase and ToolDefinitionDtoSchema; no secret-value field exists anywhere in the DTO |
| R9 | InternalTokenGuard spot-check | PASS, unaffected | Guard file unchanged since the original pass; re-confirmed 401 on wrong-token via R4(h) above over real HTTP; no interaction with the format/schema changes (guard runs before the body pipe) |
| R10 | Full regression: apps/api jest | PASS | npx jest --runInBand -> 99 suites / 576 tests, all green - exact match to dev claimed 576/576, up from 569 |
| R11 | ESLint (api + contracts) | PASS | pnpm --filter @liveavatar/api lint and pnpm --filter @liveavatar/contracts lint both exit clean, zero problems |
| R12 | nest build | PASS | prisma generate and npx nest build clean |
| R13 | packages/contracts build | PASS | tsc -p tsconfig.json clean |
| R14 | Cross-language contract test (TS side) unaffected by tool_definitions[] | PASS | agent-config-cross-language.contract.spec.ts still 11/11 green. Confirmed by grep that tool_definitions/ToolDefinitionDto do not appear anywhere under packages/contracts/src/agent-config/ - the new field lives only in internal/schemas.ts AgentRuntimeConfigDtoSchema, which the fixture-corpus contract test (scoped to AgentConfigSchema alone, per ADR-001 section 7) never touches. Matches the dev decision-log claim that the change is purely additive and does not touch the contract-tested schema |

## New defect found this retry

### D-4 (Low, currently latent - same disclosure class as the original D-1b) -
AgentRuntimeConfigDtoSchema T.Intersect of AgentConfigSchema and the extension object
can never Value.Check as true for any real, complete payload

File: packages/contracts/src/internal/schemas.ts (AgentRuntimeConfigDtoSchema =
T.Intersect of AgentConfigSchema and T.Object with session_id, room_name, endpoints,
tool_definitions).

Originating phase: Phase 4 original dev work (this T.Intersect construction predates
this retry - the retry only added tool_definitions as one more field inside the second
member of the existing intersect, and only touched formats.ts + internal/schemas.ts
import line for D-1/D-1b). Not introduced by this retry fix, but only discovered by
this retry independent probing of the new field schema coherence (task item 2).

Expected: A structurally-complete, spec-shaped AgentRuntimeConfigDto object (all of
AgentConfigSchema fields plus session_id/room_name/endpoints/tool_definitions) should
Value.Check as true against AgentRuntimeConfigDtoSchema, since that is precisely the
shape LLD section 6.3 defines for this response.

Actual: It always returns false. Reproduced directly against the built
dist/internal/schemas.js with a fully-populated, otherwise-valid object (every
AgentConfigSchema field present and correct, plus the four extension fields):
Value.Check returns false; Value.Errors reports Unexpected property errors on
session_id, room_name, endpoints, and tool_definitions paths. Root cause:
AgentConfigSchema is declared with additionalProperties:false (LLD section 6.1 own
canonical, closed schema), and TypeBox T.Intersect checks a value against each
constituent schema independently - so any value carrying the second schema own fields
is, by AgentConfigSchema own closed definition, extra/unexpected relative to that first
schema, and the whole intersect fails. Confirmed with a minimal, isolated repro outside
this codebase own schemas (T.Intersect of a closed T.Object with property a and a plain
T.Object with property b also fails to accept an object with both a and b, with the
identical Unexpected property error) - this is sinclair/typebox documented
Intersect-with-closed-object interaction, not a one-off typo in this file.

Why this has not blocked anything yet: matches the original report D-1b finding exactly
- grepped apps/api/src again this retry, confirmed (still) no code path calls
Value.Check/Value.Decode against AgentRuntimeConfigDtoSchema. AgentInternalController
runtimeConfig route and GetRuntimeConfigUseCase.execute both just construct and return a
plain object typed by TypeScript structural typing, never runtime-validated. The moment
anyone adds a response-validation interceptor, a round-trip test, or otherwise calls
Value.Check against this schema, every legitimate payload will be rejected - a stricter
version of the exact risk D-1b flagged, except this one cannot be fixed by registering a
format; it requires restructuring the schema itself (e.g. spread AgentConfigSchema
properties into a single flat T.Object instead of T.Intersect, or use T.Composite,
which TypeBox provides specifically to avoid this Intersect+closed-object interaction,
or drop additionalProperties:false from the intersected use only).

Severity: Low / currently non-blocking (nothing exercises it today, same justification
as the original D-1b), but genuinely reproducible and would silently resurrect the exact
D-1-shaped failure class (a schema that appears correct but always rejects real
payloads) the moment this schema is ever actually validated. Recommend fixing
opportunistically alongside any future work that touches this file, or at minimum
carrying it forward in the decision log with the same explicit disclosure D-1b
received, so it does not get independently rediscovered as a D-1 recurrence in a later
phase.

## Not defects - explicitly re-confirmed correct this retry

- D-1/D-1b (original): genuinely fixed. Both formats real, registered, and doing real
  accept/reject work - not a decorative no-op, not validation-disabling. Verified with
  payloads the dev own test never used (offset timestamps, wrong-type at value,
  malformed dates with different malformation shapes, negative integers).
- tool_definitions[]: correctly tenant-scoped end to end (session row -> tenant id ->
  Prisma query filter), no cross-tenant leak path exists, and the shape matches the
  Python ToolDefinitionDto Pydantic mirror field-for-field.
- InternalTokenGuard: unaffected, still sound.
- Cross-language contract test: unaffected by the additive tool_definitions[] change,
  confirmed by both running it and confirming (via grep) it is scoped to a schema the
  new field never touches.
- Full regression (jest/ESLint/nest build/contracts tsc): all green, matches the dev
  claimed numbers exactly (576/576, up from 569).

## Carried-forward environment limitation (unchanged, not gating this verdict)

Same as every prior pass in this project: Docker/Postgres/LiveKit unreachable in this
sandbox. All Prisma-backed writes were verified at the DI/HTTP-pipeline boundary with
the repository mocked at its port, plus direct code/query-shape review - not against a
live database.

## Summary

- D-1/D-1b: FIXED, independently re-verified with fresh test material through the real
  HTTP pipeline (guard + TypeBoxValidationPipe + controller genuinely wired), not just
  re-running the dev own test.
- New tool_definitions[] field: coherent and correctly tenant-scoped, wire shape
  matches the Python consumer.
- New defect found (D-4, Low, latent): AgentRuntimeConfigDtoSchema T.Intersect
  construction can never pass Value.Check for any real payload, due to
  AgentConfigSchema additionalProperties:false. Not currently exercised by any code
  path, so not blocking this phase functional closure, but flagged so it is not
  independently rediscovered later as a second D-1.
- Full regression (jest 576/576, ESLint clean, nest build clean, contracts tsc clean)
  independently reproduced, exact match to the dev claim.

Recommendation: This phase D-1/D-1b blocking defect is resolved - the two golden-path
routes (events, utterances) now genuinely accept valid agent traffic over real HTTP and
still correctly reject malformed traffic. The TS side of this dispatch can close. D-4 is
low-severity and latent; does not need to gate this phase, but should be logged so a
future phase does not rediscover it as a fresh blocking bug. Final verdict on the batch
as a whole (Python + frontend captions QA reports) is for the orchestrator to combine
with the other two parallel QA passes verdicts.
