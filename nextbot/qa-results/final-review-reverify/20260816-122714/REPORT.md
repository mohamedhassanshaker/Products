# NextBot — Final Review Re-Verification (retry 1 fix pass)

- **Date:** 2026-08-16
- **Mode:** Final Review, full regression + real docker-compose smoke test
- **Scope:** Re-verify B1-B4 (blocking), S1-S3 (significant) and all minor items from
  `qa-results/final-review-full-regression/20260816-090721`, plus a full regression
  sweep of the whole application.
- **Verdict: PASS with reservations** — ready to report complete; 1 significant partial
  fix (S1 cost/tokens) and several minor items carried forward as known gaps.

---

## 1. Environment

| Item | Value |
|---|---|
| Stack | `docker compose -f docker-compose.yml --env-file .env.docker up -d --build` (fresh rebuild; images built 12:20-12:22) |
| Containers | postgres, redis, clickhouse, web, gateway, worker, widget-embed — all 7 healthy; `migrate` and `seed` one-shot jobs exited 0 |
| Admin Console | http://localhost:3200 (host port 3000 was held by an unrelated `flowise` container; used the compose file's own documented `WEB_HOST_PORT` override) |
| Gateway | http://localhost:4001 |
| Widget assets | http://localhost:8080 (`/loader/nextbot.js`, `/widget/index.html`) |
| Tenant host page | http://localhost:8099 — separate origin, plain static HTML |
| AI provider | Standalone OpenAI-compatible mock at `host.docker.internal:38999` (from `.env.docker`) |
| MCP backend | Standalone MCP Streamable-HTTP mock at `https://host.docker.internal:8443/mcp` |
| Credentials | Seeded `demo` tenant, 6 role logins from `SEED_CREDENTIALS.md` |

### Disclosed test-harness accommodations

1. **Host port 3000** was taken by an unrelated container; the web service was published on
   3200 via the compose file's own `WEB_HOST_PORT` variable. No product code or config changed.
2. **Connector endpoints are schema-restricted to https**
   (`packages/contracts/src/connectors.ts`, `pattern: "^https://"`). To exercise a real
   connector probe, a private CA plus a `host.docker.internal` server cert were generated and
   `NODE_EXTRA_CA_CERTS` was temporarily added to web/gateway/worker via a throwaway
   `docker-compose.qa-override.yml`. TLS verification stayed ON throughout (a self-signed cert
   was correctly rejected first). The override file and CA were deleted and the three services
   recreated from the unmodified documented compose config at the end of the run; a final widget
   turn against that restored stack still produced a genuine AI reply
   (`57-final-unmodified-stack.png`).
3. **S1 prerequisite seeded via SQL.** `findActiveAgentDefinitionVersion` requires a
   `Production`-status `agent_definition_version`. Creating one through the product's own UI is
   blocked without an external Git provider (finding N1), so one row was inserted directly — the
   same fixture the dev fix pass used. This verifies the fix's real mechanism; the reachability
   gap is reported separately, not hidden.
4. Postgres/ClickHouse volumes were not wiped (`down` without `-v`, per the documented Quick
   Start), so pre-existing demo data from earlier sessions is still present. Useful for
   regression, not a defect.

---

## 2. Traceability matrix

