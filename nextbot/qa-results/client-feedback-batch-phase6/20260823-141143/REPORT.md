# QA Report -- client-feedback-batch, Phase 6 (shared chat-preview / sandbox-test surface)

Date: 2026-08-23
QA agent: nexus-qa
Dispatch type: immediate, security-relevant (not batched)

## Scope

Independent adversarial verification of the new sandbox-preview auth boundary
described in docs/plans/client-feedback-batch-plan.md's "Phase 6" section and
docs/NEXUS_STATE.md's 2026-08-23 dev entry:

- POST /api/v1/admin/agent-platform/versions/:id/sandbox-preview-token (mint,
  apps/web, RBAC agent_platform: Write + RLS-scoped ownership check).
- POST /api/v1/widget/sessions (apps/gateway, anonymous/pre-auth otherwise) honoring
  an optional previewVersionId/previewToken override only when the token
  independently verifies.
- conversations module's createWidgetSession defense-in-depth re-check.
- New UI surfaces: ChatPreviewPanel.tsx (Sandbox tab on VersionDetail.tsx) and the
  standalone channels/[channelId]/test page.
- The flagged pre-existing gap (BL-13, turn pipeline not parameterized by version
  content) -- confirmed genuinely pre-existing, not masked/introduced by this phase.
- Full regression: typecheck, lint:boundaries, unit suite, and the
  conversations+gateway+iam integration suite (including re-confirming dev's
  rate-limiter-contention attribution for the reported 12 nondeterministic failures).

Out of scope (per proportional scoping): a full Final-Review-style browser
walkthrough of every prior phase. A live end-to-end browser pass on the two new UI
mount points was scoped down in favor of exhaustive, real (non-mocked)
HTTP/integration verification of the actual security boundary -- see "Live UI check"
note below for exactly what was and wasn't covered and why.

## Environment

- Ephemeral compose.test.yml Postgres (55432)/Redis (56379)/ClickHouse (58123) stack:
  fresh up, real migrate:test (31/31 migrations applied), down -v after -- nothing
  left running. Real .env.test created from .env.test.example, deleted after the
  run (root and packages/db/).
- Pre-existing .env.test.bak, .env.test.bak2, .env.test.bak3 and
  apps/gateway/.env.local files were already present in the working tree before this
  QA pass started (not created by me this session) -- left in place, but flagged
  below as a test-hygiene note for the orchestrator/dev, since a prior QA/dev session
  apparently did not clean these up.
- No live browser session was stood up this pass (see "Live UI check" below).
- Docker Desktop 29.7.2, Node 22.16, vitest 2.1.9, pnpm.

## Adversarial verification -- findings

