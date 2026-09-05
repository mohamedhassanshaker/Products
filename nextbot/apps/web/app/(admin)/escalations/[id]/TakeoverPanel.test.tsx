// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { TakeoverPanel } from "./TakeoverPanel.js";

/** Opens a shadcn/Base UI `Select` by its trigger's accessible name, then clicks
 * the option with the given visible text — the Batch A/B/C (Plan Phase 2)
 * equivalent of the old native-`<select>` `fireEvent.change`, since Base UI's
 * `Select` is a listbox, not a native form control. */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

const DETAIL = {
  id: "esc-1",
  conversationId: "conv-1",
  channelType: "WebWidget",
  customerIdentifier: "••••1234",
  recognizedGoal: "billing_inquiry",
  reason: "LowConfidence",
  reasonDetail: { confidence: 0.4 },
  aiContextSnapshot: { confidence: 0.4, recognizedGoal: "billing_inquiry" },
  status: "InProgress",
  queueName: "General Support",
  transcriptExcerpt: [{ sender: "Customer", text: "I have a billing question", at: "2026-08-15T10:00:00.000Z" }],
  aiAttempts: [{ toolCallId: "tc-1", toolName: "get_invoice", status: "Failed", inputArgsMasked: {}, outputMasked: null, errorMessage: "timeout" }],
  csatScore: null,
  csatComment: null,
  csatCapturedAt: null,
};

const QUEUES = [
  { id: "q1", name: "General Support" },
  { id: "q2", name: "Billing" },
];
const TICKETING_TOOLS = [{ id: "tool-case-1", name: "create_ticket", displayName: "Create Ticket" }];

/** Default routing for the panel's three GET calls (detail/queues/ticketing-tools) —
 * individual tests override with `.mockImplementation` when they need to assert on a
 * specific endpoint's payload. */
function defaultFetchJsonRouting(detail: unknown = DETAIL) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes("escalation-queues")) return Promise.resolve({ kind: "ok", data: { queues: QUEUES } });
    if (url.includes("ticketing-tools")) return Promise.resolve({ kind: "ok", data: { tools: TICKETING_TOOLS } });
    return Promise.resolve({ kind: "ok", data: detail });
  });
}