| Item | Requirement / claim | Scenarios exercised | Result | Evidence |
|---|---|---|---|---|
| B1 | Health-check worker writes real `connector.status`; tool call no longer denied `connector_offline` | Created connector "RV Mock Backend" through the Admin Console wizard (created `Offline`); watched the worker's 60s `mcp.health-check` job flip it Offline -> Connected against a live MCP container; discovered 4 tools; ran a real Tier-1 tool call | PASS | `05-connector-created.png`, `06-connectors-list-connected.png`, `07-after-discover.png`, `19-tier1-tool-result.png` |
| B1b | Degraded/Offline transitions are real too | Pre-existing "QA Mock Backend" observed transitioning Offline -> Degraded on its own via the recent-error-rate window, with no intervention | PASS | section 3 log |
| B2 | Empty-string AI env no longer crashes; `.env.docker` reaches containers; real AI reply | `docker exec` confirmed 4 optional `AI_*` vars present as empty strings and `AI_BASE_URL`/`AI_MODEL_*` sourced from `.env.docker`; a real customer message through the widget got a genuine model-reasoned reply, not the backend-timeout fallback | PASS | `18-widget-ai-reply.png` |
| B3 | Console embed snippet works from a real separate origin | Console "Get embed snippet" output pasted verbatim into a static HTML file served from :8099; widget iframe mounted (`/widget/index.html` resolved correctly from `/loader/nextbot.js`), launcher rendered, full conversation worked, zero console/network errors | PASS | `10-embed-snippet.png`, `16-host-page-launcher.png`, `17-widget-opened.png` |
| B4 | Real actor on login, connector CRUD, permission-rule change, Tier-3 decision, escalation claim | All five performed for real; every row carries a real `actor_id`, never `system` | PASS (minor N3) | `52-audit-log.png`, section 3 audit dump |
| S1 | Trace Viewer shows real trace data and real cost; Runtime Traces shows real spans | 3 real `agent_run` rows and 5 real ClickHouse `agent_run_span` rows (ModelCall + ToolCall) from live widget conversations; Runtime Traces lists real runs; Trace Viewer renders the tool-call timeline and raw event log; "Replay in Test Console" now honestly disabled | PARTIAL: trace data PASS, cost/tokens FAIL (D1) | `24-runtime-traces-selected.png`, `26-trace-viewer.png` |
| S2 | Admin can set approval tier via UI and it takes effect | `/tools/{id}/permissions` editor: added RequireApproval + Tier 3 on `close_account` (a Tier2-default tool) and saved through the UI; the next tool call suspended as `AwaitingHumanApproval` at Tier3 | PASS | `29-permission-rule-tier3.png`, `30-permission-rule-saved.png`, `34-tier3-customer-side.png` |
| S3 | Non-conforming tool output renders as a structured card with PII masked | `lookup_customer_profile` returns a generic flat object with a customer email and phone; rendered as a labelled DataSummary card with `emailAddress` and `phoneNumber` fully masked. No raw JSON dump, no exposed email | PASS (minor N4) | `20-s3-generic-tool-output.png` |
| M1 | Duplicate handoff message | Escalation trigger produced exactly one connecting message | PASS | `42-widget-escalation-requested.png` |
| M2 | Approval Queue missing Backend / action-summary columns | Both present ("RV Mock Backend", "Call close_account on RV Mock Backend") | PASS | `35-approval-queue.png` |
| M3 | Non-UUID connector id returned 500 | Renders "Connector not found." | PASS | `53-connector-bad-id.png` |
| M4 | Invalid permission-rule combo returned 500 | PUT with `requiredTier` plus `effect: "Allow"` now returns 422 "Invalid permission rule list." | PASS | section 3 |
| M5 | Docs `.env.docker` precedence | `DEPLOYMENT.md` specifies `--env-file .env.docker` on every stack-affecting command | PASS | section 3 |
| M6 | MCP Health showed UUIDs | Tool-level table shows real connector names | PARTIAL: circuit-breaker table still shows raw tool UUIDs (N5) | `54-mcp-health.png` |
| M7 | Debris files | `packages/db/audit_grant_test*.mjs`, `undefined/`, `scratch_qa/` all gone | PASS | section 3 |
| R1 | Core MVP loop end to end | widget -> Tier-1 tool call -> Tier-2 confirm/cancel -> Tier-3 approve/reject -> escalation -> live takeover -> agent message -> return to bot -> bot resumes | PASS | `19`, `31`-`33`, `34`-`41`, `43`-`51` |
| R2 | Tier-2 cancel makes no backend call | Mock MCP call log shows exactly 4 `tools/call`; the cancelled refund produced zero | PASS | section 3 |
| R3 | RBAC across 6 roles | Nav scoping plus server-side enforcement for read-only, designer, escalation-agent, platform-engineer, backend-owner, admin | PASS | `55-rbac-*.png` |
| R4 | Audit append-only | `nextbot_app` role: UPDATE and DELETE on `audit_log_entry` both denied | PASS | section 3 |
| R5 | Credential vault access | `credential` table not readable as plaintext by app/gateway roles | PASS | section 3 |
| R6 | Tenant isolation | Isolation suite 9 files / 69 tests green against real Postgres RLS | PASS | section 3 |
| R7 | PII masking on tool output | Applied on the live rendering path (S3) | PASS | `20-s3-generic-tool-output.png` |
| R8 | Whole-console sweep | 21 admin screens loaded, no crash or error state on any | PASS (console 404 noise, N2) | section 3 |
| R9 | Automated suite | typecheck 31/31; `eslint . --max-warnings=0` clean; dependency-cruiser 0 violations (1161 modules / 2879 deps); unit 136 files / 762 tests; integration 58 / 241; isolation 9 / 69 | PASS (count discrepancy N6; one flake N7) | section 3 |

