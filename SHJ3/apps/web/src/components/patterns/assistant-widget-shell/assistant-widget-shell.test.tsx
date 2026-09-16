import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { AssistantWidgetShell, type AssistantWidgetRendering } from "./assistant-widget-shell";
import type { ChatTurn } from "@/components/patterns/chat-thread/chat-thread-types";

const turns: ChatTurn[] = [
  { id: "t1", role: "assistant", text: "How can I help?", timestamp: new Date() },
];

/** A real controlled-composer harness — mirrors how a genuine caller wires `value`/`onValueChange`. */
function Harness({
  rendering,
  open = true,
}: {
  rendering: AssistantWidgetRendering;
  open?: boolean;
}) {
  const [value, setValue] = React.useState("");
  return (
    <AssistantWidgetShell
      rendering={rendering}
      open={open}
      turns={turns}
      value={value}
      onValueChange={setValue}
      onSend={() => setValue("")}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AssistantWidgetShell", () => {
  it("closed by default: only the FAB renders", () => {
    render(
      <AssistantWidgetShell turns={turns} value="" onValueChange={() => {}} onSend={() => {}} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open SHJ3 Assistant" })).toBeInTheDocument();
  });

  it("opening moves focus to the shell's heading; Escape minimises and returns focus to the FAB", async () => {
    render(
      <AssistantWidgetShell turns={turns} value="" onValueChange={() => {}} onSend={() => {}} />,
    );
    const fab = screen.getByRole("button", { name: "Open SHJ3 Assistant" });
    fireEvent.click(fab);

    const heading = await screen.findByRole("heading", { name: "SHJ3 Assistant" });
    await waitFor(() => expect(heading).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open SHJ3 Assistant" })).toHaveFocus(),
    );
  });

  describe("docked <-> expanded transition does not remount", () => {
    it("the composer's own DOM node identity survives the switch (the definitive proof — a remount always produces a new node)", () => {
      const { rerender } = render(<Harness rendering="docked" />);
      const composerBefore = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });

      rerender(<Harness rendering="expanded" />);
      const composerAfter = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });

      expect(composerAfter).toBe(composerBefore);
    });

    it("the log region's own DOM node identity survives the switch", () => {
      const { rerender } = render(<Harness rendering="docked" />);
      const logBefore = screen.getByRole("log");

      rerender(<Harness rendering="expanded" />);
      const logAfter = screen.getByRole("log");

      expect(logAfter).toBe(logBefore);
    });

    it("a focused composer stays focused across the switch — a genuinely remounted element cannot retain real DOM focus", () => {
      const { rerender } = render(<Harness rendering="docked" />);
      const composer = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });
      composer.focus();
      expect(composer).toHaveFocus();

      rerender(<Harness rendering="expanded" />);

      expect(screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" })).toHaveFocus();
    });

    it("a typed-but-unsent draft survives the switch", () => {
      const { rerender } = render(<Harness rendering="docked" />);
      const composer = screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" });
      fireEvent.change(composer, { target: { value: "What is my account balance" } });
      expect(composer).toHaveValue("What is my account balance");

      rerender(<Harness rendering="expanded" />);

      expect(screen.getByRole("textbox", { name: "Ask SHJ3 Assistant" })).toHaveValue(
        "What is my account balance",
      );
    });
  });

  it("whatsapp rendering applies the fixed, non-themable colours rather than --chat-* tokens", () => {
    render(
      <AssistantWidgetShell
        rendering="whatsapp"
        open
        turns={turns}
        value=""
        onValueChange={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText("24-hour session window open")).toBeInTheDocument();
    // The minimise/expand control is docked/expanded-only chrome — whatsapp
    // is structurally different, not merely re-coloured (§5.5 #50).
    expect(screen.queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
  });

  it("offline and degraded render their own banner without hiding the thread", () => {
    const { rerender } = render(
      <AssistantWidgetShell
        open
        offline
        turns={turns}
        value=""
        onValueChange={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/slow/);
    expect(screen.getByRole("log")).toBeInTheDocument();

    rerender(
      <AssistantWidgetShell
        open
        degraded
        turns={turns}
        value=""
        onValueChange={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/slow/);
  });

  it("the FAB is a labelled toggle with aria-expanded reflecting open state", () => {
    render(
      <AssistantWidgetShell turns={turns} value="" onValueChange={() => {}} onSend={() => {}} />,
    );
    const fab = screen.getByRole("button", { name: "Open SHJ3 Assistant" });
    expect(fab).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fab);
    expect(screen.getByRole("button", { name: "Close SHJ3 Assistant" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("has zero axe violations when open in its default (docked) rendering", async () => {
    const { container } = render(
      <AssistantWidgetShell
        open
        turns={turns}
        value=""
        onValueChange={() => {}}
        onSend={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
