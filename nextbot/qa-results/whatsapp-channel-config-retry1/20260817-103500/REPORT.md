# QA Re-verification Report -- BL-15 WhatsApp Channel Config Screen (Phase 19, dispatch #8, retry 1)

## Scope
Re-verify the 3-item fix pass (D1 significant + D2/D3 minor) from the prior QA FAIL,
plus a light regression spot-check of the rest of the WhatsApp channel config screen
and full-suite/lint/typecheck confirmation. Not a full regression (that was already
done by the backend-only PASS in qa-results/whatsapp-channel-bl15/20260817-095700/).

## Environment
- Full automated suite / typecheck / lint run against a fresh checkout using
  compose.test.yml's already-running ephemeral Postgres/Redis/ClickHouse
  (ports 55432/56379/58123).
- Live UI verification: the running docker-compose.yml dev stack's web/gateway
  images were found to be stale (built before this fix pass's source changes and
  before migration 0029_whatsapp_webhook_status.sql had ever been applied to the
  stack's persistent Postgres volume -- confirmed by column-not-found errors and
  image build timestamps). Rather than rebuild multi-GB Docker images, ran apps/web
  and apps/gateway as two genuinely separate "next dev" OS processes (ports
  3300/4101) directly against the current source tree and the same real dev
  Postgres/Redis (localhost:5432/6379, tenant "demo") the Docker stack itself uses --
  applied the one pending migration, then drove a real Chromium browser (Playwright)
  against these processes. A small discriminating local HTTP mock stood in for
  graph.facebook.com (NEXTBOT_META_GRAPH_API_BASE_URL) -- since no real Meta App
  exists in this sandbox (a disclosed, pre-existing limitation, not new to this fix
  pass) -- accepting only a specific token+business-id pair and genuinely rejecting
  everything else with a real 401, so the connect-time verification call in
  connectMetaBusinessAccount is exercised for real over the network, not stubbed.
  All QA-created channel/meta_business_account/credential/consent/template rows were
  deleted afterward (verified zero rows remain); the two dev processes and the mock
  server were killed; .env.docker was restored byte-for-byte to its original state
  after a brief, fully-reverted side experiment (see Note below); the Docker web
  container was left exactly as found (stale image, untouched -- no rebuild
  performed, out of scope for this QA pass).

Note (informational, not a defect against this dispatch): while investigating the
stale-image issue, confirmed as an aside that docker-compose.yml's web/gateway
containers have no NEXTBOT_GATEWAY_BASE_URL override, so the "Re-verify Challenge"
server-side action's default (http://localhost:4001) would not resolve to the
gateway container from inside the web container's own network namespace in a
"docker compose up" deployment (Docker service-name DNS, e.g. http://gateway:4001,
is what actually resolves there) -- the admin-facing webhook URL text itself is
correct (it is evaluated by the admin's own browser via the host-mapped port, not
inside the container). This mirrors the exact same characteristic already accepted
for NEXTBOT_WIDGET_BASE_URL and is documented as overridable; not raised as a
blocking defect of this dispatch, but flagged for the deployment/ops owner to
consider setting NEXTBOT_GATEWAY_BASE_URL=http://gateway:4001 in
docker-compose.yml's shared-env so "Re-verify Challenge" actually works out of the
box in a docker compose up topology.

## Full suite / typecheck / lint (independent re-run)
- pnpm run typecheck: 31/31 packages clean (turbo, matches dev's claim).
- pnpm run lint:boundaries: clean, exit 0 (eslint + dependency-cruiser).
- pnpm run lint (eslint . --max-warnings=0): clean, exit 0, zero warnings/errors.
- vitest run --project unit: 839/839 passed (0 failed this run -- dev's disclosed
  1 flake, admin-routes.test.ts's handleLogin timing out only under full-suite
  parallel load, did not reproduce in this run; consistent with dev's own note that
  it passes cleanly in isolation).
- vitest run --project integration: 283/283 passed.
- vitest run --project isolation: 76/76 passed.
- Net: dev's claimed counts (839/840, 283/283, 76/76) are independently confirmed --
  genuinely green.

## D1 re-verification (significant -- missing Webhook tab) -- CONFIRMED FIXED
- WhatsAppChannelConfig.tsx's TabList genuinely renders 6 tabs (Meta Connection,
  WABA & Numbers, Credentials, Webhook, Templates, Consent) both before and after
  connecting a Meta Business Account -- captured live (tab-list-preconnect.json,
  tab-list-postconnect.json, screenshots 06/11-12).
