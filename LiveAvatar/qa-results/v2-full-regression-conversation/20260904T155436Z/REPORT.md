# QA Report — v2 Full Regression, Conversation App (Precall / Call / Summary + Phase 14 HITL)

- **Date:** 2026-09-04
- **Scope:** `apps/web/projects/conversation` (`features/precall`, `features/call`, `features/summary`) against the real `apps/api` backend and a real disposable LiveKit server, including the two new Phase 14 HITL caller-hold-UX states (`hitlHold` / `hitlDeferredOutcome` in `core/livekit-room.service.ts`).
- **Verdict: PASS-WITH-CAVEATS** — no blocking defect; 4 non-blocking defects (1 new accessibility defect, 1 new marginal color-contrast defect, 1 re-confirmed pre-existing color-contrast defect, 1 low-severity layout collision). The two Phase 14 HITL UI states are correctly implemented but not reachable through any real production flow yet because the Python agent does not publish the message they listen for (independently verified via `grep`, not assumed).

Screenshots: `screenshots/` subfolder of this same directory, 27 PNGs.

## 1. Environment

Disposable `qa-v2-conv`-prefixed stack, run alongside two other agents' own `qa-v2-core`/`qa-v2-builder` stacks in the same repo checkout (confirmed via `docker ps` before starting, to avoid collisions).