---

## 3. Defects, by severity

### D1 — Agent-run cost and token counts are never recorded (SIGNIFICANT; partial S1 fix)

- **Expected:** S1's re-verification criterion — the Conversation Trace Viewer shows real trace
  data **and real cost**.
- **Actual:** trace data is real; cost and tokens are not. `agent_run.tokens_in`,
  `agent_run.tokens_out` and `agent_run.cost_usd` are NULL for every real run, and
  `model_call_log` is completely empty (0 rows) despite three real provider calls whose
  responses carried `usage: {prompt_tokens: 137, completion_tokens: 42}`. The Conversation list
  therefore shows `$0.0000` for every conversation, the Trace Viewer shows `Cost $0.0000` and
  `Tokens (in/out) 0 / 0`, and Runtime Traces shows `—` in its COST column.
- **Root cause:** `turn-pipeline.ts`'s `finish()` calls
  `endTurnRun(ctx, handle, { status, durationMs })` and never passes
  `tokensIn`/`tokensOut`/`costUsd`, although `endTurnRun`/`completeAgentRun` both accept them.
  Nothing on the live turn path writes `model_call_log` at all.
- **Repro:** with a Production version promoted, send any widget message, then Admin Console ->
  Conversations -> View trace. Cost `$0.0000`, Tokens `0 / 0`.
- **Evidence:** `26-trace-viewer.png`, `24-runtime-traces-selected.png`;
  `select tokens_in, tokens_out, cost_usd from agent_run` -> all NULL;
  `select count(*) from model_call_log` -> 0.
- **Originating phase:** cross-phase — Phase 13 (BL-06) added the columns; the retry-1 S1 fix
  wired runs/spans but not the usage figures.