- Webhook URL is real, not a placeholder:
  http://localhost:4101/api/v1/channels/whatsapp/webhooks/<tenantId>/<channelId> --
  correctly derived from NEXTBOT_GATEWAY_BASE_URL (the env var pointed at my local
  gateway process) plus the real route path.
- Verification status genuinely starts Pending for a freshly-connected account
  (screenshot 11-webhook-tab-pending.png) -- never a fabricated Verified.
- "Re-verify Challenge" performs a genuine HTTP round trip: clicking it in the
  browser produced a real POST .../whatsapp/webhook/reverify (confirmed in the
  next dev server log), which itself made a real outbound GET to the gateway's
  webhook route with the tenant's real vaulted verify token and a fresh random
  challenge; status flipped to Verified with a genuine, changing "Last verified"
  timestamp on each click (screenshot 12-webhook-reverify-result.png).
- Independently drove the real Meta hub.challenge handshake directly (bypassing
  the admin UI action entirely, exactly as Meta itself would call it):
  - GET .../webhooks/{tenantId}/{channelId}?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=X
    -> 403 {"title":"Webhook verification failed."}.
  - Same request with the real vaulted verify token (resolved via
    resolveWebhookVerifyToken) -> 200, raw body echoing the literal challenge
    string (REAL_META_CHALLENGE_XYZ), exactly as Meta's protocol requires (not
    JSON-wrapped).
- Event subscriptions correctly flipped from "Not subscribed" (both event types) to
  "Subscribed" only once the account was both Connected and webhook-Verified,
  matching the disclosed derivation logic.
- Verdict: D1 is a real, structural fix -- not a re-add of the same gap under a
  different name.

## D2 re-verification (minor -- optimistic Connected status) -- CONFIRMED FIXED
- Negative case: submitted a fabricated Business ID (9999999999999999-FABRICATED)
  + fake token/secret via the real Meta Connection form. The connect call made a
  real network round trip to the (mocked) Graph API, got a real 401, and the UI
  genuinely showed the connect form still (never flipped to "Connected") with the
  literal error text including the real transport failure detail: "Could not verify
  this Meta Business Manager account... (Meta Graph API GET
  /9999999999999999-FABRICATED?fields=id,name failed with status 401: ...)"
  (screenshot 08-meta-connect-fabricated-result.png).
  - Verified zero persistence: queried meta_business_account for this channel
    directly in Postgres immediately after the failed attempt -- 0 rows. No partial
    credential/account rows were left behind.
- Positive case: submitted the mock's designated valid Business ID
  (111222333444555) + matching token. The same real network round trip this time
  succeeded (real 200 from the mock), and the UI genuinely flipped to Connected
  with the correct business name/ID displayed (screenshot
  10-meta-connect-valid-result.png).
  - Confirmed via direct Postgres query: exactly 1 row, status='Connected',
    webhook_verification_status='Pending' (correct default at insert time, later
    flipped to Verified by the webhook re-verify test above).
- Verdict: D2 is a real fix -- the connector genuinely fails at connect time for
  invalid credentials with nothing persisted, and genuinely succeeds only after a
  real verification call for valid ones.

## D3 re-verification (minor -- empty Actions column header, a11y) -- CONFIRMED FIXED
- UsersTable.tsx's trailing <Th> now contains <VisuallyHidden>Actions</VisuallyHidden>
  -- confirmed live: the real Users & Roles table's last <th> has "Actions" in both
  its rendered textContent and Playwright's allTextContents() (i.e., present in the
  accessible tree even though visually clipped) -- not the previous empty <Th />.
- Ran a real axe-core scan (axe-core 4.13.0, injected directly into the live page)
  against the real Users table: 0 violations on the users table specifically (one
  unrelated color-contrast violation appeared in an earlier, less-targeted run
  against the wrong <table> element on the page -- re-scoped correctly to the
  actual Users table and it disappeared; this matches the pre-existing,
  already-disclosed, out-of-scope systemic gray-text contrast issue noted in
  earlier QA passes, not a regression from this fix).
