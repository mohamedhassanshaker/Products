import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { Wizard, type WizardStep } from "./wizard";
import { setMockViewportWidth, DEFAULT_MOCK_VIEWPORT_WIDTH } from "@/test/media-query-mock";

const STEPS: WizardStep[] = [
  { id: "basics", label: "Basics", status: "complete" },
  { id: "prompt", label: "System prompt", status: "complete" },
  { id: "skills", label: "Skills & tools", status: "in-progress" },
  { id: "guardrails", label: "Guardrails", status: "invalid" },
  { id: "flow", label: "Flow", status: "untouched" },
  { id: "publish", label: "Publish", status: "blocked" },
];

function baseProps(overrides: Partial<React.ComponentProps<typeof Wizard>> = {}) {
  return {
    steps: STEPS,
    activeStepId: "skills",
    onStepChange: vi.fn(),
    renderStep: (step: WizardStep) => <p>Content for {step.label}</p>,
    onSaveAndContinue: vi.fn(),
    onPublish: vi.fn(),
    onSaveDraft: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof Wizard>;
}

afterEach(() => {
  document.documentElement.dir = "";
  setMockViewportWidth(DEFAULT_MOCK_VIEWPORT_WIDTH);
});

describe("Wizard", () => {
  it("renders a tablist with one tab per step and a segmented progress bar", () => {
    render(<Wizard {...baseProps()} />);
    expect(screen.getByRole("tablist", { name: "Agent designer steps" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(STEPS.length);
    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "2"); // 2 complete steps
    expect(progress).toHaveAttribute("aria-valuemax", String(STEPS.length));
  });

  it("each tab's accessible name is a real computed sentence combining position, label and status", () => {
    render(<Wizard {...baseProps()} />);
    expect(
      screen.getByRole("tab", { name: "Step 3 of 6: Skills & tools — in progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Step 1 of 6: Basics — complete" })).toBeInTheDocument();
  });

  it("invalid step carries both a glyph and the visible words 'Needs attention', not colour alone", () => {
    render(<Wizard {...baseProps()} />);
    const tab = screen.getByRole("tab", { name: "Step 4 of 6: Guardrails — Needs attention" });
    expect(within(tab).getByText("Needs attention")).toBeInTheDocument();
  });

  it("free navigation: clicking a distant step activates it directly, with no forced linear progress", () => {
    const onStepChange = vi.fn();
    render(<Wizard {...baseProps({ activeStepId: "basics", onStepChange })} />);
    // `fireEvent.click` alone does not reach Radix `Tabs.Trigger`'s
    // activation logic — confirmed by reading `@radix-ui/react-tabs`'s
    // compiled source directly: it activates from `onMouseDown`
    // (unconditionally, regardless of `activationMode`), not `onClick`, and
    // testing-library's `click` helper dispatches only a `click` event, not
    // the `mousedown` a real pointer click also produces.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Step 5 of 6: Flow/ }));
    expect(onStepChange).toHaveBeenCalledWith("flow");
  });

  it("flushes a draft save on step change, attributed to the step being left", () => {
    const onSaveDraft = vi.fn();
    const onStepChange = vi.fn();
    render(<Wizard {...baseProps({ activeStepId: "skills", onSaveDraft, onStepChange })} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Step 5 of 6: Flow/ }));
    expect(onSaveDraft).toHaveBeenCalledWith("skills");
  });

  it("moves focus to the step pane's heading when the active step changes", () => {
    const { rerender } = render(<Wizard {...baseProps({ activeStepId: "basics" })} />);
    expect(screen.getByRole("heading", { level: 2, name: "Basics" })).not.toHaveFocus();

    rerender(<Wizard {...baseProps({ activeStepId: "flow" })} />);
    expect(screen.getByRole("heading", { level: 2, name: "Flow" })).toHaveFocus();
  });

  describe("footer actions", () => {
    it("Back is disabled on the first step and navigates to the previous step otherwise", () => {
      const onStepChange = vi.fn();
      const { rerender } = render(
        <Wizard {...baseProps({ activeStepId: "basics", onStepChange })} />,
      );
      expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

      rerender(<Wizard {...baseProps({ activeStepId: "skills", onStepChange })} />);
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(onStepChange).toHaveBeenCalledWith("prompt");
    });

    it("the primary action reads Save & continue on every step but the last, and Publish agent on the last", () => {
      const onSaveAndContinue = vi.fn();
      const { rerender } = render(
        <Wizard {...baseProps({ activeStepId: "flow", onSaveAndContinue })} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
      expect(onSaveAndContinue).toHaveBeenCalledTimes(1);

      rerender(<Wizard {...baseProps({ activeStepId: "publish" })} />);
      expect(screen.getByRole("button", { name: "Publish agent" })).toBeInTheDocument();
    });

    it("the reachable-but-blocked last step disables only the Publish button", () => {
      render(<Wizard {...baseProps({ activeStepId: "publish" })} />);
      expect(screen.getByRole("button", { name: "Publish agent" })).toBeDisabled();
      // The step itself is still reachable and its content still renders —
      // "blocked" is not "hidden."
      expect(screen.getByText("Content for Publish")).toBeInTheDocument();
    });

    it("Ctrl+Enter submits the current step's primary action", () => {
      const onSaveAndContinue = vi.fn();
      render(<Wizard {...baseProps({ activeStepId: "flow", onSaveAndContinue })} />);
      fireEvent.keyDown(screen.getByText("Content for Flow"), { key: "Enter", ctrlKey: true });
      expect(onSaveAndContinue).toHaveBeenCalledTimes(1);
    });

    it("a plain Enter (no modifier) does not submit", () => {
      const onSaveAndContinue = vi.fn();
      render(<Wizard {...baseProps({ activeStepId: "flow", onSaveAndContinue })} />);
      fireEvent.keyDown(screen.getByText("Content for Flow"), { key: "Enter" });
      expect(onSaveAndContinue).not.toHaveBeenCalled();
    });

    it("Save draft flushes a save immediately", () => {
      const onSaveDraft = vi.fn();
      render(<Wizard {...baseProps({ activeStepId: "flow", onSaveDraft })} />);
      fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
      expect(onSaveDraft).toHaveBeenCalledWith("flow");
    });
  });

  describe("draft restore", () => {
    it("shows a loading placeholder instead of the step content until loadDraft resolves", async () => {
      let resolveLoad: () => void = () => {};
      const loadDraft = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
      );
      render(<Wizard {...baseProps({ activeStepId: "flow", loadDraft })} />);
      expect(screen.getByLabelText("Restoring draft")).toBeInTheDocument();
      expect(screen.queryByText("Content for Flow")).not.toBeInTheDocument();

      resolveLoad();
      expect(await screen.findByText("Content for Flow")).toBeInTheDocument();
    });
  });

  describe("RTL", () => {
    it("resolves the ambient direction and reverses the tab strip's arrow-key navigation", async () => {
      document.documentElement.dir = "rtl";
      render(<Wizard {...baseProps({ activeStepId: "basics" })} />);
      const basics = await screen.findByRole("tab", { name: /Step 1 of 6: Basics/ });
      basics.focus();
      // §10.4: "Arrow across steps" — reversed under RTL, the same
      // `useResolvedDir()` mechanism `sub-tab-bar.tsx`/`toggle-row.tsx`/
      // `slider.tsx` already establish and this file reuses directly.
      fireEvent.keyDown(basics, { key: "ArrowLeft" });
      const prompt = await screen.findByRole("tab", { name: /Step 2 of 6: System prompt/ });
      expect(prompt).toHaveFocus();
    });
  });

  describe("≤820px collapse", () => {
    it("replaces the tablist with a Select plus prev/next arrows, keeping the progress bar", () => {
      setMockViewportWidth(700);
      render(<Wizard {...baseProps({ activeStepId: "skills" })} />);

      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous step" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next step" })).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("the prev/next arrows navigate by one step and disable at the ends", () => {
      setMockViewportWidth(700);
      const onStepChange = vi.fn();
      const { rerender } = render(
        <Wizard {...baseProps({ activeStepId: "basics", onStepChange })} />,
      );
      expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
      expect(onStepChange).toHaveBeenCalledWith("prompt");

      rerender(<Wizard {...baseProps({ activeStepId: "publish", onStepChange })} />);
      expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
    });
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Wizard {...baseProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations in the ≤820px collapsed layout", async () => {
    setMockViewportWidth(700);
    const { container } = render(<Wizard {...baseProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
