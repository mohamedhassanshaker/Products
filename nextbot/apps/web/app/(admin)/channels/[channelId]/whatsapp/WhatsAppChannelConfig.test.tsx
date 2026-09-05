// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("../../../../../src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { WhatsAppChannelConfig } from "./WhatsAppChannelConfig.js";

const CONNECTED_ACCOUNT = {
  id: "acc-1",
  channelId: "chan-1",
  businessId: "biz-1",
  businessName: "Acme Corp",
  wabaId: "waba-1",
  status: "Connected",
  appId: "app-1",
  systemUserTokenMaskedHint: "sk-…9fA2",
  appSecretMaskedHint: "sec-…1a2b",
  sessionWindowWarningEnabled: true,
  linkedAt: new Date().toISOString(),
  lastCheckedAt: new Date().toISOString(),
};

describe("WhatsAppChannelConfig (screen inventory B.2.3, FR-META-01 through META-13)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function mockLoad(overrides: { account?: unknown; numbers?: unknown[]; templates?: unknown[]; records?: unknown[] } = {}) {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.endsWith("/whatsapp")) {
        return Promise.resolve({ kind: "ok", data: { account: overrides.account ?? null, readiness: { ready: false, reasons: ["Connect a Meta Business Manager account."] } } });
      }
      if (url.includes("/numbers")) return Promise.resolve({ kind: "ok", data: { numbers: overrides.numbers ?? [] } });
      if (url.includes("/templates")) return Promise.resolve({ kind: "ok", data: { templates: overrides.templates ?? [] } });
      if (url.includes("/consent")) return Promise.resolve({ kind: "ok", data: { records: overrides.records ?? [] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });
  }

  it("renders the honest not-connected state with the Connect form when no account is linked", async () => {
    mockLoad({ account: null });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    expect(await screen.findByText(/connect meta business manager/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/meta business id/i)).toBeInTheDocument();
  });

  it("renders the access-denied full-page state on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={false} />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("shows the honest Connected badge with the real business name + id once linked, never fakes a connection", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("biz-1")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("shows the exact FR-META-01 rejection copy in the WABA tab's explanatory text", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /waba & numbers/i }));
    expect(await screen.findByText(/This message requires an approved WhatsApp template outside the 24-hour session window/)).toBeInTheDocument();
  });

  it("shows the phone number list with a non-color-only verification status badge", async () => {
    mockLoad({
      account: CONNECTED_ACCOUNT,
      numbers: [{ id: "n1", phoneNumberId: "pn-1", e164: "+15551234567", displayName: "Support", verificationStatus: "Verified", messagingTier: "Tier2", qualityRating: null }],
    });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /waba & numbers/i }));
    expect(await screen.findByText("+15551234567")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Tier 2")).toBeInTheDocument();
  });

  it("shows the empty templates state with the Sync CTA inline (never a bare blank panel)", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /^templates$/i }));
    expect(await screen.findByText(/no templates synced yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync from meta/i })).toBeInTheDocument();
  });

  it("consent bulk-import dry-run preview shows a per-row outcome before commit is available", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /^consent$/i }));
    await screen.findByText(/no consent records yet/i);

    fireEvent.change(screen.getByRole("textbox", { name: /bulk import rows/i }), { target: { value: "+15551234567,OptedIn,BulkImport" } });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "dry-run", totalRows: 1, succeededRows: 1, failedRows: 0, errors: [] }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: /preview import/i }));

    expect(await screen.findByText(/1 of 1 rows valid/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /commit import/i })).toBeInTheDocument();
  });

  it("submits the Connect Meta Business Manager form and reloads on success", async () => {
    mockLoad({ account: null });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText(/connect meta business manager/i);

    fireEvent.change(screen.getByLabelText(/meta business id/i), { target: { value: "biz-9" } });
    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/system user access token/i), { target: { value: "sk-secret" } });
    fireEvent.change(screen.getByLabelText(/^app id/i), { target: { value: "app-9" } });
    fireEvent.change(screen.getByLabelText(/app secret/i), { target: { value: "sec-secret" } });

    fireEvent.click(screen.getByRole("button", { name: /^connect meta business manager$/i }));
    expect(await screen.findByRole("button", { name: /connecting/i })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/channels/chan-1/whatsapp",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a server-side error when connecting fails", async () => {
    mockLoad({ account: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ title: "Invalid System User token." }) }));
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText(/connect meta business manager/i);
    fireEvent.click(screen.getByRole("button", { name: /^connect meta business manager$/i }));
    expect(await screen.findByText("Invalid System User token.")).toBeInTheDocument();
  });

  it("shows Reconnect/Disconnect for an already-linked account and posts a DELETE on disconnect", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(fetch).toHaveBeenCalledWith("/api/v1/admin/channels/chan-1/whatsapp", { method: "DELETE" });
  });

  it("shows an Unreachable warning and lets a write-permitted admin Reconnect", async () => {
    mockLoad({ account: { ...CONNECTED_ACCOUNT, status: "Unreachable" } });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText(/last health check against meta failed/i);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(fetch).toHaveBeenCalledWith("/api/v1/admin/channels/chan-1/whatsapp", expect.objectContaining({ method: "POST" }));
  });

  it("saves the WABA ID and toggles the 24h session-window switch", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /waba & numbers/i }));
    await screen.findByLabelText(/waba id/i);

    fireEvent.change(screen.getByLabelText(/waba id/i), { target: { value: "waba-new" } });
    fireEvent.click(screen.getByRole("switch", { name: /enforce 24-hour session window/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/channels/chan-1/whatsapp",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ wabaId: "waba-new", sessionWindowWarningEnabled: false }) }),
    );
  });

  it("syncs phone numbers from Meta", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT, numbers: [] });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /waba & numbers/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sync phone numbers from meta/i }));
    expect(fetch).toHaveBeenCalledWith("/api/v1/admin/channels/chan-1/whatsapp/numbers", { method: "POST" });
  });

  it("rotates the System User token from the Credentials tab", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /^credentials$/i }));
    const rotateButtons = await screen.findAllByRole("button", { name: "Rotate" });
    fireEvent.click(rotateButtons[0]!);
    fireEvent.change(screen.getByLabelText(/new system user token/i), { target: { value: "new-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/system user token rotated/i)).toBeInTheDocument();
  });

  it("re-verifies the webhook challenge from the Webhook tab", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.endsWith("/whatsapp")) return Promise.resolve({ kind: "ok", data: { account: CONNECTED_ACCOUNT, readiness: { ready: true, reasons: [] } } });
      if (url.includes("/webhook")) {
        return Promise.resolve({
          kind: "ok",
          data: {
            status: {
              webhookUrl: "https://gw.example.com/webhooks/whatsapp",
              verificationStatus: "Pending",
              verifiedAt: null,
              eventSubscriptions: [{ eventType: "messages", label: "Messages", subscribed: true }],
              lastEventReceivedAt: null,
            },
          },
        });
      }
      return Promise.resolve({ kind: "ok", data: {} });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: { verificationStatus: "Verified", webhookUrl: "https://gw.example.com/webhooks/whatsapp", verifiedAt: new Date().toISOString(), eventSubscriptions: [] } }),
      }),
    );
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /^webhook$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /re-verify challenge/i }));
    expect(fetch).toHaveBeenCalledWith("/api/v1/admin/channels/chan-1/whatsapp/webhook/reverify", { method: "POST" });
  });

  it("syncs templates from Meta and shows the synced count", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ synced: 3 }) }));
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /^templates$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sync from meta/i }));
    expect(await screen.findByText(/3 template\(s\) synced/i)).toBeInTheDocument();
  });

  it("commits a previewed consent import", async () => {
    mockLoad({ account: CONNECTED_ACCOUNT });
    render(<WhatsAppChannelConfig channelId="chan-1" canWrite={true} />);
    await screen.findByText("Acme Corp");
    fireEvent.click(screen.getByRole("tab", { name: /^consent$/i }));
    await screen.findByText(/no consent records yet/i);

    fireEvent.change(screen.getByRole("textbox", { name: /bulk import rows/i }), { target: { value: "+15551234567,OptedIn,BulkImport" } });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "dry-run", totalRows: 1, succeededRows: 1, failedRows: 0, errors: [] }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: /preview import/i }));
    await screen.findByText(/1 of 1 rows valid/i);

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    fireEvent.click(screen.getByRole("button", { name: /commit import/i }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/channels/chan-1/whatsapp/consent/import?commit=true",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
