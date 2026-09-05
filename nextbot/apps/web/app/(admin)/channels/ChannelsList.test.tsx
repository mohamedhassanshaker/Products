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
vi.mock("../../../src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ChannelsList } from "./ChannelsList.js";

describe("ChannelsList (BL-04 prerequisite screen)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the full-page access-denied state on a 403, not an empty list", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<ChannelsList permissionLevel="None" />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("renders the genuinely-empty state only on a real empty ok response", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { channels: [], tenantSlug: "acme" } });
    render(<ChannelsList permissionLevel="Write" />);
    expect(await screen.findByText(/no channels yet/i)).toBeInTheDocument();
  });

  it("disables Add Web Widget Channel for a Read-only caller", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { channels: [{ id: "c1", type: "WebWidget", name: "Main", environment: "Sandbox", status: "Active", publicKey: "wc_1" }], tenantSlug: "acme", widgetBaseUrl: "http://localhost:8080" },
    });
    render(<ChannelsList permissionLevel="Read" />);
    await screen.findByText("Main");
    expect(screen.getByRole("button", { name: "+ Add Channel" })).toBeDisabled();
  });

  it("renders Add Web Widget Channel as a working link for Write", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { channels: [{ id: "c1", type: "WebWidget", name: "Main", environment: "Sandbox", status: "Active", publicKey: "wc_1" }], tenantSlug: "acme", widgetBaseUrl: "http://localhost:8080" },
    });
    render(<ChannelsList permissionLevel="Write" />);
    await screen.findByText("Main");
    expect(screen.getByRole("link", { name: "+ Add Channel" })).toHaveAttribute("href", "/channels/new");
  });

  it("reveals the embed snippet with the real tenant slug + channel public key on toggle", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: {
        channels: [{ id: "c1", type: "WebWidget", name: "Main", environment: "Sandbox", status: "Active", publicKey: "wc_abc123" }],
        tenantSlug: "acme",
        widgetBaseUrl: "http://localhost:8080",
      },
    });
    render(<ChannelsList permissionLevel="Write" />);
    await screen.findByText("Main");

    screen.getByRole("button", { name: /get embed snippet/i }).click();
    expect(await screen.findByText(/tenantId: "acme"/)).toBeInTheDocument();
    expect(screen.getByText(/channelId: "wc_abc123"/)).toBeInTheDocument();
  });

  it("renders a real, working script src (QA Final Review B3: no fake CDN host, correct /loader/ path)", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: {
        channels: [{ id: "c1", type: "WebWidget", name: "Main", environment: "Sandbox", status: "Active", publicKey: "wc_abc123" }],
        tenantSlug: "acme",
        widgetBaseUrl: "http://localhost:8080",
      },
    });
    render(<ChannelsList permissionLevel="Write" />);
    await screen.findByText("Main");

    screen.getByRole("button", { name: /get embed snippet/i }).click();
    expect(await screen.findByText(/http:\/\/localhost:8080\/loader\/nextbot\.js/)).toBeInTheDocument();
    // The global entry point the snippet calls must match what
    // `apps/widget-embed/src/loader/nextbot-loader.ts` actually exposes
    // (`window.NextBot = { init }`).
    expect(screen.getByText(/NextBot\.init\(/)).toBeInTheDocument();
  });

  it("Phase 6: renders a 'Test this channel' link for a WebWidget row, pointing at /channels/:id/test", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: {
        channels: [{ id: "c1", type: "WebWidget", name: "Main", environment: "Sandbox", status: "Active", publicKey: "wc_abc123" }],
        tenantSlug: "acme",
        widgetBaseUrl: "http://localhost:8080",
      },
    });
    render(<ChannelsList permissionLevel="Read" />);
    await screen.findByText("Main");
    expect(screen.getByRole("link", { name: /test this channel/i })).toHaveAttribute("href", "/channels/c1/test");
  });

  it("Phase 6: does not render 'Test this channel' for a non-WebWidget row", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: {
        channels: [{ id: "c2", type: "WhatsApp", name: "WA Main", environment: "Production", status: "Active", publicKey: "wc_wa1" }],
        tenantSlug: "acme",
        widgetBaseUrl: "http://localhost:8080",
      },
    });
    render(<ChannelsList permissionLevel="Read" />);
    await screen.findByText("WA Main");
    expect(screen.queryByRole("link", { name: /test this channel/i })).not.toBeInTheDocument();
  });
});