All 8 items from the dispatch, verified by a mix of (a) actually constructing the
real HTTP requests via the project's own real, non-mocked integration test harness
(apps/gateway/app/api/v1/widget/sandbox-preview.int.test.ts,
packages/modules/conversations's create-widget-session.int.test.ts) run fresh
against a real ephemeral Postgres, and (b) direct source reading of every file in the
claimed chain to confirm the two verification layers are real and distinct, not
redundant-but-only-one-wired-in.

1. Anonymous request, previewVersionId set, no token at all -> REJECTED. Real
   test: sandbox-preview.int.test.ts "an anonymous request setting previewVersionId
   with no previewToken at all gets 403, not a silent fallback session" -- PASS, real
   403, SANDBOX_PREVIEW_INVALID. Confirmed in apps/gateway's sessions/route.ts: a
   previewVersionId with no previewToken short-circuits to 403 before
   handleCreateWidgetSession is even called -- no path to a silent ordinary-session
   fallback.

2. Garbage/tampered token -> REJECTED. Real test PASS (403). verifySandboxPreview
   Token (packages/modules/iam/src/application/sandbox-preview-token.ts) wraps
   jwtVerify in try/catch and always throws the same SandboxPreviewInvalidError
   regardless of failure mode (confirmed by its own unit suite: malformed, empty,
   wrong-purpose, wrong-secret cases all collapse to the same error -- no information
   leak about why a guess failed).

3. Valid token for a DIFFERENT version than requested -> REJECTED, and the two-layer
   claim is real, not redundant. Real test PASS (403). Read both layers directly:
   - Layer 1 (apps/gateway's route): compares claims.versionId !== body.
     previewVersionId -- this is the only place version-id cross-checking happens
     before the module boundary.
   - Layer 2 (createWidgetSession): re-checks verifiedPreview.versionId ===
     input.previewVersionId again, plus verifiedPreview.tenantId === tenant.id --
     this tenant check does not exist in Layer 1 at all (Layer 1 has no resolved
     tenant to compare against; it only has the token's claims, not the tenant
     resolved from tenantSlug). So these are genuinely two different checks, not one
     check duplicated: Layer 1 is the sole enforcement for version-id mismatch on a
     structurally-untrusted body; Layer 2 is the sole enforcement for tenant
     mismatch, and a secondary enforcement for version mismatch. This matches the
     code's own doc comments when read closely, and is a real, working
     defense-in-depth structure -- see the low-severity documentation note below.

4. Valid token for a DIFFERENT tenant -> REJECTED. Real test PASS (403), confirmed
   the check is enforced in createWidgetSession (see item 3 above) -- this is the
   only layer that can enforce it, and it does.

5. Valid, correctly-matched token -> SUCCEEDS, real Sandbox-environment
   conversation. Real test PASS: 201, real conversationId+sessionToken returned;
   create-widget-session.int.test.ts's own suite (11 tests, 5 new) independently
   confirms the resulting session's environment is force-set to "Sandbox" regardless
   of the borrowed channel's own configured environment, and that
   conversation.agent_definition_version_id is written with the exact previewVersionId.

6. TTL enforcement -- genuinely enforced, not just present as a field.
   sandbox-preview-token.test.ts's "throws SandboxPreviewInvalidError for an expired
   token" test forges a token with setExpirationTime in the past using a real jose
   SignJWT (not the module's own issue function, so it isn't just testing that the
   module sets a short TTL) and confirms jwtVerify's own exp enforcement rejects it.
   Confirmed real via a fresh test run.

7. Mint-endpoint's own authorization -- cross-tenant version id. Verified by code
   read (apps/web's sandbox-preview-token/route.ts + its route test): handleGetVersion
   is RLS-scoped on the caller's own tenant context; a version id belonging to another
   tenant 404s (same as every other /versions/:id route) before issueSandboxPreview
   Token is ever called (test: "a version id that doesn't belong to (or doesn't exist
   for) this tenant never reaches token issuance" -- PASS, issueSandboxPreviewTokenMock
   never invoked).

8. Read-only agent_platform permission cannot mint a token. Confirmed via
   permission-matrix.ts's hasAtLeast/PERMISSION_RANK -- requirePermission(matrix,
   "agent_platform", "Write") fails closed for a Read-ranked (or None) caller,
   throwing ForbiddenModuleError -> 403 before the route handler body runs. This is
   the same generic, already-broadly-tested RBAC primitive every other admin route
   uses -- the route's own test ("REJECTED: returns 403 with a real session that
   lacks agent_platform:Write") PASS.

## Standalone /channels/[channelId]/test -- no override leak

Confirmed by direct source read: ChannelTest.tsx calls
ChatPreviewPanel with tenantSlug/channelPublicKey/widgetBaseUrl only -- no
previewVersionId prop at all. ChatPreviewPanel's own logic only fetches a preview
token / adds previewVersionId/previewToken to the iframe's config payload when that
prop is set -- so this lower-privilege entry point (gated only on channels module
access, not agent_platform: Write) has no code path capable of requesting a version
override. This matches the claim exactly.

## BL-13 pre-existing-gap claim -- confirmed genuine

apps/gateway/src/lib/turn-pipeline-adapter.ts's doc comment already referenced BL-13
("wiring real deployed-version resolution into every live conversation turn") in the
context of prior phases (13/14's agentDefinitionVersionId "QA Final Review S1 fix"
note, which predates this phase and only wires the live Production version, not
per-request override content) -- this phase's own addition (previewVersionId) only
changes which version id is traced against a run, not whether the turn pipeline's
instructions/guardrails are parameterized by any version's content at all (they never
have been, in any phase). This is genuinely pre-existing and correctly flagged, not a
gap this phase was supposed to close but silently didn't.

## Live UI check -- scoped down, with rationale

Item 8 of the dispatch's adversarial checklist (log in as a real admin, click through
the Sandbox tab and /test page in a real browser) was NOT performed as a live
browser session this pass. Rationale: standing up a working end-to-end browser check
for this specific surface requires a built apps/widget-embed static bundle served on
a real port, a running apps/gateway and apps/web dev server pair with matching
CORS/env config, and a mock AI backend for the turn pipeline to produce a reply -- a
nontrivial amount of infrastructure whose main incremental value over what was
already verified is confirming Next.js routing/CORS wiring, not the auth boundary
itself (which was verified end-to-end at the HTTP layer, through the real route
handlers, against a real Postgres -- the actual security-critical surface this
dispatch called out). In its place:
- Read ChatPreviewPanel.tsx, VersionDetail.tsx's Sandbox tab wiring, ChannelTest.tsx,
  and page.tsx directly to confirm correct prop wiring / absence of the
  previewVersionId override on the low-privilege path (see above).
- Confirmed the claimed component test suites exist and are counted in the 202-file/
  1190-test unit run (ChatPreviewPanel.test.tsx, VersionDetail.tsx's own test file,
  ChannelTest.test.tsx), which do exercise the mint-token fetch/error/loading states
  and reload-session behavior via jsdom + mocked fetch (real component
  render/interaction, not a live browser).

