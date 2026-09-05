// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../../store.js";
import { ConfirmationBubble } from "./ConfirmationBubble.js";
import { confirmToolCall, WidgetApiError } from "../../api.js";
import type * as ApiModule from "../../api.js";

vi.mock("../../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, confirmToolCall: vi.fn() };
});

const mockedConfirm = vi.mocked(confirmToolCall);

describe("ConfirmationBubble (A.2.10, Tier-2 — Phase 14/BL-08)", () => {
  const payload = {
    contentType: "Confirmation" as const,
    toolCallId: "tc-1",
    title: "Confirm: issue_refund",
    summary: [{ label: "amount", value: "42" }],
    disclaimer: "Please review before confirming.",
    state: "pending" as const,
  };

  beforeEach(() => {
    useWidgetStore.setState({ sessionToken: "sess-token" });
    mockedConfirm.mockReset();
  });
  afterEach(() => cleanup());

  it("renders the dynamically-populated summary, disclaimer, and both actions while pending", () => {
    render(<ConfirmationBubble payload={payload} />);
    expect(screen.getByText("Confirm: issue_refund")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Please review before confirming.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("Cancel calls the API and transitions to the cancelled state, hiding the buttons", async () => {
    mockedConfirm.mockResolvedValue({ toolCallId: "tc-1", status: "Cancelled" });
    render(<ConfirmationBubble payload={payload} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.getByText("Cancelled.")).toBeInTheDocument());
    expect(mockedConfirm).toHaveBeenCalledWith("sess-token", "tc-1", "Cancel");
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("Confirm calls the API and transitions to the confirmed state", async () => {
    mockedConfirm.mockResolvedValue({ toolCallId: "tc-1", status: "Executing" });
    render(<ConfirmationBubble payload={payload} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByText("Confirmed — processing…")).toBeInTheDocument());
    expect(mockedConfirm).toHaveBeenCalledWith("sess-token", "tc-1", "Confirm");
  });

  it("a 410 (expired) response renders the expired state instead of a generic error", async () => {
    mockedConfirm.mockRejectedValue(new WidgetApiError(410, "This request has expired."));
    render(<ConfirmationBubble payload={payload} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByText("This request has expired.")).toBeInTheDocument());
  });

  it("renders the cancelled state directly when the message's own persisted state is already terminal (e.g. history reload)", () => {
    render(<ConfirmationBubble payload={{ ...payload, state: "cancelled" }} />);
    expect(screen.getByText("Cancelled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });
});
