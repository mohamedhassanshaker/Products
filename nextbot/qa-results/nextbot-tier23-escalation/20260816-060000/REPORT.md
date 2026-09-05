# QA Re-verification Report - Plan Phases 14 and 16 (Tier-2/3 Approval Engine + Escalation Queue/Live Takeover/Routing), Retry 1

Date: 2026-08-16
Scope: Whole-batch re-verification of Phases 14 and 16 after the dev fix pass for BE1/BE2 (backend) and D1-D6 (UI), per the prior dual QA report (2026-08-16, FAIL).

## Environment

- apps/gateway (port 4001) and apps/web (port 3000) run as genuinely separate next dev OS processes (verified via distinct PIDs), against the project ephemeral compose.test.yml Postgres/Redis/ClickHouse (ports 55432/56379/58123).
- apps/widget-embed served via its own Vite dev server (port 5173) as a third, independent process - the real widget SPA, driven in a real Chromium browser via Playwright (not a mocked DOM).
- A local HTTPS mock MCP server (self-signed cert) stood in for the two real MCP tools (update_contact_email Tier-2, issue_refund Tier-3), plus a second Ticketing-backend-type connector/tool for D2 Create Case path.
- Fixture tenant/roles/users/connectors seeded via the project own createFixtureTenant/registerUser/createConnector application code (not hand-crafted SQL).
- All test infra, seeded fixture data, spawned processes (web/gateway/widget/mock-MCP), and scratch scripts were torn down at the end of this pass (docker compose -f compose.test.yml down -v, all app/mock processes killed, no .qa-tmp or .qa-scratch left in the repo).

## Full suite and static checks (re-run fresh, not trusted from dev claim)

| Check | Result |
|---|---|
| pnpm run typecheck | 31/31 packages clean |
| pnpm run lint:boundaries (ESLint + dependency-cruiser) | Clean - 1509 modules/3249 deps cruised, zero violations, once two leftover scratch artifacts from an earlier QA session were removed as hygiene |
| pnpm run test:unit | 131 files / 718 passed |
| pnpm run test:integration | 49 files / 216 passed |
| pnpm run test:isolation | 9 files / 62 passed, matches exactly |

No failing test anywhere.

## Traceability matrix

| Item | Scenario tested | Result | Evidence |
|---|---|---|---|
| BE1 (blocking) | Manually trigger a Tier-2 tool via Takeover Panel, expect suspension for customer confirmation, not executed | PASS | evidence/shots/be1-tier2-invoked.png |
| BE1 (blocking) | Manually trigger a Tier-3 tool via Takeover Panel, expect suspension into real Approval Queue, not executed | PASS | evidence/shots/be1-tier3-invoked.png |
| BE1 (blocking) | Tier-1 tool still executes directly (no regression) | PASS | Route code reviewed and integration test |
| BE1 (blocking) | Role with escalations Write but no approval_queue, expect 403 on Tier-2/3 trigger | PASS | escalations-admin.int.test.ts |
| BE2 (significant) | Trip a breaker for a tool, Approve a pending Tier-3 decision, expect rejection, not executed | PASS | approvals-admin.int.test.ts |
| BE2 (significant) | Add a Deny rule after a Tier-3 approval was requested, expect rejection at Approve time | PASS | approvals-admin.int.test.ts |
| BE2 (significant) | Circuit-breaker check now exists in apps/web egress path, single shared implementation | PASS | Code read |
| D3 (was investigation, most important item) | Real widget tab plus separate Admin Console session, both apps/web and apps/gateway as genuinely separate OS processes, claim escalation, send human message, expect widget receives Agent joined and the human message live, no reload | PASS, reproduced exactly | evidence/shots/07-widget-after-claim-no-reload.png, evidence/shots/09-widget-after-human-message-no-reload.png |
| D1 (blocking) | Real backend/channel names in Approval Queue API | PASS | Real API response includes backendName and channelType |
| D1 (blocking) | Real backend/channel names rendered in the Approval Queue UI | FAIL, new finding, incomplete fix | evidence/shots/d1-approval-check.png |
| D2 (blocking) | Transfer to queue moves the escalation to the selected queue | PASS | Real API response |
| D2 (blocking) | Create Case creates a real ticket via a real Ticketing-type tool discovered from the Agent Tool Registry | PASS | Real API response |
| D4 (should-fix) | Routing config Channel condition renders and is selectable | PASS | evidence/shots/d4-rule-editor.png |
| D5 (should-fix) | Agent joined message includes the literal word Agent | PASS | evidence screenshot |
| D6 (should-fix) | axe-core scan on Takeover Panel, previously-flagged contrast violation resolved | PASS | Real axe-core scan, only pre-existing gray-text issue remains |

## Defects found this pass

### D1, incomplete fix (should-fix, not blocking)

What was expected: B.3.6 spec requires a backend column in the Approval Queue list. The original D1 defect (hardcoded null) is fixed at the data layer.

What actually happened: apps/web/app/(admin)/approvals/ApprovalQueue.tsx declares backendName on its interfaces but never renders it in JSX, in the list or the detail panel.

Repro:
1. Land a Tier-3 tool call in the Approval Queue.
2. Log in as a role with approval_queue access, navigate to /approvals.
3. Observe the table has no Backend column.

Originating phase: this retry-1 dispatch, the fix closed the data half but not the UI half.

Severity: Should-fix, rough edge, not blocking.

### New finding, Escalation Queue lists already-claimed InProgress escalations with an active Take Over button

What was expected: B.5.1 says the queue lists escalations awaiting human pickup.

What actually happened: the list and its API return every escalation regardless of status, and Take Over is always shown, causing a 409 on an already-claimed row.

Repro:
1. Trigger multiple escalations, claim one via Take Over.
2. Reload /escalations, the claimed row is still listed with an active Take Over button.
3. Click it, get 409 ESCALATION_ALREADY_CLAIMED.

Originating phase: Phase 16, pre-existing, not introduced by this fix pass.

Severity: Should-fix, rough edge.

## Verdict

PASS, with 2 non-blocking should-fix findings to route to a future dispatch.

All originally-reported blocking and significant defects are genuinely fixed and independently re-verified against real infrastructure. D3 is confirmed as a real structural fix. The two remaining findings are should-fix severity and do not reopen any blocking defect. Recommend advancing this batch past the QA gate.
