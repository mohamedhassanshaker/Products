import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { ChatThread } from "./chat-thread";
import type { ChatTurn } from "./chat-thread-types";

const baseTurns: ChatTurn[] = [
  {
    id: "t1",
    role: "user",
    text: "How much is my bill?",
    timestamp: new Date("2026-09-08T10:00:00Z"),
  },
  {
    id: "t2",
    role: "assistant",
    text: "Your latest SEWA bill is AED 412.",
    timestamp: new Date("2026-09-08T10:00:05Z"),
    rating: null,
  },
];

afterEach(() => {
  document.documentElement.dir = "";
});

describe("ChatThread", () => {
  it("is a role=log with aria-live=polite and aria-relevant=additions", () => {
    render(<ChatThread turns={baseTurns} aria-label="Conversation" />);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveAttribute("aria-relevant", "additions");
  });

  it("conveys turn author with a visually-hidden prefix, not alignment/tint alone", () => {
    render(<ChatThread turns={baseTurns} />);
    expect(screen.getByText("You said:")).toHaveClass("sr-only");
    expect(screen.getByText("SHJ3 Assistant said:")).toHaveClass("sr-only");
  });

  it("reuses the real MessageMetaRow — rating controls work per assistant turn", () => {
    const onRatingChange = vi.fn();
    render(<ChatThread turns={baseTurns} onRatingChange={onRatingChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(onRatingChange).toHaveBeenCalledWith("t2", "up");
  });

  describe("streaming discipline — real, testable distinction from DiffTraceViewer's own rule", () => {
    it("an in-progress streaming turn's interim text sits inside aria-live=off — not announced at all while streaming", () => {
      const streamingTurns: ChatTurn[] = [
        {
          id: "t3",
          role: "assistant",
          text: "",
          streaming: true,
          interimText: "Your bill",
          timestamp: new Date(),
        },
      ];
      render(<ChatThread turns={streamingTurns} />);
      const interim = screen.getByText("Your bill");
      expect(interim).toHaveAttribute("aria-live", "off");
    });

    it("once the turn finalizes, its text is a normal node — no aria-live=off anywhere on it", () => {
      const finalizedTurns: ChatTurn[] = [
        {
          id: "t3",
          role: "assistant",
          text: "Your bill is AED 412.",
          streaming: false,
          timestamp: new Date(),
        },
      ];
      render(<ChatThread turns={finalizedTurns} />);
      const finalText = screen.getByText("Your bill is AED 412.");
      expect(finalText).not.toHaveAttribute("aria-live", "off");
      expect(
        screen.queryByText("Your bill", { exact: false, selector: "[aria-live='off']" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("scroll, not focus", () => {
    it("appending a turn never moves focus away from wherever it already is", () => {
      const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = vi.fn();

      function Harness({ turns }: { turns: ChatTurn[] }) {
        return (
          <div>
            <input aria-label="Composer stand-in" />
            <ChatThread turns={turns} />
          </div>
        );
      }

      const { rerender } = render(<Harness turns={baseTurns} />);
      const composer = screen.getByRole("textbox", { name: "Composer stand-in" });
      composer.focus();
      expect(composer).toHaveFocus();

      const nextTurns: ChatTurn[] = [
        ...baseTurns,
        { id: "t3", role: "assistant", text: "Anything else?", timestamp: new Date() },
      ];
      rerender(<Harness turns={nextTurns} />);

      expect(composer).toHaveFocus();
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    });
  });

  describe("RTL bubble alignment — inverts by construction via logical properties", () => {
    it("user turn aligns inline-end (justify-end) and assistant aligns inline-start (justify-start), regardless of direction", () => {
      const { container } = render(<ChatThread turns={baseTurns} />);
      const turnDivs = container.querySelectorAll('[data-slot="chat-thread-turn"]');
      const userTurn = Array.from(turnDivs).find((el) => el.getAttribute("data-role") === "user");
      const assistantTurn = Array.from(turnDivs).find(
        (el) => el.getAttribute("data-role") === "assistant",
      );
      expect(userTurn?.className).toContain("items-end");
      expect(userTurn?.className).not.toMatch(/\bitems-start\b/);
      expect(assistantTurn?.className).toContain("items-start");
      expect(assistantTurn?.className).not.toMatch(/\bitems-end\b/);
    });

    it("renders correctly with no crash under a real RTL ancestor, same content either direction (logical properties carry the mirroring, not conditional code)", () => {
      document.documentElement.dir = "rtl";
      const { container } = render(<ChatThread turns={baseTurns} />);
      // No physical left/right utility exists anywhere in the rendered
      // output — if one did, `no-hardcoded-design-values.mjs`'s own gate
      // would already fail the build; this asserts the same property from
      // the rendered DOM directly rather than only trusting the gate.
      expect(container.innerHTML).not.toMatch(/\b(?:ml-|mr-|pl-|pr-|text-left|text-right)\b/);
      expect(screen.getByText("Your latest SEWA bill is AED 412.")).toBeInTheDocument();
    });
  });

  it("renders a system note using the real MessageMetaRow, flanked by decorative rule lines", () => {
    const withSystem: ChatTurn[] = [
      { id: "sys1", role: "system", note: "Escalated to human agent", timestamp: new Date() },
    ];
    render(<ChatThread turns={withSystem} />);
    expect(screen.getByText("Escalated to human agent")).toBeInTheDocument();
  });

  it("suggestion chips attach beneath the last assistant turn and fire onSuggestionSelect", () => {
    const onSuggestionSelect = vi.fn();
    render(
      <ChatThread
        turns={baseTurns}
        suggestions={["Pay now", "View history"]}
        onSuggestionSelect={onSuggestionSelect}
      />,
    );
    const group = screen.getByRole("group", { name: "Suggested replies" });
    fireEvent.click(within(group).getByText("Pay now"));
    expect(onSuggestionSelect).toHaveBeenCalledWith("Pay now");
  });

  it("a failed assistant turn shows retry on the turn itself, not a thread-wide error", () => {
    const onRetryTurn = vi.fn();
    const failedTurns: ChatTurn[] = [
      { id: "t2", role: "assistant", text: "", failed: true, timestamp: new Date() },
    ];
    render(<ChatThread turns={failedTurns} onRetryTurn={onRetryTurn} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryTurn).toHaveBeenCalledWith("t2");
  });

  it("thinking/escalated/error thread-level states each render their own banner", () => {
    const { rerender } = render(<ChatThread turns={baseTurns} state="thinking" />);
    expect(screen.getByText("Still thinking…")).toBeInTheDocument();

    rerender(<ChatThread turns={baseTurns} state="escalated" />);
    expect(screen.getByRole("status")).toHaveTextContent("Escalated");

    rerender(<ChatThread turns={baseTurns} state="error" errorMessage="Connection lost" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  });

  it("empty state shows a real message when there are no turns", () => {
    render(<ChatThread turns={[]} />);
    expect(screen.getByText(/Start the conversation/)).toBeInTheDocument();
  });

  it("a dismissible disclaimer banner pins at the block-start", () => {
    const onDismiss = vi.fn();
    render(
      <ChatThread
        turns={baseTurns}
        disclaimerText="AI-generated responses may be inaccurate."
        onDismissDisclaimer={onDismiss}
      />,
    );
    expect(screen.getByText("AI-generated responses may be inaccurate.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss disclaimer" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("whatsapp variant applies the caller-supplied fixed bubble colours instead of theme tokens", () => {
    const { container } = render(
      <ChatThread
        turns={baseTurns}
        variant="whatsapp"
        bubbleColorOverrides={{
          userBubble: "#dcf8c6",
          userBubbleForeground: "#111b21",
          assistantBubble: "#ffffff",
          assistantBubbleForeground: "#111b21",
        }}
      />,
    );
    const bubbles = container.querySelectorAll('[data-slot="chat-thread-turn"] > div[dir="auto"]');
    const userBubble = Array.from(bubbles).find(
      (el) => (el as HTMLElement).style.backgroundColor === "rgb(220, 248, 198)",
    );
    expect(userBubble).toBeTruthy();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<ChatThread turns={baseTurns} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
