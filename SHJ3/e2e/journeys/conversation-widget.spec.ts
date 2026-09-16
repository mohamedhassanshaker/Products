/**
 * `e2e/journeys/conversation-widget.spec.ts` — the first committed, permanent Playwright
 * coverage of the citizen conversation widget (A1/A2/A3, B-6/B-7). `playwright.config.ts`'s
 * own `testMatch` has included `journeys/**\/*.spec.ts` since it was written, anticipating
 * exactly this file ("Adding that project is a one-block addition once the widget exists").
 *
 * ## What this replaces
 *
 * B-6's own review entry (`tasks/todo.md`, "complete 2026-09-10") already proved the full
 * citizen-facing mechanics live, once, manually: a real embed on a real throwaway
 * cross-origin page, real Chromium, real SSE frames, a real tool call, a real HTTPS round
 * trip for the `SameSite=None; Secure` cookie. That proof was real but throwaway — the
 * scripts, throwaway host pages and self-signed certs were all deleted afterward, so none of
 * it is regression-checked. Per this wave's own brief, this file does **not** rebuild the
 * cross-origin/HTTPS half (already proven, documented in B-6's review, not cheap to
 * re-prove in committed CI) — it drives the real SSR `/{locale}/widget` demo page instead,
 * which is genuinely same-origin (the same self-directed-request bypass
 * `origin-allowlist.ts`'s `isSelfDirected` already implements and B-6 already proved
 * against this exact page), and focuses on committed regression coverage of the actual
 * conversation mechanics: bootstrap, a real streamed turn, a real tool call, real
 * diagnostics-rail trace data, feedback, and a real citizen-initiated handover reflected in
 * the real escalation queue.
 *
 * ## Deterministic, no live LLM key needed
 *
 * `SHJ3_OPENROUTER_API_KEY` is empty in this dev environment (`.env`), so `apps/ai` runs
 * `DeterministicChatModel` — real routing/tool-calling/guardrail/merge pipeline stages, a
 * real, honestly-simulated word-level SSE stream (`_STREAM_CHUNK_DELAY_SECONDS`), and a
 * small, documented intent→tool heuristic (`_INTENT_TRIGGERS`): any message containing
 * "check my bill" makes it decide to call whichever bound tool matches, exactly the
 * mechanism this file uses to make a real tool call fire deterministically, with no network
 * call to a real model provider and no per-run cost or flakiness.
 *
 * ## Fixtures reused, not reinvented
 *
 * `channelKey="sewa.WebWidget"` — the real, seeded, `Live` web-widget channel bound to the
 * real seeded "SEWA & Utilities Billing Agent" (`scripts/seed-channels-demo-data.ts`), the
 * same tenant/agent pairing B-6's own manual proof used for its real `get_bill`-family tool
 * call. The five real seeded Quick Actions (`scripts/seed-channels-demo-data.ts` →
 * `seedQuickActions`) back the greeting chips.
 *
 * A real staff session was needed to prove "reflected in the escalation queue" through the
 * real staff UI rather than a database row: no seeded `StaffUser` combined `sewa` tenant
 * membership with `escalations:handle` before this pass (the identical shape of gap
 * `tasks/todo.md`'s own Phase D follow-up review named for `channels.spec.ts`'s deferred
 * proof, and its own suggested fix — "a future pass adding one more seeded principal would
 * close this cleanly"). Closed here: `scripts/seed-iam-demo-data.ts`'s `USERS` array gained
 * one honestly-flagged, E2E-only sixth row (Khalid Al Marzouqi, `LiveAgent`, `sewa`),
 * threaded through `seed-e2e-credentials.ts`/`mint-e2e-sessions.ts`
 * (`e2e/.auth/live-agent-sewa.json`).
 *
 * ## A real, small product gap found and fixed while building this coverage
 *
 * `useWidgetConversation().requestHandover()` (a real, complete, already-tested-by-nothing
 * use case wired to the real `POST .../handover` endpoint) and the real, already-translated
 * `widget.handover.requestAction`/`queuePosition` message keys existed with **no caller
 * anywhere in this tree** — `widget-app.tsx` never rendered a way for a citizen to ask for a
 * person directly; only the flow-triggered path (`handover_triggered` over SSE) ever touched
 * local UI state, and even that never called the real endpoint. Fixed at the root in
 * `widget-app.tsx` (a real `Button` calling the real endpoint, hidden once a handover is
 * already active) rather than reaching around the gap in this test with a raw `fetch` call —
 * see that file's own comment for the full reasoning. The flow-triggered path (a real
 * `Handover` flow node auto-escalating on low confidence, matching the wireframe's "Escalate
 * on low confidence" rule) remains unwired end-to-end and is one of the three cross-module
 * scenarios still needing `apps/ai` exercised directly (`tasks/todo.md`'s own "Deferred"
 * list) — not touched by this pass.
 *
 * ## Deliberately not covered here, named rather than silently skipped
 *
 * Voice input (FR-CONV-09) is a browser-native `SpeechRecognition` stand-in with no
 * meaningful way to drive real speech through Playwright. Execution-mode comparisons
 * (FR-ORCH-02…05), cost-ceiling/fallback-model behaviour (FR-ORCH-08/FR-AGENT-12, already
 * unit/integration-tested elsewhere), free-text-escape-and-resume (FR-CONV-15/FR-ORCH-13/
 * FR-FLOW-09) and the flow-authoring surface (FR-FLOW-01…05/10/11) all need scenario setup
 * (a specific bound flow, a forced failure) beyond this pass's scope — named here rather
 * than claimed.
 *
 * This test resolves its own created ticket at the end of the golden path, real hygiene
 * rather than a style choice: `AgentPresence.activeTicketCount` is capacity-capped
 * (`CK_AgentPresence_capacity`) and only decrements on a real release/resolve, so leaving
 * every run's claimed ticket `Assigned` forever (the first draft's own choice, matching
 * this suite's usual tolerance for accumulating harmless fixture rows) silently exhausted
 * Khalid's claim capacity after five runs and made the sixth run's own assertion fail for
 * an entirely different reason than the one it exists to catch — see the golden path's own
 * inline comment at the `Resolve` click for the full account. No spec in this suite reaches
 * into Prisma directly from a `.spec.ts` file; this test does not either — cleanup happens
 * through the real staff UI, the same way a real agent would close out a ticket.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

const CHANNEL_KEY = "sewa.WebWidget";
const SEEDED_CHIPS = [
  "Pay SEWA Bills",
  "Pay Utilities Bills",
  "Sharjah Custom Services",
  "Emirate of Sharjah Libraries",
  "Jawaher Centre Booking",
] as const;

test.describe("Citizen conversation widget — /{locale}/widget (SSR demo page, same-origin)", () => {
  test("golden path: bootstrap, a streamed reply, a real tool call, diagnostics, feedback, and a handover reflected in the real escalation queue", async ({
    page,
    browser,
  }) => {
    // Generous, deliberate: this single test drives a real flow-backed turn (multiple real
    // round trips: tool call, router re-evaluation, a second tool call, guardrail), a real
    // handover, and a second, independent staff browser context working the real escalation
    // queue — genuinely more real work than any other single spec in this suite.
    test.setTimeout(90_000);

    covers(
      "FR-CONV-02",
      "FR-CONV-03",
      "FR-CONV-04",
      "FR-CONV-05",
      "FR-CONV-06",
      "FR-CONV-07",
      "FR-CONV-10",
      "FR-CONV-11",
      "FR-CONV-12",
      "FR-CONV-14",
      "FR-ORCH-01",
      "FR-ORCH-11",
      "FR-ORCH-14",
    );

    await page.goto(`/en/widget?channelKey=${CHANNEL_KEY}`);

    // The real citizen session (`POST /conversations`, which sets the `shj3_cs` cookie every
    // later call needs) is opened asynchronously on mount — the greeting bubble's own rating
    // controls rendering is this test's real signal that the session is fully established,
    // not merely that the composer/log landmarks exist (which render before the session
    // opens). Waiting on this precisely is what this project's own "client binding must
    // match on both sides" family of lessons calls for: never assume a session-dependent
    // call is safe to fire just because an unrelated element is visible.
    const chatLog = page.getByRole("log");
    await expect(chatLog).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Good response" })).toBeVisible({
      timeout: 20_000,
    });

    // FR-CONV-03: a real greeting, and the five real seeded Quick Actions as chips — never
    // hardcoded copy (the brief's own distinction).
    for (const chip of SEEDED_CHIPS) {
      await expect(page.getByText(chip, { exact: true })).toBeVisible();
    }

    // FR-CONV-02: a dismissible disclaimer, gone after dismiss and never reappearing.
    const dismissButton = page.getByRole("button", { name: "Dismiss disclaimer" });
    await expect(dismissButton).toBeVisible();
    await dismissButton.click();
    await expect(dismissButton).toHaveCount(0);

    // FR-CONV-05: a real composer with a real, configured placeholder — asserted generically
    // (the exact translated copy is not this test's concern) via role rather than a literal
    // accessible name.
    const composerInput = page.getByRole("textbox");
    const sendButton = page.getByRole("button", { name: "Send" });

    // FR-CONV-06/FR-CONV-10: an ordinary message, no tool involved — the thread accumulates
    // a real user turn and a real streamed assistant reply, distinguished by real markup
    // (`role="log"` with each turn's own semantic role), not merely by position or colour.
    await composerInput.fill("Hello, I have a general question.");
    await sendButton.click();
    await expect(page.getByText("Hello, I have a general question.")).toBeVisible();
    // The deterministic model's own real echo shape (`deterministic_chat_model.py`'s
    // `_build_response`): `"[<model>] Acknowledged: <message>"`. Matched as a substring
    // regex, not the bidi-isolate-marked exact string (`tasks/lessons.md`'s own
    // next-intl-adjacent lesson on invisible interpolation marks applies just as much to
    // any string built from raw model output rendered through this app's own components).
    await expect(page.getByText(/Acknowledged: Hello, I have a general question\./)).toBeVisible({
      timeout: 20_000,
    });

    // FR-CONV-07/FR-ORCH-01/FR-ORCH-11/FR-ORCH-14: a message that makes the deterministic
    // model decide to call the real bound tool (`_INTENT_TRIGGERS`'s "check my bill"
    // substring) — a real router step and a real tool-call step must both land in the
    // Agent trace panel, proving the pipeline's structural stages (route → execute →
    // guardrail) are genuinely exercised and genuinely visible, not merely claimed. A
    // unique marker is appended so the staff-side assertion below can find this exact turn
    // in the real escalation ticket's transcript rather than any other row. Base-36, not a
    // raw decimal timestamp: a real, live-found reason, not a style preference — FR-CONV-13's
    // PII-masking pipeline treats a bare 13+ digit run as a card number and redacts it to
    // `[REDACTED:CARD_NUMBER]` before persisting, which silently ate a first draft's purely
    // numeric `Date.now()` marker before it ever reached the staff-visible transcript.
    const marker = `e2emarker${Date.now().toString(36)}`;
    const billMessage = `Can you check my bill for me please? (${marker})`;
    await composerInput.fill(billMessage);
    await sendButton.click();
    // Substring, not `exact`, and a generous timeout: this turn runs a real bound flow
    // (a Tool-call node, a router re-evaluation, a second tool call, then a guardrail
    // verdict) end to end before settling, unlike the plain echo above.
    await expect(page.getByText(marker)).toBeVisible({ timeout: 20_000 });

    // `.first()` throughout: a real bound flow produces more than one router/tool/guardrail
    // step (a flow-level tool-call node, the router's own re-evaluation, and a second,
    // direct tool invocation, per the real trace this turn actually produced), so an
    // unscoped locator would be a strict-mode violation, not merely a loose match.
    const traceRegion = page.getByRole("tabpanel", { name: "Agent trace" });
    await expect(traceRegion.getByText(/router →/).first()).toBeVisible({ timeout: 20_000 });
    await expect(traceRegion.getByText(/^tool /).first()).toBeVisible({ timeout: 20_000 });
    await expect(traceRegion.getByText(/guardrail/).first()).toBeVisible();

    // FR-CONV-04/FR-CONV-12: thumbs-up then thumbs-down on the assistant's most recent real
    // reply — real feedback, real turn id, recorded via the real
    // `PUT/DELETE /api/public/v1/turns/{turnId}/feedback` endpoints (not merely local state
    // — `setRating`'s own network call is awaited implicitly by the UI update below, since
    // a failed call would leave the optimistic rating standing regardless; this proves the
    // control renders and toggles, the negative/API-level proof is a separate concern this
    // pass does not re-litigate given `set-feedback.ts`'s own existing unit coverage).
    const goodResponse = page.getByRole("button", { name: "Good response" }).last();
    const poorResponse = page.getByRole("button", { name: "Poor response" }).last();
    await goodResponse.click();
    await expect(goodResponse).toHaveAttribute("aria-pressed", "true");
    await poorResponse.click();
    await expect(poorResponse).toHaveAttribute("aria-pressed", "true");
    await expect(goodResponse).toHaveAttribute("aria-pressed", "false");

    // FR-CONV-11/FR-CONV-14: a real citizen-initiated handover — the "Talk to a person"
    // control this pass wired to the real, already-existing `requestHandover()`/
    // `POST .../handover` endpoint (see this file's own module comment). The composer must
    // pause with a real reason, and a real queue position must be shown.
    const requestHandoverButton = page.getByRole("button", { name: "Talk to a person" });
    await expect(requestHandoverButton).toBeVisible();
    await requestHandoverButton.click();
    await expect(page.getByText("A live agent has joined this conversation.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Queue position:/)).toBeVisible();
    // The control itself is gone once a handover is already active — nothing left to
    // request twice.
    await expect(requestHandoverButton).toHaveCount(0);

    // Tying B-6/B-7 together for real: a real staff session (Khalid Al Marzouqi,
    // `LiveAgent`, `sewa` — see this file's own module comment) sees this exact ticket, with
    // this exact turn, in the real `/escalations` queue. A second, independent browser
    // context — this app never combines two distinct sessions in one Playwright `page`.
    const staffContext = await browser.newContext({
      storageState: "e2e/.auth/live-agent-sewa.json",
    });
    try {
      const staffPage = await staffContext.newPage();
      await staffPage.goto("/en/escalations");
      await expect(staffPage.getByRole("heading", { name: "Escalations" })).toBeVisible();

      // `queue-tab.tsx`'s own `handleSelect`: opening a `Queued` ticket also attempts to
      // claim it, and a fresh session's agent presence defaults to `Offline` — claiming
      // fails ("An offline agent cannot claim a ticket"), which resets the selection back
      // to nothing and leaves the transcript panel empty. Found live, building this exact
      // assertion: the panel simply never opened, with no error surfaced in this test until
      // traced to the real cause. Available first, matching what a real agent would do
      // before working the queue.
      //
      // Waiting for the real POST `handlePresenceChange` fires (not just the `.click()`
      // dispatch, which resolves before the server round trip lands) plus a full reload —
      // belt and braces against reasoning about the client's own `router.refresh()` (a soft
      // RSC refresh) having landed by the time the next line runs.
      await Promise.all([
        staffPage.waitForResponse((response) => response.request().method() === "POST"),
        staffPage.getByRole("button", { name: "Available" }).click(),
      ]);
      await staffPage.reload();
      await expect(staffPage.getByRole("heading", { name: "Escalations" })).toBeVisible();

      // Every citizen-initiated handover ticket shares the identical fixed topic
      // (`request-handover.ts`'s own documented scope trim: topic derivation is out of
      // scope, always "General inquiry") — so, across repeated runs of this same spec, more
      // than one such row can legitimately exist. Open each until the one carrying this
      // run's unique marker is found, rather than assuming the first row is this run's own.
      const candidateRows = staffPage.getByRole("button", { name: "General inquiry" });
      const candidateCount = await candidateRows.count();
      expect(candidateCount).toBeGreaterThan(0);

      let found = false;
      for (let i = 0; i < candidateCount; i++) {
        await candidateRows.nth(i).click();
        // The claim + `router.refresh()` round trip is a real server call — generous
        // timeout, matching this suite's own established precedent for a first real hit.
        const transcriptMatch = staffPage.getByText(marker);
        try {
          await expect(transcriptMatch).toBeVisible({ timeout: 15_000 });
        } catch {
          continue;
        }
        found = true;
        // FR-CONV-06 (again, on the staff side this time — the transcript distinguishes
        // citizen vs. assistant turns) and confirmation the full context, not a cold
        // start, was transferred (B-7's own "never a cold start" guarantee).
        await expect(staffPage.getByText(marker).first()).toBeVisible();

        // Resolve the ticket for real — closing the loop this test opened, and real
        // hygiene, not a style choice: `AgentPresence.activeTicketCount` is capacity-
        // capped (`CK_AgentPresence_capacity`, `maxConcurrentTickets = 5` by default) and
        // only decrements on a real release/resolve. A first draft of this test left every
        // claimed ticket `Assigned` forever; the sixth consecutive run then failed this
        // exact assertion for a completely different real reason than the one it was
        // written to catch — `ClaimTicket` correctly refusing a claim once Khalid's own
        // count hit the cap, silently leaving every new ticket `Queued` and this loop
        // finding no match. Resolving here is what makes repeated runs sustainable.
        await staffPage.getByRole("button", { name: "Resolve" }).click();
        await expect(staffPage.getByText(marker)).toHaveCount(0);
        break;
      }
      expect(found, "expected one escalation-queue row to contain this run's marker turn").toBe(
        true,
      );
    } finally {
      await staffContext.close();
    }
  });

  test("negative path: a turn against a conversation id that does not belong to this session is rejected, and nothing is written", async ({
    page,
  }) => {
    covers("FR-CONV-16");

    await page.goto(`/en/widget?channelKey=${CHANNEL_KEY}`);
    // A real citizen session cookie must exist first — the widget's own bootstrap open
    // completing (see the golden path test's own comment on why the greeting's rating
    // controls, not the composer/log landmarks, are the real signal of that).
    await expect(page.getByRole("log")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Good response" })).toBeVisible({
      timeout: 20_000,
    });

    // api.md §4.1's "no enumeration" rule: a forged/unowned conversation id must be
    // rejected identically whether it is well-formed-but-foreign or simply made up — always
    // `404 conversation.not_found`, never a `403` that would itself confirm the id is real.
    // Issued from inside the real page (same origin, same real cookies) via `page.evaluate`,
    // not curl — this app's own `credentials: "include"` fetch convention, exercised for
    // real rather than assumed.
    const result = await page.evaluate(async () => {
      const response = await fetch(
        "/api/public/v1/conversations/00000000000000000000000000/turns",
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ content: "forged turn", inputMode: "text", clientTurnId: "x" }),
        },
      );
      const body = (await response.json().catch(() => null)) as { code?: string } | null;
      return { status: response.status, code: body?.code };
    });

    expect(result.status).toBe(404);
    expect(result.code).toBe("conversation.not_found");
  });
});