| Component | How it ran |
|---|---|
| Postgres 16 (+pgvector) | disposable `qa-v2-conv-pg`, `pgvector/pgvector:pg16`, `127.0.0.1:25810`. All 9 committed migrations applied via real `prisma migrate deploy` (incl. `20260904110121_hitl_phase14`, `20260904131732_subagent_handoff_state_phase15`) — clean, zero drift |
| Redis 7 | disposable `qa-v2-conv-redis`, `127.0.0.1:25811` |
| LiveKit | disposable `qa-v2-conv-lk`, `livekit/livekit-server:latest --dev`, ports `25812`(ws)/`25813`(rtc-tcp)/`25814`(rtc-udp) |
| Control plane (public) | real `node dist/main.js` (existing shared build from the same unmodified checkout, reused rather than rebuilt to avoid racing the parallel agents' own builds), `http://127.0.0.1:25820`, all config passed as process env vars only — no shared `.env` file touched |
| Control plane (internal) | real `node dist/main-internal.js`, `http://127.0.0.1:25821` |
| Conversation SPA | real `ng serve conversation --port 25830`, scratchpad-only `--proxy-config`, `http://localhost:25830/c/` (matches the real `servePath: "/c/"`) |
| Browser | Playwright 1.62.1/Chromium, one-off scratchpad install. Desktop 1280×900, phone 375×812 (`isMobile`, `hasTouch`, `deviceScaleFactor:2`, iOS UA) |
| Accessibility | `axe-core` 4.x, one-off scratchpad install, run live in-page |
| Python agent | not run — see §3 |

**Seeded data**, all through real HTTP calls, never direct DB writes: admin operator via `POST /api/auth/seed`+login; tenant `qa-conv-demo` with 5 real provider-credential rows and a full agent-config (adapted from the repo's own `apps/agent/fixtures/agent-config/valid/single-llm-node.yaml`) published via real `PUT /tenants/:id/config` with a real `If-Match` header (Gate A+B genuinely passed); `qa-conv-paused` (paused) and `qa-conv-incomplete` (draft-only) for negative paths; 3 real sessions minted via real `POST /api/public/sessions`; transcript+summary seeded via the real `InternalTokenGuard`-protected `/internal/sessions/:id/utterances` and `/internal/sessions/:id/summary` — standing in for the Python agent, which now genuinely calls these same endpoints in production, but could not be run live here.

**Honest disclosure of what could/couldn't be live-tested:**
1. No real STT/LLM/TTS/avatar vendor credentials exist in this sandbox — identical disclosed limitation to every prior full-regression pass in this project (`qa-results/final-review/frontend-golden-path/REPORT.md` §7).
2. The Python agent worker was not run — no avatar video, no live captions, no agent-generated summary. The call screen genuinely reaches LiveKit (real WS handshake, real WebRTC, real data channel) but stays in its documented "Still connecting you to your avatar…" / "Captions unavailable." state, exactly as spec'd for this condition.
3. Transcript/summary for the summary screen were seeded through the real internal endpoints, not fabricated client-side or written directly to the DB.
4. A real second LiveKit participant (no AI agent) was connected into the same room a real caller joined, using a token minted with the same `AccessToken` construction `apps/api`'s `livekit-client.adapter.ts` uses — real evidence the transport layer works independent of any agent.
5. The two HITL UI states were triggered synthetically (§3) — real data-channel delivery, but originated by QA tooling standing in for the agent, which doesn't publish it yet.

Fully torn down at the end: all 3 containers removed, all 4 processes killed, all throwaway helper scripts deleted. Nothing left running or modified in the shared checkout.

## 2. Requirements traced (docs/PRODUCT_SPECIFICATION.md FR-CALL-1..5/FR-AUTH-4, docs/design/UX_GUIDELINES.md §11/§12/§18, docs/v2/AgentBuilder_..._HITL.md §A8.7 R-H5/R-H9)

| Requirement | Scenario | Result | Evidence |
|---|---|---|---|
| FR-CALL-1 golden path | Desktop+mobile join → real token → call screen | PASS | `01,02,21` |
| FR-CALL-1 unknown slug / paused / config-incomplete | Generic "not available" copy, Join disabled where applicable | PASS | `04,05,06` |
| FR-CALL-1 `CALL_MIC_DENIED` | getUserMedia rejects → exact sentence, stays on screen | PASS | `26` |
| FR-CALL-1 `TRANSPORT_UNAVAILABLE` + retry | Real LiveKit container stopped → live 503 → restarted → Retry genuinely recovers | PASS | `27,28` |
| FR-CALL-2 real LiveKit connection | Real session → real room → real `Room.connect()` | PASS | `07,08,22` |
| FR-CALL-2 mute/captions/end-call | Live toggles; End call → real `/sessions/:id/end` → real `summary_token` → summary screen | PASS | `09,10,15` |
| FR-AVATAR-5 15s wait banner | No avatar attaches → banner after 15s, not before | PASS | `08` |
| FR-CALL-3 captions fallback | No STT → "Captions unavailable." never an empty box | PASS | `08,11-14` |
| Two-way transport | Independent 2nd participant joined same real room, published real track | PASS | `24,25`; server `listParticipants`=2 active, 1 track each |
| R-H5 (told what/how-long, silence never acceptable) | Synthetic `hold_start`/`hold_end` → "Getting approval" card + progress bar renders/clears correctly | Code path PASS; not reachable live (§3) | `11,12,13` |
| R-H9 (deferred approval survives call, caller notified) | Synthetic `deferred_outcome` → outcome banner renders | Code path PASS; not reachable live (§3) | `14` |
| FR-CALL-4 summary+transcript render | Real seeded 5-turn transcript+summary from real `GET .../summary` | PASS | `15` |
| FR-CALL-4 feedback golden path | 5-star+comment → real `POST .../feedback` 201 → confirmation | PASS | `16,17` |
| FR-CALL-4 reload persists confirmation (phase7 D-2 regression) | Reload after submit → confirmation stays, form not re-shown | PASS, fix still holds | `18` |
| FR-CALL-5 forged/foreign token, unknown session | Generic "expired" copy both ways, no data leak | PASS | `19,20`; 401/404 |
| Phone-width (375px), all 3 screens | `scrollWidth` measured, not eyeballed | 0px overflow, all 3 | `21,22,23` |
| Console/network hygiene | Full golden-path walkthrough | Zero unexpected errors | `run-diagnostics.json` |

## 3. HITL (Phase 14) — verified, not assumed

`grep -rn "publish_data|topic.*hitl|hold_start|deferred_outcome" apps/agent/src/avatar_agent` → zero matches. `orchestration/graph/nodes/hitl.py`'s `HitlNodeExecutor` only calls `ctx.speak(created.hold_treatment_text)` — the existing speech path — never a data-channel publish. The plan doc's own disclosed gap is confirmed still open.

The frontend code path was confirmed genuinely wired by publishing the exact documented JSON payloads (`{type:'hold_start',message,sla_seconds}` / `{type:'hold_end'}` / `{type:'deferred_outcome',message}`) on the exact documented `topic:'hitl'`, via a real LiveKit server-side `RoomServiceClient.sendData()` call targeting the room a real browser caller had already joined — genuine WebRTC data-channel delivery, synthetically originated by QA tooling standing in for the agent. Both states rendered exactly as coded, zero console errors. Screenshots `11`-`14` are safe to reuse for the user guide but should be captioned "feature preview," since no real call can reach them yet.

## 4. Defects (none blocking)

**D-1 (Moderate, new)** — Summary transcript's `<ul role="log">` (`summary-page.component.html:32`) overrides the list's implicit ARIA role, orphaning all 5 `<li>` rows (axe `listitem`, serious). Fix: move `log`/live-region semantics to a wrapping `<div role="log">` and let the `<ul>` keep native list semantics.

**D-2 (Low-Moderate, new)** — `.la-summary__confirmation` ("Thanks for your feedback.") is `#1e8e3e` on white = 4.2:1, below the 4.5:1 AA threshold.

**D-3 (Moderate, re-confirmed pre-existing)** — Precall Join/Retry button still `#ffffff` on `#4c8dff` = 3.2:1, same defect as `final-review/frontend-golden-path` D-3, still unfixed.

**D-4 (Low, new)** — The HITL "Getting approval" card and the avatar-wait pill share `.la-call__banner`'s identical `top:16px;left:50%` anchor with no offset coordination; since `waitingForAvatar()` and `hitlHold()` are independent signals, both can legitimately be true at once (a gate can open before any avatar ever attaches), causing visible overlap (screenshot `11`). The HITL card's own text stays legible; the redundant status pill behind it does not.

**Observation (not a defect):** mic-denied alert and the idle-state hint render simultaneously — mildly redundant, not incorrect.

## 5. Verdict

**PASS-WITH-CAVEATS.** Precall, call, and summary all function correctly against a real backend, real LiveKit, and real seeded data at both desktop and 375px, with zero unexpected console/network errors across the full golden path, and the phase7 reload-persistence fix still holds. The two Phase 14 HITL states are correctly implemented and render exactly as designed once triggered, but cannot currently be reached by any real call because the Python agent doesn't yet publish the data-channel message they depend on — a feature-completeness gap to close in a follow-up phase, not a frontend regression.