describe("TakeoverPanel (B.5.2 — Phase 16/BL-09)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    pushMock.mockReset();
    global.fetch = vi.fn();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the conversation/context/tool panels once loaded", async () => {
    defaultFetchJsonRouting();
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("I have a billing question")).toBeInTheDocument());
    expect(screen.getByText("get_invoice — Failed")).toBeInTheDocument();
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText(/Queue:\s*General Support/)).toBeInTheDocument();
  });

  it("renders AccessDeniedState on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "no access" });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Read" />);
    await waitFor(() => expect(screen.getByText(/don.t have access|access denied/i)).toBeInTheDocument());
  });

  it("sending a message posts to the messages endpoint and reloads", async () => {
    defaultFetchJsonRouting();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByLabelText("Message to customer")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Message to customer"), { target: { value: "Happy to help!" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/admin/escalations/esc-1/messages",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("Resolve & Close posts to the resolve endpoint and navigates back to the queue", async () => {
    defaultFetchJsonRouting();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "Resolved" }) });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Resolve & Close")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Resolve & Close"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/escalations"));
  });

  it("read-only users cannot see action buttons", async () => {
    defaultFetchJsonRouting();
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Read" />);
    await waitFor(() => expect(screen.getByText("I have a billing question")).toBeInTheDocument());
    expect(screen.queryByText("Resolve & Close")).not.toBeInTheDocument();
  });

  it("requesting an AI-drafted suggestion shows it as an editable, never-auto-sent suggestion (FR-AI-08)", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/draft")) return Promise.resolve({ kind: "ok", data: { draftText: "Sure, let me check that.", confidence: 0.82 } });
      if (url.includes("escalation-queues")) return Promise.resolve({ kind: "ok", data: { queues: QUEUES } });
      if (url.includes("ticketing-tools")) return Promise.resolve({ kind: "ok", data: { tools: TICKETING_TOOLS } });
      return Promise.resolve({ kind: "ok", data: DETAIL });
    });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Suggest a reply")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Suggest a reply"));
    await waitFor(() => expect(screen.getByText("Sure, let me check that.")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Use as draft"));
    expect((screen.getByLabelText("Message to customer") as HTMLTextAreaElement).value).toBe("Sure, let me check that.");
  });

  it("Target Architecture Blueprint Phase 13 (BL-45): choosing a CSAT score includes it in the Resolve & Close request body, but never blocks the button", async () => {
    defaultFetchJsonRouting();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "Resolved" }) });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "CSAT score" })).toBeInTheDocument());
    expect(screen.getByText("Resolve & Close").closest("button")).not.toBeDisabled();

    await chooseOption("CSAT score", "5 / 5");
    fireEvent.change(screen.getByLabelText("CSAT comment"), { target: { value: "Fantastic support!" } });
    fireEvent.click(screen.getByText("Resolve & Close"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/admin/escalations/esc-1/resolve",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ csatScore: 5, csatComment: "Fantastic support!" }) }),
      ),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/escalations"));
  });

  it("Target Architecture Blueprint Phase 12/13: the escalation detail view exposes 'Promote to eval case' (HarvestEvalCaseButton, previously conversation-only)", async () => {
    defaultFetchJsonRouting();
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Promote to eval case")).toBeInTheDocument());
  });

  it("Return to Bot posts to the return-to-bot endpoint and navigates back to the queue", async () => {
    defaultFetchJsonRouting();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ReturnedToBot" }) });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Return to Bot")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Return to Bot"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/escalations"));
  });

  it("shows an error alert when sending a message fails", async () => {
    defaultFetchJsonRouting();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, json: async () => ({ title: "Could not send." }) });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByLabelText("Message to customer")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Message to customer"), { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(screen.getByText("Could not send.")).toBeInTheDocument());
  });

  it("invoking a manual tool posts to the tool-calls endpoint", async () => {
    defaultFetchJsonRouting();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ outcome: "Succeeded" }) });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByLabelText("Tool ID")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Tool ID"), { target: { value: "tool-1" } });
    fireEvent.click(screen.getByText("Invoke"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/v1/admin/escalations/esc-1/tool-calls", expect.objectContaining({ method: "POST" })),
    );
  });

  it("rejects invalid JSON tool args client-side without calling the endpoint", async () => {
    defaultFetchJsonRouting();
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByLabelText("Tool ID")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Tool ID"), { target: { value: "tool-1" } });
    fireEvent.change(screen.getByLabelText("Tool args (JSON)"), { target: { value: "{not json" } });
    fireEvent.click(screen.getByText("Invoke"));
    await waitFor(() => expect(screen.getByText("Tool args must be valid JSON.")).toBeInTheDocument());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Transfer to queue posts to the reassign endpoint and navigates back to the queue (D2)", async () => {
    defaultFetchJsonRouting();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ queueId: "q2" }) });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Transfer to queue" })).toBeInTheDocument());
    await chooseOption("Transfer to queue", "Billing");
    fireEvent.click(screen.getByText("Transfer"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/admin/escalations/esc-1/reassign",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ queueId: "q2" }) }),
      ),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/escalations"));
  });

  it("Create Case posts a pre-filled manual tool trigger against the ticketing tool (D2)", async () => {
    defaultFetchJsonRouting();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ outcome: "AwaitingHumanApproval" }) });
    render(<TakeoverPanel escalationId="esc-1" permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Create Case")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create Case"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/admin/escalations/esc-1/tool-calls",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            toolId: "tool-case-1",
            args: { conversationId: "conv-1", reason: "LowConfidence", recognizedGoal: "billing_inquiry", customer: "••••1234" },
          }),
        }),
      ),
    );
  });
});
