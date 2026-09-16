import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { Composer } from "./composer";

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onValueChange = vi.fn();
  const onSend = vi.fn();
  const utils = render(
    <Composer value="" onValueChange={onValueChange} onSend={onSend} {...overrides} />,
  );
  return { onValueChange, onSend, ...utils };
}

describe("Composer", () => {
  it("renders a labelled, described textarea and a send button", () => {
    renderComposer();
    const field = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });
    expect(field).toHaveAccessibleDescription(/Press Enter to send/);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("Enter sends when there is text, and does not clear the value itself (controlled)", () => {
    const { onSend, onValueChange } = renderComposer({ value: "Hello" });
    const field = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("Shift+Enter does not send", () => {
    const { onSend } = renderComposer({ value: "Hello" });
    const field = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter does not send while an IME composition is in progress", () => {
    const { onSend } = renderComposer({ value: "こんにちは" });
    const field = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });
    // `isComposing` is a real property of the native `KeyboardEvent`
    // interface (not a React-only addition) — `fireEvent` forwards top-level
    // properties onto the DOM event it constructs, which is exactly what
    // `event.nativeEvent.isComposing` reads inside the component's own
    // handler, so this drives the real code path rather than a mocked one.
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter does nothing when the field is empty or whitespace-only", () => {
    const { onSend } = renderComposer({ value: "   " });
    const field = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("send is never the only submit path: clicking Send also sends", () => {
    const { onSend } = renderComposer({ value: "Hello" });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  describe("mic toggle", () => {
    it("is an aria-pressed toggle labelled Start/Stop voice input", () => {
      const onMicToggle = vi.fn();
      const { rerender } = render(
        <Composer value="" onValueChange={vi.fn()} onSend={vi.fn()} onMicToggle={onMicToggle} />,
      );
      const mic = screen.getByRole("button", { name: "Start voice input" });
      expect(mic).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(mic);
      expect(onMicToggle).toHaveBeenCalledTimes(1);

      rerender(
        <Composer
          value=""
          onValueChange={vi.fn()}
          onSend={vi.fn()}
          onMicToggle={onMicToggle}
          status={{ type: "listening" }}
        />,
      );
      expect(screen.getByRole("button", { name: "Stop voice input" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  describe("listening status", () => {
    it("shows a recording dot, the word Recording, and the interim transcript in a polite live region", () => {
      renderComposer({
        status: { type: "listening", interimTranscript: "my account number is" },
      });
      expect(screen.getByText("Recording")).toBeInTheDocument();
      const live = screen.getByText(/my account number is/);
      expect(live).toHaveAttribute("aria-live", "polite");
    });
  });

  describe("paused status", () => {
    it("disables the field and shows the reason as visible text, not a tooltip", () => {
      renderComposer({
        status: { type: "paused", reason: "Composer paused — a live agent has joined" },
      });
      expect(screen.getByText("Composer paused — a live agent has joined")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" })).toBeDisabled();
    });
  });

  describe("mic-denied status", () => {
    it("renders a real InlineAlert with re-grant guidance, not a silently dead mic", () => {
      const onRetry = vi.fn();
      renderComposer({
        status: {
          type: "mic-denied",
          message: "Allow microphone access in your browser's site settings.",
          onRetry,
        },
      });
      expect(screen.getByRole("alert")).toHaveTextContent(/Allow microphone access/);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("whatsapp variant", () => {
    it("shows the mic in the send slot while empty, and swaps to send once there is text", () => {
      const { rerender } = render(
        <Composer value="" onValueChange={vi.fn()} onSend={vi.fn()} variant="whatsapp" />,
      );
      expect(screen.getByRole("button", { name: "Start voice input" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();

      rerender(<Composer value="Hi" onValueChange={vi.fn()} onSend={vi.fn()} variant="whatsapp" />);
      expect(screen.queryByRole("button", { name: "Start voice input" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    });
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = renderComposer();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations while listening with an interim transcript", async () => {
    const { container } = renderComposer({
      status: { type: "listening", interimTranscript: "hello" },
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations while mic-denied", async () => {
    const { container } = renderComposer({
      status: { type: "mic-denied", message: "Allow microphone access to continue." },
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
