// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../store.js";
import { Launcher } from "./Launcher.js";

describe("Launcher (A.1.1)", () => {
  beforeEach(() => {
    useWidgetStore.setState({ unreadCount: 0, initError: null, bootstrapping: false });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders an accessible button labeled 'Chat with us' by default", () => {
    render(<Launcher />);
    expect(screen.getByRole("button", { name: "Chat with us" })).toBeInTheDocument();
  });

  it("includes the unread count in the button's accessible name", () => {
    useWidgetStore.setState({ unreadCount: 2 });
    render(<Launcher />);
    expect(screen.getByRole("button", { name: /2 unread messages/ })).toBeInTheDocument();
  });

  it("renders disabled with the exact FR-OC-01 tooltip copy when the channel could not be resolved", () => {
    useWidgetStore.setState({ initError: "not-found" });
    render(<Launcher />);
    expect(screen.getByRole("button", { name: "Chat is temporarily unavailable." })).toBeDisabled();
  });

  it("clicking opens the window", () => {
    const openWindow = vi.fn();
    useWidgetStore.setState({ openWindow });
    render(<Launcher />);
    screen.getByRole("button").click();
    expect(openWindow).toHaveBeenCalled();
  });

  it("D9: exposes aria-expanded/aria-controls per the disclosure-button pattern (UX_GUIDELINES §5.5)", () => {
    render(<Launcher />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "nextbot-widget-window");
  });
});
