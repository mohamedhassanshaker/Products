# QA Report -- Dev-17b (BL-19: wire signed delivery into existing surfaces)

Date: 2026-08-10
Scope: Dev-17b only (closes out BL-19 = Dev-17a + Dev-17b). Dev-18a+ out of scope, not started.

## Environment

- Real MySQL 8.4 (existing local Docker container examland-mysql, root/YourPassword), real
  Qdrant container (examland-qdrant, unused by this phase but part of app bootstrap).
- Built the real production artifacts: npm run build:contracts && npm run build:api && npm run
  build:web, copied the Angular production build into apps/api/public (the exact single-process
  serving shape ServeStaticModule expects, matching HLD S13.1).
- Booted the actual compiled AppModule via NestFactory.create (ad hoc boot script, removed after
  the run) with NODE_ENV=development (so TenantResolutionMiddleware resolves the "default"
  subdomain regardless of Host header -- avoided needing a hosts-file edit) and
  SIGNED_URL_TTL_SEC=6 for a fast real-expiry window, on 127.0.0.1:3901.
- Provisioned one real tenant (TenantProvisioningService, same code path production uses) and one
  real Member user via POST /api/auth/register.
- Drove the real UI with Playwright/Chromium (headless), a real 64x64 PNG test file, real HTTP
  requests captured from the browser's own network stack (not mocked).
- All QA-created DB schemas dropped and temp storage/build artifacts removed after the run
  (examland_platform_qa_* / t_default_* schemas; apps/api/public, apps/public directories).

## Headline requirement 1 -- avatar renders via a genuine signed URL

PASS. Uploaded a real image through the actual <input type=file> on /profile. Observed:
- POST /api/files/sign request body: {"storageKey":"tenants/<tenantId>/avatars/<userId>/<uuid>.png"}
- Response: {"url":"/api/files/d/tenants/.../....png?exp=<epoch>&sig=<hmac>","expiresAt":"..."}
- The <img class="avatar-image">'s actual src was exactly that signed URL string.
- naturalWidth on the loaded <img> was 64 (matches the real uploaded 64x64 PNG) -- the browser
  genuinely decoded pixel data from the signed URL, not a placeholder.
- Screenshot: qa-results/dev-17b/20260810/04-after-upload.png

Independently confirmed the storage key itself is NOT directly fetchable: curling the bare
/api/files/d/tenants/.../....png path with no exp/sig query params returned 403
LINK_INVALID_OR_EXPIRED -- matches FR-FILE-1's exact required error semantics, not a generic 404.

## Headline requirement 2 -- expired-link graceful recovery

PASS, verified two ways (matching nexus-dev's own claimed verification method):
1. Real TTL elapse: waited past the real 6-second SIGNED_URL_TTL_SEC, then fetched the
   exact same previously-valid signed URL from inside the page -- server genuinely rejected it with
   403 {"error":{"code":"LINK_INVALID_OR_EXPIRED", ...}}.
2. Simulated stale-load race: intercepted /api/files/d/** to force one 403 response, matching
   the real server's shape. AvatarComponent showed the exact expected UI: a broken-image icon
   placeholder (not a raw broken <img>), the text "Image link expired.", and a "Reload" button --
   never a silent failure or raw error dump. Screenshot:
   qa-results/dev-17b/20260810/06-simulated-expired-state.png
   Clicking "Reload" issued a fresh POST /api/files/sign and genuinely recovered the avatar
   (naturalWidth back to 64). Screenshot:
   qa-results/dev-17b/20260810/07-after-reload-button-recovery.png

## Security audit -- exit gate

PASS. Independent grep of apps/web/src for /files/d/, storageKey, pictureKey,
tenants/${, /avatars/, STORAGE_ROOT confirms every match is either FilesService.sign()'s own
POST /files/sign request body construction, a doc comment, or ProfileService's type comment on
the opaque pictureKey field -- no other client code ever constructs or reads a /files/d/... path.
AvatarComponent is confirmed the sole place an <img src> is ever set from a signed-delivery
result.

Runtime check (not just source): the network tab across the full upload/view/expire/reload cycle
never revealed a working unsigned path -- the raw storageKey value only ever appears as an outbound
request body to POST /files/sign (which the server needs to mint a signature), never as a
directly-followable URL. Confirmed server-side rejection of the bare path (see above).

## Scope judgment call -- new "My Profile" screen

Assessed as genuinely necessary, not scope creep. Independently confirmed nexus-dev's ground-truth
claim: grepping apps/web/src/app for "picture"/"avatar" (excluding the new profile/files/avatar
files themselves) returns nothing except app.routes.ts's own route registration for the new screen
-- no pre-existing Angular screen anywhere consumed GET/PATCH /profile or POST /profile/picture
before this phase. Dev-17b's own deliverable line ("e2e verifying an avatar renders via a signed URL")
cannot be satisfied without some UI surface rendering an avatar; the screen built is minimal
(view profile fields + upload/view avatar only, reusing Dev-6a's unchanged backend, no new endpoint
or business rule), consistent with FR-IAM-4's already-scoped fields. This is the narrowest surface
that makes the phase's own exit gate testable, not an unrelated feature expansion.

## Browser console / CSP

No CSP violations observed. The only console errors captured were the two expected 403 Forbidden
resource-load failures during the deliberate expired-link scenarios (the <img> load failures that
AvatarComponent's (error) handler is designed to catch) -- not unexpected errors elsewhere on the
screen.

## Automated tests

- Re-ran the full apps/web suite myself: 44 files / 238 tests, all green -- matches nexus-dev's
  reported numbers exactly.
- npm run lint (root, scoped to apps/**/*.ts, packages/**/*.ts, --max-warnings=0): clean, 0
  errors (after removing my own ad hoc QA boot/verification scripts, which were the only files lint
  flagged).
- Did not re-run the full apps/api suite (Dev-17b is frontend-only per its own scope line and the
  plan's "Out" line; apps/api source is untouched by this phase). Spot-checked instead by exercising
  the real, unmodified apps/api backend end-to-end through the browser flows above, which is a
  stronger signal than a unit-test re-run for this specific phase.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-FILE-1 (avatar served via signed URL) | Real upload -> real signed img src, naturalWidth>0 | PASS | 20260810/04-after-upload.png, network capture above |
| FR-FILE-1 (expired/invalid link -> specific error, not generic 404) | Direct curl of unsigned path; real TTL elapse fetch | PASS | curl 403 LINK_INVALID_OR_EXPIRED; in-page fetch same |
| Dev-17b deliverable: expired link fails gracefully with re-request prompt | Simulated 403 load failure -> "Image link expired." + "Reload" -> recovery | PASS | 20260810/06-...png, 07-...png |
| Dev-17b exit gate: no direct/guessable file path reachable from client | Independent grep audit + runtime network inspection | PASS | grep output above; no unsigned path ever usable |
| Scope: minimal necessary surface, not creep | Independent grep for pre-existing avatar/profile UI | PASS (confirms nexus-dev's framing) | grep returned only the new files |
| Regression: full web suite still green | Re-ran apps/web test suite | PASS | 44 files / 238 tests |
| Regression: lint clean | Re-ran root lint | PASS | 0 errors on actual product code |

No requirement in this phase's scope was left untested.

## Defects

None found. No blocking or non-blocking defects identified in this pass.

## Verdict

READY. Dev-17b is QA-green. This closes out BL-19 (Dev-17a + Dev-17b) in full -- both the signed-URL
avatar rendering and the expired-link graceful-recovery flow are genuinely working in a real browser
against a real backend/DB, and the exit-gate security audit is independently confirmed clean.
