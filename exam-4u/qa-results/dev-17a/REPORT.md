# QA Report -- Dev-17a (BL-19: Signed file delivery, backend)

Date: 2026-08-10
Scope: Dev-17a only (backend signed-file-delivery mechanism: FR-FILE-1, FR-FILE-2). Dev-17b and
later phases are out of scope and do not exist yet.

## Environment

- apps/api NestJS service, real MySQL 8.4 (examland-mysql Docker container, 127.0.0.1:3306,
  root/YourPassword -- the developer's persistent container; QA's own e2e suites always provision
  their own disposable schemas/tenants and drop them in afterAll, so nothing shared was mutated).
- No standalone live server needed -- all verification driven through Nest's Test.createTestingModule
  plus supertest against the real HTTP layer (same pattern the shipped e2e suite uses), i.e. real
  routing, real Express, real disk storage (a fresh mkdtemp root per run), real DB.
- Node/npm toolchain already installed in the repo; no servers left running afterward; all temporary
  ad hoc test files removed after the run.

## What was independently re-verified (not just trusted from the self-report)

1. Signature verification / forgery resistance. Read FileSigningService.sign()/verify() in full.
   computeSignature() uses createHmac('sha256', secret) over the string "storageKey|expEpoch".
   signaturesMatch() uses timingSafeEqual on the actual comparison path (not just present elsewhere
   in the file, unused) -- confirmed by reading the exact call site (file-signing.service.ts lines
   143-150), and by re-running the existing tampered-signature and round-trip unit/e2e tests.
   Independently generated a real signed URL via POST /files/sign, downloaded the real file through
   it, then tampered with (a) the file path segment while keeping the same sig/exp, and (b) the exp
   value while keeping the same sig -- both were rejected with 403 LINK_INVALID_OR_EXPIRED, never a
   leak or a 200. PASS.
