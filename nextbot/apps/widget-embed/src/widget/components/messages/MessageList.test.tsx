// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../../store.js";
import { MessageList } from "./MessageList.js";
import type { WidgetMessage } from "../../types.js";

describe("MessageList (conversation area dispatch + aria-live region)", () => {
  beforeEach(() => {
    useWidgetStore.setState({ send: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => cleanup());

  it("dispatches each contentType to its own bubble component", () => {
    const messages: WidgetMessage[] = [
      { id: "1", sequence: 1, sender: "AI", contentType: "Text", payload: { contentType: "Text", text: "hi" }, createdAt: new Date().toISOString() },
      {
        id: "2",
        sequence: 2,
        sender: "AI",
        contentType: "QuickReply",
        payload: { contentType: "QuickReply", chips: [{ id: "a", label: "Yes" }] },
        createdAt: new Date().toISOString(),
      },
      {
        id: "3",
        sequence: 3,
        sender: "AI",
        contentType: "Error",
        payload: { contentType: "Error", reason: "GoalNotUnderstood", text: "I'm not sure I understand. Could you rephrase that, or choose from the options below?" },
        createdAt: new Date().toISOString(),
      },
    ];
    render(<MessageList messages={messages} aiTyping={false} />);
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByText(/rephrase that/)).toBeInTheDocument();
  });

  it("shows the typing indicator only when aiTyping is true", () => {
    const { rerender } = render(<MessageList messages={[]} aiTyping={false} />);
    expect(screen.queryByLabelText("NextBot is typing")).not.toBeInTheDocument();
    rerender(<MessageList messages={[]} aiTyping />);
    expect(screen.getByLabelText("NextBot is typing")).toBeInTheDocument();
  });

  it("only the most recent interactive message (QuickReply/List/Form) stays enabled — earlier ones render disabled", () => {
    const messages: WidgetMessage[] = [
      {
        id: "1",
        sequence: 1,
        sender: "AI",
        contentType: "QuickReply",
        payload: { contentType: "QuickReply", chips: [{ id: "a", label: "First" }] },
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        sequence: 2,
        sender: "AI",
        contentType: "QuickReply",
        payload: { contentType: "QuickReply", chips: [{ id: "b", label: "Second" }] },
        createdAt: new Date().toISOString(),
      },
    ];
    render(<MessageList messages={messages} aiTyping={false} />);
    expect(screen.getByRole("button", { name: "First" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Second" })).toBeEnabled();
  });
});