- Verdict: D3 is a real fix.

## Light regression spot-check (5 previously-passing tabs + cross-cutting)
All driven live against the real running dev processes with the discriminating mock
Meta backend (not stubbed application logic):
- Meta Connection: covered above (D2 re-verification is this tab's core flow).
- WABA & Numbers: WABA ID save + "Sync phone numbers from Meta" against the real
  (mocked) GET /{waba}/phone_numbers -- genuinely populated the table (1 real
  synced number, Verified/Tier 2 badge rendering correctly). Readiness banner
  correctly flipped to "Ready to activate" once WABA ID was set on a Connected
  account.
- Credentials: masked hints render correctly (qa-...oken, qa-...cret), App ID
  shown in the clear, Rotate buttons present.
- Templates: "Sync from Meta" against the real (mocked)
  GET /{waba}/message_templates -- genuinely synced 1 template with correct
  name/language/status/variable-extraction ({{1}}) rendering.
- Consent: bulk-import dry-run preview then commit -- 2 rows imported, correctly
  masked phone numbers in the resulting log (+1......0001 / +1......0002), correct
  OptedIn/OptedOut badges.
- Console/network: zero unexpected console errors across the whole flow (the one
  entry logged was the browser's own "resource failed to load: 422" for the
  intentional fabricated-credential negative-test POST -- expected, not a defect).
- FR-META-01's 24h-window rejection was not independently re-driven live this pass
  (unchanged by this dispatch, and already re-confirmed structurally correct --
  exact spec copy, pre-send rejection -- by the fresh 283/283 integration run,
  which includes whatsapp-inbound.int.test.ts's dedicated 24h-window test, plus the
  prior backend QA pass's live curl-driven confirmation). Time-boxed given this
  dispatch never touched adapter.ts's send().

## Traceability matrix

| Item | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| D1 (Webhook tab, screen inventory B.2.3) | Tab presence pre/post connect; real URL; Pending default; Re-verify Challenge round trip; independent raw hub.challenge GET (wrong + correct token); event-subscription derivation | PASS | tab-list-*.json, 06/11/12 screenshots, direct curl transcript above |
| D2 (optimistic Connected status) | Fabricated ID negative (zero persistence); valid mock positive (correct persisted state) | PASS | 07/08/09/10 screenshots, Postgres query output |
| D3 (empty Actions header, a11y) | DOM textContent check; axe-core scan | PASS | 13-users-roles-tab.png, axe-users-table.json |
| Meta Connection (regression) | Connect/reconnect flow | PASS | (see D2 evidence) |
| WABA & Numbers (regression) | Save WABA ID, sync numbers | PASS | 14-waba-numbers-synced.png |
| Credentials (regression) | Masked hints render | PASS | 15-credentials-tab.png |
| Templates (regression) | Sync from Meta | PASS | 16-templates-synced.png |
| Consent (regression) | Bulk import dry-run + commit | PASS | 17-consent-preview.png, 18-consent-committed.png |
| FR-META-01 24h-window rejection (regression) | Not independently re-driven live this pass -- relied on fresh full-suite pass (283/283, includes dedicated int test) + prior backend QA's live confirmation | PASS (by suite) | fresh integration run this pass; qa-results/whatsapp-channel-bl15/20260817-095700/REPORT.md |
| Full suite / typecheck / lint | Fresh independent run | PASS | unit 839/839, integration 283/283, isolation 76/76, typecheck 31/31, lint clean |

## Defects
None. All 3 previously-reported defects (1 significant, 2 minor) are confirmed
structurally fixed, not superficially patched. No new blocking defects found. One
non-blocking, out-of-scope operational note recorded above (NEXTBOT_GATEWAY_BASE_URL
not set in docker-compose.yml's Docker-networking topology) -- recommended for a
future ops/deployment pass, not a retry of this dispatch.

## Verdict
PASS. BL-15's WhatsApp channel config screen (Phase 19, dispatch #8) is ready to
advance past the QA gate. Recommend clearing pending_qa for this item.
