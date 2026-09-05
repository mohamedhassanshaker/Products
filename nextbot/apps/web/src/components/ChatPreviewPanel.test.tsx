// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ChatPreviewPanel } from "./ChatPreviewPanel.js";

/** Decodes this component's own `encodeWidgetConfig` output back to a plain object,
 * mirroring `WidgetApp.tsx`'s real `decodeConfig()` unicode-safe-base64 scheme —
 * used here only to assert on the iframe `src` this component actually built. */
function decodeConfigParam(src: string): Record<string, unknown> {
  const url = new URL(src);
  const encoded = url.searchParams.get("config")!;
  const binary = atob(encoded);
  const json = decodeURIComponent(
    Array.from(binary)
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(""),
  );
  return JSON.parse(json);
}

describe("ChatPreviewPanel (Phase 6 shared chat-preview surface)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("channel-test mount (no previewVersionId): renders the iframe immediately with no admin-token round trip at all", () => {
    render(<ChatPreviewPanel tenantSlug="acme" channelPublicKey="wc_1" widgetBaseUrl="http://localhost:8080" />);

    const iframe = screen.getByTitle("NextBot chat preview") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toContain("http://localhost:8080/widget/index.html");
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(decodeConfigParam(iframe.src)).toEqual({});
    expect(screen.getByText(/sandbox preview/i)).toBeInTheDocument();
  });

  it("version-preview mount: fetches a preview token first, then mounts the iframe with previewVersionId/previewToken in its config", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { previewToken: "signed-tok-1" } });
    render(<ChatPreviewPanel tenantSlug="acme" channelPublicKey="wc_1" widgetBaseUrl="http://localhost:8080" previewVersionId="version-A" />);

    expect(screen.getByRole("status", { name: /preparing sandbox preview/i })).toBeInTheDocument();

    const iframe = await screen.findByTitle("NextBot chat preview") as HTMLIFrameElement;
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/admin/agent-platform/versions/version-A/sandbox-preview-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(decodeConfigParam(iframe.src)).toEqual({ previewVersionId: "version-A", previewToken: "signed-tok-1" });
  });

  it("version-preview mount: a failed token fetch shows an error, never mounts the iframe", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "You don't have access to this section." });
    render(<ChatPreviewPanel tenantSlug="acme" channelPublicKey="wc_1" widgetBaseUrl="http://localhost:8080" previewVersionId="version-A" />);

    await waitFor(() => expect(screen.getByText(/couldn't start a sandbox preview session/i)).toBeInTheDocument());
    expect(screen.queryByTitle("NextBot chat preview")).not.toBeInTheDocument();
  });

  it("'Reload session' re-fetches a fresh preview token and remounts the iframe under a new key", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { previewToken: "signed-tok-1" } });
    render(<ChatPreviewPanel tenantSlug="acme" channelPublicKey="wc_1" widgetBaseUrl="http://localhost:8080" previewVersionId="version-A" />);
    const firstIframe = (await screen.findByTitle("NextBot chat preview")) as HTMLIFrameElement;
    expect(decodeConfigParam(firstIframe.src).previewToken).toBe("signed-tok-1");

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { previewToken: "signed-tok-2" } });
    fireEvent.click(screen.getByRole("button", { name: /reload session/i }));

    await waitFor(() => {
      const iframe = screen.getByTitle("NextBot chat preview") as HTMLIFrameElement;
      expect(decodeConfigParam(iframe.src).previewToken).toBe("signed-tok-2");
    });
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it("channel-test mount: 'Reload session' remounts the iframe without ever calling the token endpoint", () => {
    render(<ChatPreviewPanel tenantSlug="acme" channelPublicKey="wc_1" widgetBaseUrl="http://localhost:8080" />);
    fireEvent.click(screen.getByRole("button", { name: /reload session/i }));
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.getByTitle("NextBot chat preview")).toBeInTheDocument();
  });

  it("strips a trailing slash from widgetBaseUrl before building the iframe src", () => {
    render(<ChatPreviewPanel tenantSlug="acme" channelPublicKey="wc_1" widgetBaseUrl="http://localhost:8080/" />);
    const iframe = screen.getByTitle("NextBot chat preview") as HTMLIFrameElement;
    expect(iframe.src).toBe("http://localhost:8080/widget/index.html?tenantId=acme&channelId=wc_1&config=e30%3D");
  });
});
