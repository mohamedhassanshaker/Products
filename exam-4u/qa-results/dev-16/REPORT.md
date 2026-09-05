# QA Report - Dev-16 (BL-13: PDF upload, exact-hash dedup, content classification)

**Date:** 2026-08-10
**Scope:** Dev-16 only (FR-PDF-1, FR-PDF-2 hash-only tier, FR-PDF-3). Dev-17a explicitly excluded
per orchestrator instruction (implemented but not yet QA-gated - left untouched).

## Environment
- apps/api NestJS service, real MySQL 8.4 (examland-mysql container) and real Qdrant
  (examland-qdrant container, already running, not started/stopped by this pass).
- No dev HTTP server was left running; all tests drive the app in-process via supertest
  (real HTTP over a Nest test application instance) or real Jest unit specs.
- Node test runner requires NODE_OPTIONS=--experimental-vm-modules (per
  apps/api/package.json's test/test:cov/test:e2e scripts) - this is load-bearing; running
  Jest directly without it produces a large, reproducible set of failures unrelated to any service
  defect (see Finding 0 below - informational, not a Dev-16 defect).

## 1. Independent verification of the "flaky test" diagnosis -- VERDICT: DIAGNOSIS HOLDS

Ran pdf-processing.service.spec.ts in isolation 3x and as part of the full unit suite
(default-parallel, backgrounded):

- Isolation (--runInBand, correct NODE_OPTIONS flag): 18/18 green, 3/3 consecutive runs, ~5.2s each.
- Full unit suite (npm test, default Jest parallelism): 140 suites / 1173 tests, 100% green,
  197.8s -- includes this file passing explicitly (PASS line observed in the log), consistent with
  running under load and with the waitUntil polling helper working correctly under contention.
- Read waitUntil()'s implementation (pdf-processing.service.spec.ts lines 87-118): it polls
  the actual asserted condition (call-count / status / errorCode) via real setTimeout macrotask
  ticks up to a 5s budget, rather than guessing a fixed flushSetImmediate() count. This is a
  structurally sound fix for the described race (a fixed flush-count assertion racing against
  genuine, unmocked pdf-parse/pdfjs-dist async parsing) -- confirmed by direct code review, not
  just by re-running the tests.
- The dedup tests that never reach extract() were correctly left on flushSetImmediate() (no
  race exists there -- confirmed by reading tryDedup()'s short-circuit path in
  pdf-processing.service.ts, which never calls extractPdfPages).

**Conclusion: the "test-synchronization bug, not a service defect" diagnosis is correct.** No
evidence of a masked implementation defect. The fix is real and the suite genuinely no longer
races.

### Finding 0 (informational, non-blocking, not a Dev-16 defect)
Running any test file directly via `npx jest <file>` without the project's required
NODE_OPTIONS=--experimental-vm-modules flag (easy to do by accident) produces 7 failures in this
exact file -- a red herring that superficially resembles the very "7 failing tests" this phase's
own investigation addressed, but is actually an unrelated environment-configuration mistake
(pdf.js's internal dynamic import() throwing ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG inside
Jest's vm sandbox). Confirmed by re-running with the correct npm test/npm run test:e2e scripts,
which pass cleanly. Not a code defect; flagging only so a future QA/dev pass doesn't misdiagnose
this the same way.

## 2. Exit gate: 202-before-AI-work

- Unit (202-before-AI-work exit gate, FR-PDF-1): asserts classifyContent has NOT been called and
  returns null for classifyCalledAt at the moment uploadPdf() resolves, then polls until it is
  eventually called. Pass.
- E2E (test/pdf-processing.e2e-spec.ts, real HTTP/MySQL): classification mock delayed 1500ms;
  POST /pdf-processing/upload returns 202 in well under 750ms (asserted via elapsedMs).
  Re-ran independently: pass.
- Code review of uploadPdf() confirms no await exists between the session-row insert and the
  return other than the storage put() -- scheduleProcessing() uses an un-awaited setImmediate
  callback, making this a structural property, not a timing coincidence.

**Verdict: genuinely holds.**

## 3. Exit gate: exact-hash dedup cost control

- Unit: findLatestCompletedByHash mocked to return a match; classifyContent mock call count
  asserted not.toHaveBeenCalled(); reusedFromSessionId asserted on the saved session. Pass.
- E2E (real cost-control proof): uploads the same file twice (identical pdfkit-built buffer),
  simulates the first session reaching Completed via a direct DB update (documented in the test as
  the closest honest simulation given downstream Completed-producing phases are out of scope),
  then re-uploads and asserts classifyContentMock call count is still 1 after the second upload,
  and reusedFromSessionId correctly points at the first session. Independently re-ran: pass.

**Verdict: genuinely holds -- classifyContent is never called on the duplicate upload, and
reused_from_cache/reusedFromSessionId metadata is correctly recorded.**

## 4. UNRECOGNIZED_CONTENT_TYPE

Unit and E2E both mock the engine returning contentType: 'worksheet' (outside
{lesson,exam,reference}). Confirmed: session ends Failed, errorCode ===
'UNRECOGNIZED_CONTENT_TYPE', errorMessage contains the literal string 'worksheet' -- the exact
unrecognized label, not a generic error and not silently coerced. Code review confirms the
RECOGNIZED_CONTENT_TYPES lookup table only recognizes exactly lesson/exam/reference
(case/whitespace-normalized) and throws UnrecognizedContentTypeError(rawLabel) naming the raw,
undoctored value otherwise. Pass (both layers).

## 5. Graceful AI-outage degradation

Both AiDisabledError and AiServiceUnavailableError are caught specifically in processSession()'s
catch block (before the generic DomainError/InternalDomainError fallback), leaving session.status
at whatever it already reached (Classifying) rather than setting Failed; errorCode/errorMessage
recorded for operator visibility only. Unit tests assert the persisted status field directly (not
merely "no exception propagated"). E2E test polls GET /pdf-processing/sessions/:id until
status === 'Classifying' && !!errorCode, then asserts status is explicitly not 'Failed' and
errorCode === 'AI_SERVICE_UNAVAILABLE'. Re-ran independently: pass.

**Verdict: genuinely holds -- confirmed against the actual persisted DB row via a real GET, not an
absence-of-exception inference.**

## 6. Upload validation

All four codes verified against their real trigger condition, both in the unit spec (fakeSession/
buildPdf real pdfkit fixtures) and the e2e spec (real HTTP multipart upload):
- EMPTY_FILE -- zero-byte buffer.
- INVALID_EXTENSION -- real PDF bytes with a .txt filename.
- INVALID_FILE_SIGNATURE -- .pdf-named file with non-PDF bytes.
- FILE_TOO_LARGE -- config's maxPdfSizeBytes overridden below the real PDF's size.
Validation order in validateUploadedFile() (empty -> size -> extension -> signature) matches the
codebase's own established CurriculaService precedent, cheapest-check-first. Pass.

## 7. AiModelResolver integration

Code review of AiServiceClient.invoke() (shared infra, not Dev-16-owned code, but exercised by
every classifyContent call Dev-16 makes): "const model = await this.modelResolver.resolve(ctx.tenantId)"
runs before every attempt, and the resolved {primary, fallback} (as openRouterModelId values) is
placed on the wire body's model field -- never a hardcoded model. PdfProcessingService.classify()
passes tenantId via AiInvocationContext, which AiServiceClient uses for the resolve call. This
confirms real per-tenant/per-default model resolution is genuinely wired for classification calls.

## 8. Full suite re-run (live MySQL 8.4)

Independently re-ran (not trusting the dev session's own numbers):
- npm test (apps/api, default parallelism): 140 suites / 1173 tests, 100% pass, 197.8s. Matches
  the reported figures exactly.
- npm run test:e2e -- --runInBand against live MySQL 8.4 + Qdrant: 30 suites / 296 tests, 100%
  pass, 380.9s. Matches the reported figures exactly.
- npm run typecheck -w apps/api: clean.
- eslint on apps/api/src/modules/pdf-processing/** and apps/api/src/infrastructure/text-extraction/**:
  clean, zero warnings.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-1 (upload/validation, 202-before-AI-work) | Unit + E2E: 4 rejection codes, 202 timing gate, no await before response | Pass | unit spec lines 192-262; e2e spec lines 256-286; own re-run above |
| FR-PDF-2 (hash-only dedup, cost control) | Unit + E2E: exact-hash short-circuit, forceReprocess bypass, classifyContent call-count assertion, reused_from_cache metadata | Pass | unit spec lines 264-301; e2e spec lines 323-352 |
| FR-PDF-3 (classification, UNRECOGNIZED_CONTENT_TYPE, hint bypass) | Unit + E2E: hint bypass, recognized label normalization, unrecognized-label naming | Pass | unit spec lines 303-363; e2e spec lines 289-321 |
| FR-AI-1 (graceful AI-outage degradation) | Unit + E2E: AiDisabledError/AiServiceUnavailableError, persisted status check | Pass | unit spec graceful-degradation describe block; e2e spec lines 354-368 |
| LLD Section 7.3 (owner or exams.review oversight) | Unit + E2E: owner read, non-owner rejection, reviewer oversight bypass, not-found | Pass | unit spec getSession describe block; e2e spec lines 371-386 |
| LLD Section 7.11 (AiModelResolver, {primary,fallback} on request) | Code review of AiServiceClient.invoke()/sendRequest() (shared infra, Dev-14-owned, exercised here) | Pass (by inspection; real-transport coverage is Dev-14's own exit gate per plan) | ai-service.client.ts lines 119, 200 |
| Flaky-test diagnosis re-investigation | 3x isolation re-run + full-suite re-run, code review of waitUntil() fix | Diagnosis confirmed correct | see Section 1 above |
| Static analysis / typecheck | npm run typecheck -w apps/api, eslint on touched paths | Pass | clean output |

## Defects found

**None blocking.** One informational-only note (Finding 0 above) about a misleading-looking but
unrelated environment-configuration trap for future QA/dev passes -- does not affect the shipped
code or its test suite when run via the project's documented scripts.

## Overall verdict

**READY -- Dev-16 (BL-13) is QA-green.** Every named exit gate (202-before-AI-work,
exact-hash-dedup cost control, UNRECOGNIZED_CONTENT_TYPE exact-label naming) was independently
re-verified against real HTTP/MySQL with genuine timing and call-count assertions, not just status
codes. The flaky-test diagnosis from the prior dev session's investigation was independently
confirmed correct by code review and repeated re-runs -- no masked implementation defect found.
Full unit (140/1173) and e2e (30/296) suite counts match exactly on independent re-run. No
blocking defects. Recommend the orchestrator advance past Dev-16 in the pipeline (Dev-17a itself
remains out of scope for this pass and still needs its own QA gate before further phases build on
it).