- **Severity:** significant, not blocking. The headline claim ("traces are no longer permanently
  empty") is genuinely satisfied; cost is a secondary metric on an already-known-empty screen.

### N1 — No in-product path to a Production agent version on a fresh deployment (rough edge)

- `createAgentDefinitionVersion` commits to the tenant's Git remote first and hard-fails with
  `409 GIT_CONNECTION_UNAVAILABLE` when no connection exists; connecting one requires a real
  GitHub/GitLab OAuth app. `scripts/seed.ts` creates no agent definition or version either.
  So out of the box `findActiveAgentDefinitionVersion` returns null, `runId` stays null, and
  Trace Viewer / Runtime Traces / cost stay empty for every conversation until an external Git
  provider is wired up.
- The Git-first behaviour is deliberate and correct per ADR-0009 ("never a silent Postgres-only
  fallback"). The gap is that the demo seed provides no definition/version, so the S1 fix is
  invisible on the shipped demo stack.
- **Repro:** fresh stack -> Agent Platform -> Definitions -> New -> version -> Create Version -> 409.
- **Evidence:** `15-version-created.png` (409 logged).
- **Originating phase:** deployment (seed script), interacting with the retry-1 S1 fix.
- **Suggested fix:** have `scripts/seed.ts` create one demo Production version for `demo`.

### N2 — Dead breadcrumb parent routes 404 on 11 screens (MINOR)

Next.js prefetches `/settings` and `/agent-platform`, neither of which has a `page.tsx`. Every
Settings and Agent-Platform screen logs `404 (Not Found)` in the browser console, and the parent
breadcrumb crumb is a dead link. Cosmetic. Evidence: `56-sweep-*.png`; 404 URLs
`/settings?_rsc=...`, `/agent-platform?_rsc=...`. Originating phase: cross-phase (admin shell).

### N3 — Audit `actor_label` is a raw UUID for every non-login action (MINOR)

`recordAdminAudit` is called with `actorLabel: guard.session.userId` for connector CRUD,
permission-rule updates, approval decisions and escalation claims, so the Audit Log screen's
Actor column reads `01a008b9-62b1-...` for those rows while login rows correctly read
`admin@demo.nextbot.local`. "Who did this" is answerable (`actor_id` is real) but needs a manual
join. Also still unaudited: escalation `resolve` / `return-to-bot` / agent message (only `claim`
is audited), and connector update/delete — so FR-ADM-03's "every ... escalation" is only partly
covered. Evidence: `52-audit-log.png`. Originating phase: retry-1 B4 fix.

### N4 — PII masking over-masks benign fields (MINOR)

The fail-closed `Untrusted` policy masks date-like values, so a legitimate order ETA renders as
`**********` to the customer on the Tier-1 golden path, while `fullName` ("Dana Whitfield") is
left unmasked. Defensible as a fail-closed default, but it degrades a core happy path.
Evidence: `19-tier1-tool-result.png`, `20-s3-generic-tool-output.png`.

### N5 — MCP Health circuit-breaker table still shows raw tool UUIDs (MINOR)

The tool-level health table was fixed to show connector names, but the "Circuit breaker status"
table below it still lists TOOL ID as bare UUIDs — an incomplete fix of the same reported item.
Evidence: `54-mcp-health.png`. Originating phase: retry-1 minor fix.

### N6 — Reported unit-test count is not reproducible (MINOR, reporting accuracy)

Dev reported "unit 1070". `pnpm run test:unit` (the canonical `--project unit` run) reports
136 files / 762 tests. The 1070 figure appears to be the sum across `turbo run test`'s
per-package fan-out, which re-counts shared files. Integration (241) and isolation (69) match
exactly. No missing coverage was found — a counting artifact, not a defect.

### N7 — One flaky unit test under full-suite load (MINOR)

`apps/web/app/(admin)/agent-platform/definitions/[id]/versions/new/VersionEditor.test.tsx`
("git connection unavailable") failed once on a `findByText` timeout during the first full run,
then passed in isolation and passed again on a clean full-suite re-run (136/136, 762/762).
Timing-sensitive on a loaded host.

### N8 — `compose.test.yml`'s clickhouse-test container is permanently unhealthy (MINOR)

Its healthcheck uses `localhost` (resolving to `::1`) while the server binds IPv4 only — the
exact issue already fixed in `docker-compose.yml` via `127.0.0.1` plus `listen-ipv4.xml`, never
back-ported to the test compose file. The service is functional (integration and isolation
suites pass against it) but reports unhealthy forever.

---

## 4. Test hygiene

- Test data created during this run and left in place on the disposable local stack: connector
  "RV Mock Backend" plus its 4 discovered tools, agent definition "RV Support Agent" plus one
  seeded Production version, one Tier-3 tool-permission rule on `close_account`, and several
  demo conversations/escalations. Left deliberately so the evidence above is inspectable.
- The accidental "RBAC probe" connector created by the RBAC write-probe was deleted.
- The QA compose override and test CA were deleted; web/gateway/worker were recreated from the
  unmodified documented compose config and re-verified healthy.
- Nothing was pointed at any production environment.

---

## 5. Verdict

**PASS — ready to report the pipeline complete.**

All four blocking defects are genuinely fixed and were re-verified live against the real
docker-compose stack, not just in tests:

- **B1** — watched a brand-new connector transition Offline -> Connected under the real
  health-check worker against a real MCP container, then made a real tool call through it with
  no `connector_offline` denial.
- **B2** — the deployed stack's own empty-string `AI_*` vars no longer break startup, and
  `.env.docker` values genuinely reach the container; a real customer message got a real
  AI-reasoned reply.
- **B3** — the Console's own embed snippet, pasted verbatim into a third-party static page on a
  separate origin, mounts and works.
- **B4** — login, connector create, permission-rule change, Tier-3 approve and reject, and
  escalation claim all produce audit rows attributed to the real acting user.

S2 and S3 are fully fixed. S1 is substantially fixed — traces, spans and the Trace Viewer are
real for the first time in this build — but its cost/token half (D1) is still empty, and the fix
is not reachable on a fresh deployment without external Git (N1).

The full regression sweep found no new blocking defects: the whole MVP loop, RBAC, tenant
isolation, credential vault, audit append-only and PII masking all hold, and the static-analysis
gates are clean.

**Recommendation:** advance. D1, N1 and the minor items warrant a tracked follow-up, but none of
them blocks a requirement this gate is enforcing.
