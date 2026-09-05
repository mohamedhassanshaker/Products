// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "./store.js";
import { WidgetApp } from "./WidgetApp.js";

describe("WidgetApp (root — URL config decode, launcher/window switch, resize postMessage)", () => {
  const bootstrap = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    useWidgetStore.setState({
      bootstrap,
      view: "launcher",
      unreadCount: 0,
      initError: null,
      bootstrapping: false,
      setOnline: vi.fn(),
    });
    window.history.pushState({}, "", "/?tenantId=acme&channelId=wc_1");
  });
  afterEach(() => {
    cleanup();
    bootstrap.mockClear();
  });

  it("renders nothing when tenantId/channelId are absent from the URL (defense-in-depth fail-closed)", () => {
    window.history.pushState({}, "", "/");
    const { container } = render(<WidgetApp />);
    expect(container).toBeEmptyDOMElement();
  });

  it("bootstraps with the decoded tenantId/channelId on mount", () => {
    render(<WidgetApp />);
    expect(bootstrap).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "acme", channelId: "wc_1" }));
  });

  it("renders the launcher when view is 'launcher'", () => {
    render(<WidgetApp />);
    expect(screen.getByRole("button", { name: "Chat with us" })).toBeInTheDocument();
  });

  it("renders the widget window when view is 'window'", () => {
    useWidgetStore.setState({ view: "window", screen: "welcome", messages: [], aiTyping: false, isOnline: true, hidePoweredBy: false, config: { tenantId: "acme", channelId: "wc_1" } });
    render(<WidgetApp />);
    expect(screen.getByRole("complementary", { name: "Chat support" })).toBeInTheDocument();
  });

  it("posts a resize message to the parent window on view change", () => {
    const postMessageSpy = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    render(<WidgetApp />);
    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "nextbot:resize", state: "collapsed" }), "*");
    postMessageSpy.mockRestore();
  });

  it("falls back to just tenantId/channelId when the config query param is malformed", () => {
    window.history.pushState({}, "", "/?tenantId=acme&channelId=wc_1&config=not-valid-base64!!!");
    render(<WidgetApp />);
    expect(bootstrap).toHaveBeenCalledWith({ tenantId: "acme", channelId: "wc_1" });
  });

  it("dispatches setOnline(true)/(false) on the window's online/offline events", () => {
    const setOnline = vi.fn();
    useWidgetStore.setState({ setOnline });
    render(<WidgetApp />);

    window.dispatchEvent(new Event("offline"));
    expect(setOnline).toHaveBeenCalledWith(false);

    window.dispatchEvent(new Event("online"));
    expect(setOnline).toHaveBeenCalledWith(true);
  });

  it("decodes a base64url-encoded config query param (e.g. theme.primaryColor)", () => {
    const config = { tenantId: "acme", channelId: "wc_1", theme: { primaryColor: "#1B6B4A" } };
    const encoded = btoa(encodeURIComponent(JSON.stringify(config)).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
    window.history.pushState({}, "", `/?tenantId=acme&channelId=wc_1&config=${encoded}`);
    render(<WidgetApp />);
    expect(bootstrap).toHaveBeenCalledWith(expect.objectContaining({ theme: { primaryColor: "#1B6B4A" } }));
  });

  it("D7: the outer wrapper's dir mirrors to rtl for the active (store) language even with no per-embed direction override", () => {
    useWidgetStore.setState({ language: "ar" });
    const { container } = render(<WidgetApp />);
    expect(container.querySelector("div[dir]")).toHaveAttribute("dir", "rtl");
  });

  it("D7: an explicit per-embed direction override always wins over the active language", () => {
    const config = { tenantId: "acme", channelId: "wc_1", direction: "ltr" as const };
    const encoded = btoa(encodeURIComponent(JSON.stringify(config)).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
    window.history.pushState({}, "", `/?tenantId=acme&channelId=wc_1&config=${encoded}`);
    useWidgetStore.setState({ language: "ar" });
    const { container } = render(<WidgetApp />);
    expect(container.querySelector("div[dir]")).toHaveAttribute("dir", "ltr");
  });
});