2. Path traversal. Independently attempted, via real HTTP against the real running app (not unit
   calls): a single-percent-encoded dot-dot-slash traversal, a literal unencoded dot-dot-slash
   traversal, and an absolute-path attempt (d//etc/passwd) -- all three were rejected (403/400), none
   returned 200 or leaked the planted secret-outside.txt fixture placed outside the tenant's storage
   prefix. The absolute-path case correctly produced 400 PATH_TRAVERSAL_REJECTED from
   FileSigningService.normalizeAndAssertSafe(); the two dot-dot-slash cases were rejected as 403
   LINK_INVALID_OR_EXPIRED because (confirmed by inspecting the logged, already-decoded
   req.params.path) Express/the URL layer collapses the dot-segments before the handler runs, so the
   resulting path no longer matches the original signature -- exactly the mechanism nexus-dev's own
   doc comments describe, and independently reproduced here rather than just trusted. Unit-level
   coverage of FileSigningService.verify()'s traversal rejection (file-signing.service.spec.ts) was
   also read directly and confirmed to include leading, embedded, and absolute-path fixtures, all
   pre-signature-check. PASS -- no traversal bypass found.
   - Double-percent-encoded fixture, re-investigated independently: nexus-dev's notes claim that a
     double-encoded dot-dot fixture "reliably hangs Express 5/path-to-regexp v7's own wildcard-route
     matching." I built a real-HTTP test racing that exact fixture against a 5-second timeout. In
     this environment it did NOT hang -- it returned 403 LINK_INVALID_OR_EXPIRED in 18ms (the
     double-encoding was resolved to two literal dots by the controller's own decodeURIComponent step
     and rejected the same way as the other traversal fixtures, no leak). This is a non-blocking
     documentation-accuracy finding: either the hang is environment/timing-specific and not reliably
     reproducible, or it depended on a fixture shape not exactly replicated here. It does not change
     the security verdict -- the mechanism is still safe (fast rejection, no traversal) -- but
     nexus-dev's completion notes should not be taken as proof of an unfixable library hang without a
     minimal, deterministic repro attached. Non-blocking.
3. Expiry boundary (exp less-than-or-equal-to now, not strictly less than). Independently reproduced
   end-to-end: signed a URL with a live server, busy-waited in the test until the wall clock reached
   exactly the exp epoch second, then issued the request. Result: 403 LINK_INVALID_OR_EXPIRED at
   exactly now == exp (the run's own log line showed matching second values for both). Confirms the
   fix is real and correctly conservative, not just claimed. PASS.
4. @Public() decorator scope. Read public.decorator.ts and JwtAuthGuard.canActivate() in full, then
   grepped the entire apps/api/src tree for every usage. Findings:
   - @Public() is applied exactly once in the whole codebase: the download handler on
     FilesController (method-level, not class-level).
   - JwtAuthGuard is NOT a global guard (no APP_GUARD registration) -- it is applied per controller
     via explicit UseGuards(JwtAuthGuard, ...) (confirmed on auth, profile, files, exam-authoring,
     taxonomy, pdf-processing, curricula, rbac/roles, rbac/permissions, users -- 10 controllers, all
     requiring it explicitly). This means the Reflector lookup inside JwtAuthGuard can only ever have
     an effect on a route that is already behind JwtAuthGuard and is itself decorated @Public() or
     belongs to a class decorated @Public(). No controller applies @Public() at the class level, so
     there is no route that could accidentally inherit the bypass. Every pre-existing JwtAuthGuard
     unit test (7 tests, re-run) still passes, including the "not public by default" and the new
     "@Public() bypasses and request.user is never populated" assertions.
   - PASS -- scoping is correct and cannot be misused to accidentally expose another route. This is a
     well-contained, single-use mechanism, not a global change in authentication posture.
5. HTTP Range support. Independently exercised via real HTTP against a real 200-byte on-disk
   fixture: bytes=10-19 returned 206 with Content-Range: bytes 10-19/200 and the exact correct 10
   bytes; an out-of-bounds range returned 416 with Content-Range: bytes */200. PASS (re-run of the
   shipped e2e test, both green).
6. Timing-safe comparison, used on the real path. Confirmed by reading file-signing.service.ts lines
   141-150: signaturesMatch() is the only signature-comparison function called from verify() (line
   97), and it always reaches timingSafeEqual(a, b) for any equal-length pair (a length mismatch is
   short-circuited as a mismatch before ever calling timingSafeEqual, which is correct -- unequal
   lengths need no timing protection since the comparison is already trivially rejectable, and
   timingSafeEqual would throw on unequal lengths anyway). Never a bare === anywhere on this path.
   PASS.
7. Full test suite re-run against live MySQL 8.4:
   - modules/files unit tests: file-signing.service.spec.ts (18 tests) plus files.controller.spec.ts
     (11 tests) = 29/29 green, matching the claimed count.
   - jwt-auth.guard.spec.ts: 7/7 green (matches claim, including the new @Public() test).
   - test/files-delivery.e2e-spec.ts (real DB/HTTP/disk): 9/9 green, matching the claimed count and
     scenario list exactly (unauthenticated full download, 206 range, 416, tampered-signature 403,
     real-clock TTL expiry 403, cross-tenant sign 403, 404-not-403 for a since-deleted object).
   - Full apps/api unit suite: initially ran without the project's required
     NODE_OPTIONS=--experimental-vm-modules flag (an environment-setup mistake on my part, not a
     product defect) and saw 2 failing suites / 10 failing tests (pdf-processing.service.spec.ts and
     curricula.service.spec.ts). Dev-16's own prior QA report had already documented that running
     Jest without this exact flag produces a misleading set of failures. Re-ran correctly with the
     flag (matching the project's own test/test:cov/test:e2e scripts in apps/api/package.json):
     140 suites total, 140 passed / 0 failed; 1173 tests total, 1173 passed / 0 failed. Both
     previously-"failing" suites individually re-confirmed green in isolation under the correct flag
     too. No regression exists anywhere in the current tree; my first attempt was a tooling mistake,
     corrected before drawing any conclusion from it. The reported numbers in the completion notes
     (127 suites/1024 tests, from an earlier phase's report) are simply stale relative to the current
     tree, as expected since many phases have landed since -- not a discrepancy in Dev-17a's own
     reporting.
8. Lint / static analysis. eslint run directly against every file Dev-17a touched
   (files.controller.ts, file-signing.service.ts, domain/errors.ts, files.module.ts,
   public.decorator.ts, jwt-auth.guard.ts): 0 errors, 0 warnings.
9. Architecture/spec compliance. modules/files mirrors the existing modules/profile Tier B shape
   (api/, application/, domain/) per LLD section 1.2; FileSigningService has no repository (a
   stateless crypto/authorization service in front of StoragePort, as documented) -- no layering
   violation observed. Error codes (PATH_TRAVERSAL_REJECTED 400, LINK_INVALID_OR_EXPIRED 403) match
   FR-FILE-1's spec wording exactly (a specific code distinct from a generic 404).
10. Authorization-decision judgment call review. The tenant-prefix-only authorization rule for POST
    /files/sign (any authenticated user in a tenant may sign any key under that tenant's own prefix,
    no finer per-resource ownership yet) is explicitly documented as a deliberate, LLD-consistent
    choice, not a silently narrower/broader invention -- read and agree this is the smallest
    reasonable interpretation given the LLD's silence, and it is exercised by the cross-tenant-403
    test. Not a defect.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-FILE-1 signed delivery, golden path | Sign then download real file | Pass | e2e suite, QA adhoc golden-path test |
| FR-FILE-1 tamper-evidence (signature) | Tampered path w/ same sig; tampered exp w/ same sig | Pass | QA adhoc tests, both 403 LINK_INVALID_OR_EXPIRED |
| FR-FILE-1 expiry rejection, exact boundary | Real-clock wait to exp second | Pass | QA adhoc boundary test, 403 at now==exp |
| FR-FILE-1 path-traversal rejection | dot-dot-slash, encoded, absolute path, double-encoded | Pass | QA adhoc traversal tests (real HTTP) plus unit suite |
| FR-FILE-1 distinct 404 vs 403 | Valid sig, deleted object gives 404; bad sig/expired gives 403 | Pass | Shipped e2e suite |
| FR-FILE-1 tenant-boundary on sign | Sign tenant B's token against tenant A's key | Pass | Shipped e2e suite, 403 FORBIDDEN |
| FR-FILE-1 unauthenticated sign rejected | No token on POST /files/sign | Pass | Shipped e2e suite, 401 |
| FR-FILE-2 range support | bytes=10-19 gives 206 plus correct bytes | Pass | Shipped e2e suite |
| FR-FILE-2 unsatisfiable range | Out-of-bounds range gives 416 | Pass | Shipped e2e suite |
| @Public() scoping safety | Grep all usages plus guard registration audit | Pass | Manual code review, item 4 above |
| Timing-safe comparison | Read call path | Pass | Manual code review, item 6 above |
| Unit/e2e coverage claims | Re-ran modules/files unit plus e2e suites | Pass | item 7 above |
| Lint/static analysis | Re-ran eslint on touched files | Pass | item 8 above |
| Full regression (informational, not this phase's gate) | Full apps/api unit suite (correct NODE_OPTIONS flag) | 140/140 suites, 1173/1173 tests green | item 7 above |

## Defects / findings

1. [Non-blocking, informational] Double-percent-encoded traversal fixture does not reproduce a hang
   in this environment. nexus-dev's completion notes claim a double-encoded dot-dot fixture
   "reliably hangs" Express 5/path-to-regexp v7's wildcard matching. Re-tested via real HTTP with a
   5-second race-timeout; it resolved in 18ms with a correct 403 LINK_INVALID_OR_EXPIRED, no hang, no
   leak. Recommend nexus-dev attach the exact minimal repro if the hang is real, or soften the claim.
   Does not affect the security verdict -- the mechanism was safe either way.

No blocking defects found in Dev-17a's own scope, and no unresolved regressions anywhere in the
tree (the full suite is 140/140 suites and 1173/1173 tests green once run with the project's
required NODE_OPTIONS=--experimental-vm-modules flag -- my own first attempt without that flag
produced a misleading set of failures, corrected before drawing any conclusion, per the same
caveat Dev-16's own QA report had already recorded). Signature forgery resistance, path-traversal
rejection, the exact expiry boundary, @Public() bypass scoping, range support, and timing-safe
comparison were all independently re-verified against a live, real MySQL-backed server -- not
accepted on the self-report alone.

## Verdict

PASS -- Dev-17a is QA-green, no blocking defects. The one non-blocking finding above (the
unreproduced double-percent-encoded hang claim) does not gate Dev-17a and does not require a
nexus-dev retry.
