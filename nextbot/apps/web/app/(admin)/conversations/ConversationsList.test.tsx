// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ConversationsList } from "./ConversationsList.js";

const SAMPLE_ITEM = {
  id: "conv-1",
  channelId: "chan-1",
  channelType: "WebWidget",
  status: "Resolved",
  recognizedGoal: "order_status",
  resolutionType: "AI",
  language: "en",
  startedAt: "2026-08-15T10:00:00.000Z",
  endedAt: "2026-08-15T10:05:00.000Z",
  totalCostUsd: "0.0042",
  customerIdentifier: "customer-98765",
  lastMessagePreview: "Your order shipped.",
};

describe("ConversationsList (Phase 13, BL-06, screen inventory B.4.1)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the full-page access-denied state on a 403, not an empty list", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<ConversationsList permissionLevel="None" />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("renders the genuinely-empty state (no filters active) distinct from a filtered-to-zero state", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { items: [], total: 0 } });
    render(<ConversationsList permissionLevel="Read" />);
    expect(await screen.findByText(/no conversations yet/i)).toBeInTheDocument();
  });

  it("renders conversation rows with a working trace link", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { items: [SAMPLE_ITEM], total: 1 } });
    render(<ConversationsList permissionLevel="Read" />);
    await screen.findByText("order_status");
    expect(screen.getAllByText("Resolved").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View trace" })).toHaveAttribute("href", "/conversations/conv-1");
  });

  it("surfaces a non-forbidden fetch error inline rather than silently rendering empty", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 500, message: "Something went wrong. Please try again." });
    render(<ConversationsList permissionLevel="Read" />);
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("exposes CSV and JSON export links", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { items: [SAMPLE_ITEM], total: 1 } });
    render(<ConversationsList permissionLevel="Read" />);
    await screen.findByText("order_status");
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", expect.stringContaining("format=csv"));
    expect(screen.getByRole("link", { name: "Export JSON" })).toHaveAttribute("href", expect.stringContaining("format=json"));
  });

  it("renders the masked customer identifier, last-message preview, and duration/resolution columns (U2 fix)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { items: [SAMPLE_ITEM], total: 1 } });
    render(<ConversationsList permissionLevel="Read" />);
    await screen.findByText("order_status");
    expect(screen.getByText("••••8765")).toBeInTheDocument();
    expect(screen.getByText("Your order shipped.")).toBeInTheDocument();
    expect(screen.getAllByText("AI").length).toBeGreaterThan(0);
    expect(screen.getByText("5m 0s")).toBeInTheDocument();
  });

  it("supports row selection and a bulk archive action (U6 fix)", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/admin/conversations/bulk")) {
        return Promise.resolve({ kind: "ok", data: { updated: 1 } });
      }
      return Promise.resolve({ kind: "ok", data: { items: [SAMPLE_ITEM], total: 1 } });
    });
    render(<ConversationsList permissionLevel="Read" />);
    await screen.findByText("order_status");

    const rowCheckbox = screen.getByRole("checkbox", { name: /select conversation conv-1/i });
    fireEvent.click(rowCheckbox);
    expect(await screen.findByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText(/archived 1 conversation/i)).toBeInTheDocument();
  });
});