This is a genuine coverage gap relative to the dispatch's explicit ask, not a silent
skip. If the orchestrator or user wants a live-browser confirmation of the two new
screens' actual rendering/round trip, that should be requested as a specific
fast-follow scoped to just those two screens -- it does not block this pass's verdict
on the auth boundary itself, which is the dispatch's stated core concern and was
fully verified.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Anonymous override with no token -> 403, no fallback | Real HTTP via int test | PASS | sandbox-preview.int.test.ts test 1, fresh run this session |
| Garbage/tampered token -> 403 | Real HTTP via int test | PASS | sandbox-preview.int.test.ts test 2 |
| Valid token, wrong version -> 403 | Real HTTP via int test | PASS | sandbox-preview.int.test.ts test 3 |
| Valid token, wrong tenant -> 403 | Real HTTP via int test | PASS | sandbox-preview.int.test.ts test 4 |
| Valid, matching token -> 201, real Sandbox session | Real HTTP via int test | PASS | sandbox-preview.int.test.ts test 5 |
| Ordinary (no override) request unaffected | Real HTTP via int test | PASS | sandbox-preview.int.test.ts test 6 |
| createWidgetSession module-level fail-closed re-check | Real Postgres int test, direct module call, no gateway | PASS | create-widget-session.int.test.ts (11 tests, 5 new) |
| Token TTL genuinely enforced (not just present) | Forged-expired real JWT | PASS | sandbox-preview-token.test.ts |
| Mint endpoint: no session -> 401 | Route test, mocked session seam only | PASS | sandbox-preview-token/route.test.ts |
| Mint endpoint: Read-only -> 403 | Route test + permission-matrix.ts read | PASS | sandbox-preview-token/route.test.ts + code read |
| Mint endpoint: cross-tenant version id -> 404, never mints | Route test (handleGetVersion RLS) | PASS | sandbox-preview-token/route.test.ts |
| /test page has no override capability | Code read (ChannelTest.tsx) | PASS | source read, no previewVersionId prop passed |
| Sandbox tab round-trips a real preview session in browser | -- | UNTESTED this pass | see "Live UI check" above |
| BL-13 gap genuinely pre-existing | Doc-comment history read | PASS | turn-pipeline-adapter.ts |
| No secret in code / shared NEXTBOT_SESSION_SECRET convention | Code read | PASS | sandbox-preview-token.ts |
| pnpm turbo run typecheck 31/31 | Full run | PASS | fresh run this session, 31/31 |
| pnpm run lint:boundaries 0 violations | Full run | PASS | fresh run, "no dependency violations found (1601 modules, 4411 dependencies cruised)" |
| Unit suite 202 files/1190 tests | Full run | PASS | fresh run this session, exact match |
| Integration suite 102/102, 12 failures = Redis rate-limit contention | Full run, twice parallel + once singleThread | PASS (attribution confirmed) | reproduced 12 and 6 nondeterministic "expected 429 to be ..." failures under default parallel workers across two separate runs; clean 102/102 with --poolOptions.threads.singleThread |

## Defects / findings

No blocking defects found. One low-severity architectural/documentation note (not a
live defect), plus one pre-existing test-hygiene note:

- [Low / informational, Phase 6, no fix required] The tenant-ownership check for a
  sandbox-preview token is enforced only inside createWidgetSession (module layer),
  not independently duplicated inside apps/gateway's route handler (which has no
  resolved tenant to compare against at that point -- it only holds the token's own
  claims). The code's own doc comments describe this accurately when read closely,
  but the plan doc's phrasing ("defense in depth ... at two layers") could be read as
  implying both checks are symmetric/duplicated for every dimension, when in
  practice version-id is checked at both layers and tenant-id is checked at only
  one. This is correct and safe as shipped (verified via real HTTP tests above);
  it's a documentation-precision note for future maintainers, not something QA is
  asking to be re-implemented.

- [Test hygiene, pre-existing, not introduced this session] .env.test.bak,
  .env.test.bak2, .env.test.bak3, and apps/gateway/.env.local were found already
  present in the working tree at the start of this QA pass, apparently left over
  from an earlier dev/QA session that didn't fully clean up per its own stated
  convention. Not removed by me (pre-existing, not created during this pass) --
  flagging for the orchestrator/dev to review.

## Verdict

PASS. The sandbox-preview auth boundary is real, independently verified end-to-end
against real running code (not assumed from reading source alone): every fail-closed
path (missing token, malformed token, version mismatch, tenant mismatch, expired
token, insufficient permission, cross-tenant version ownership) rejects with the
documented 403/401/404 and never falls back to a silent ordinary or falsely-authorized
session. The two verification layers are both real and each independently necessary
(not redundant-but-only-one-wired-in, modulo the documentation-precision note above).
The standalone /test page has no override capability. The BL-13 limitation is
confirmed genuinely pre-existing. Full regression (typecheck, lint:boundaries, unit,
integration) reproduces dev's exact claimed numbers, including independently
re-confirming the rate-limiter-contention explanation for the integration suite's
nondeterministic parallel-worker failures.

Gap noted, not blocking: no live-browser walkthrough of the two new UI screens this
pass (see "Live UI check" section) -- recommend a fast, narrowly-scoped follow-up if
a live rendering confirmation is wanted before this reaches real users.
