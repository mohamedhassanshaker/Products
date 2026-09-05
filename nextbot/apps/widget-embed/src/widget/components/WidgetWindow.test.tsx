// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../store.js";
import { WidgetWindow } from "./WidgetWindow.js";

describe("WidgetWindow (A.1.2)", () => {
  beforeEach(() => {
    useWidgetStore.setState({
      config: { tenantId: "acme", channelId: "wc_1" },
      screen: "welcome",
      messages: [],
      aiTyping: false,
      isOnline: true,
      hidePoweredBy: false,
      minimizeWindow: vi.fn(),
      openLanguageModal: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      languageModalOpen: false,
      selectLanguage: vi.fn(),
      closeLanguageModal: vi.fn(),
    });
  });
  afterEach(() => cleanup());

  it("renders the complementary landmark labeled 'Chat support'", () => {
    render(<WidgetWindow />);
    expect(screen.getByRole("complementary", { name: "Chat support" })).toBeInTheDocument();
  });

  it("shows the Welcome screen when there is no active conversation", () => {
    render(<WidgetWindow />);
    expect(screen.getByText("Welcome 👋")).toBeInTheDocument();
  });

  it("shows the offline banner only when isOnline is false", () => {
    const { rerender } = render(<WidgetWindow />);
    expect(screen.queryByText(/you're offline/i)).not.toBeInTheDocument();
    useWidgetStore.setState({ isOnline: false });
    rerender(<WidgetWindow />);
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
  });

  it("shows the powered-by footer by default and hides it when hidePoweredBy is true", () => {
    const { rerender } = render(<WidgetWindow />);
    expect(screen.getByText(/powered by nextbot/i)).toBeInTheDocument();
    useWidgetStore.setState({ hidePoweredBy: true });
    rerender(<WidgetWindow />);
    expect(screen.queryByText(/powered by nextbot/i)).not.toBeInTheDocument();
  });

  it("minimize button calls minimizeWindow directly when there is no conversation yet", () => {
    render(<WidgetWindow />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    expect(useWidgetStore.getState().minimizeWindow).toHaveBeenCalled();
  });

  it("end-chat asks for confirmation once a conversation has messages, and only minimizes on confirm", () => {
    useWidgetStore.setState({
      messages: [{ id: "1", sequence: 1, sender: "Customer", contentType: "Text", payload: { contentType: "Text", text: "hi" }, createdAt: new Date().toISOString() }],
      screen: "conversation",
    });
    render(<WidgetWindow />);
    fireEvent.click(screen.getByRole("button", { name: "End conversation" }));
    expect(screen.getByText("End this conversation?")).toBeInTheDocument();
    expect(useWidgetStore.getState().minimizeWindow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "End" }));
    expect(useWidgetStore.getState().minimizeWindow).toHaveBeenCalled();
  });

  it("opens the language modal via the header button", () => {
    render(<WidgetWindow />);
    fireEvent.click(screen.getByRole("button", { name: "Choose language" }));
    expect(useWidgetStore.getState().openLanguageModal).toHaveBeenCalled();
  });

  it("D9: moves focus into the message input on mount (open)", () => {
    render(<WidgetWindow />);
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();
  });

  it("D9: Escape at the window level minimizes the widget", () => {
    render(<WidgetWindow />);
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Chat support" }), { key: "Escape" });
    expect(useWidgetStore.getState().minimizeWindow).toHaveBeenCalled();
  });

  it("D9: exposes its own id for the launcher's aria-controls to reference", () => {
    render(<WidgetWindow />);
    expect(screen.getByRole("complementary", { name: "Chat support" })).toHaveAttribute("id", "nextbot-widget-window");
  });

  it("D7: mirrors to rtl when the active language is Arabic, even if the embed config direction is 'auto'", () => {
    useWidgetStore.setState({ config: { tenantId: "acme", channelId: "wc_1", direction: "auto" }, language: "ar" });
    render(<WidgetWindow />);
    expect(screen.getByRole("complementary", { name: "Chat support" })).toHaveAttribute("dir", "rtl");
  });

  it("D4: falls back to the server-resolved channelTheme's headerTitle when no per-embed override is set", () => {
    useWidgetStore.setState({ config: { tenantId: "acme", channelId: "wc_1" }, channelTheme: { headerTitle: "Acme Support" } });
    render(<WidgetWindow />);
    expect(screen.getByText("Acme Support")).toBeInTheDocument();
  });
});
