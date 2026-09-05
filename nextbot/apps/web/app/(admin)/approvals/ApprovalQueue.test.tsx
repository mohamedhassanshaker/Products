// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ApprovalQueue } from "./ApprovalQueue.js";

const QUEUE_ITEM = {
  id: "appr-1",
  toolCallId: "tc-1",
  conversationId: "conv-1",
  toolName: "issue_refund",
  backendName: "Refunds Backend",
  actionSummary: "Call issue_refund on Refunds Backend",
  channelType: "WebWidget",
  requestedAt: "2026-08-15T10:00:00.000Z",
  waitSeconds: 120,
  status: "AwaitingHumanApproval",
};

const DETAIL = {
  ...QUEUE_ITEM,
  inputArgsMasked: { amount: "42" },
  riskSummary: {},
  transcriptExcerpt: [{ sender: "Customer", text: "Please refund my order", at: "2026-08-15T09:59:00.000Z" }],
  recognizedGoal: "issue_refund",
  customerIdentifier: "cust-12345",
};

describe("ApprovalQueue (B.3.6 — Phase 14/BL-08)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    global.fetch = vi.fn();
    global.crypto.randomUUID = vi.fn().mockReturnValue("00000000-0000-7000-8000-000000000000") as unknown as typeof crypto.randomUUID;
  });
  afterEach(() => cleanup());

  it("renders the pending queue list", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { items: [QUEUE_ITEM] } });
    render(<ApprovalQueue permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("issue_refund")).toBeInTheDocument());
  });

  // QA Final Review minor item: Backend/action-summary columns were still
  // missing from an already-known incomplete fix.
  it("renders the Backend and Action columns (QA Final Review minor fix)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { items: [QUEUE_ITEM] } });
    render(<ApprovalQueue permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Refunds Backend")).toBeInTheDocument());
    expect(screen.getByText("Call issue_refund on Refunds Backend")).toBeInTheDocument();
  });

  it("renders AccessDeniedState on a 403", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "forbidden", message: "no access" });
    render(<ApprovalQueue permissionLevel="Read" />);
    await waitFor(() => expect(screen.getByText("You don't have access to this section")).toBeInTheDocument());
  });

  it("selecting a row loads the detail panel with masked args and transcript", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { items: [QUEUE_ITEM] } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: DETAIL });
    render(<ApprovalQueue permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByTestId("approval-row-appr-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("approval-row-appr-1"));
    await waitFor(() => expect(screen.getByText(/"amount": "42"/)).toBeInTheDocument());
    expect(screen.getByText(/Please refund my order/)).toBeInTheDocument();
  });

  it("Reject without a note is blocked client-side with an error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { items: [QUEUE_ITEM] } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: DETAIL });
    render(<ApprovalQueue permissionLevel="Write" />);
    fireEvent.click(await screen.findByTestId("approval-row-appr-1"));
    await screen.findByRole("button", { name: "Reject" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByText(/A note is required/)).toBeInTheDocument());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Approve posts a decision with an Idempotency-Key and reloads the queue", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { items: [QUEUE_ITEM] } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: DETAIL });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { items: [] } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ toolCallId: "tc-1", status: "Executing" }) });

    render(<ApprovalQueue permissionLevel="Write" />);
    fireEvent.click(await screen.findByTestId("approval-row-appr-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/v1/admin/approvals/tc-1/decision", expect.objectContaining({ method: "POST" })));
    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((callArgs[1] as RequestInit).headers).toMatchObject({ "idempotency-key": expect.any(String) });
  });

  it("read-only permission hides the decision actions", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { items: [QUEUE_ITEM] } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: DETAIL });
    render(<ApprovalQueue permissionLevel="Read" />);
    fireEvent.click(await screen.findByTestId("approval-row-appr-1"));
    await waitFor(() => expect(screen.getByText(/read-only access/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
