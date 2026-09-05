// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

import { ChannelTest } from "./ChannelTest.js";

describe("ChannelTest (Phase 6 'test this channel' screen — no sandbox override, the channel's real deployed version)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the shared preview panel for a real WebWidget channel", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { channel: { id: "c1", type: "WebWidget", name: "Main", publicKey: "wc_1" }, tenantSlug: "acme", widgetBaseUrl: "http://localhost:8080" },
    });
    render(<ChannelTest channelId="c1" />);

    expect(await screen.findByTitle("NextBot chat preview")).toBeInTheDocument();
    expect(screen.getByText(/main > test/i)).toBeInTheDocument();
  });

  it("shows an explanatory message for a non-WebWidget channel type rather than a broken iframe", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { channel: { id: "c2", type: "WhatsApp", name: "WA Main", publicKey: "wc_wa" }, tenantSlug: "acme", widgetBaseUrl: "http://localhost:8080" },
    });
    render(<ChannelTest channelId="c2" />);

    expect(await screen.findByText(/only supports web widget channels/i)).toBeInTheDocument();
    expect(screen.queryByTitle("NextBot chat preview")).not.toBeInTheDocument();
  });

  it("renders the full-page access-denied state on a 403, not a broken screen", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<ChannelTest channelId="c1" />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("shows a not-found alert for an unknown channel id", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 404, message: "not found" });
    render(<ChannelTest channelId="nope" />);
    expect(await screen.findByText(/channel not found/i)).toBeInTheDocument();
  });
});
