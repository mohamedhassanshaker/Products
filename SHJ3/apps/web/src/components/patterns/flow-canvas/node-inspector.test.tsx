import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import {
  NodeInspector,
  emptyNodeInspectorValue,
  validateNodeInspectorValue,
  type NodeInspectorFormValue,
} from "./node-inspector";
import type { FlowNode } from "./flow-canvas-types";

describe("validateNodeInspectorValue", () => {
  it("message: requires non-empty text", () => {
    expect(validateNodeInspectorValue({ type: "message", text: "" })).toHaveProperty("text");
    expect(validateNodeInspectorValue({ type: "message", text: "Hi" })).toEqual({});
  });

  it("question: requires a prompt and a valid identifier variable name", () => {
    expect(validateNodeInspectorValue({ type: "question", prompt: "", variableName: "" })).toEqual({
      prompt: expect.any(String),
      variableName: expect.any(String),
    });
    expect(
      validateNodeInspectorValue({ type: "question", prompt: "Q", variableName: "1bad" }),
    ).toHaveProperty("variableName");
    expect(
      validateNodeInspectorValue({ type: "question", prompt: "Q", variableName: "amount" }),
    ).toEqual({});
  });

  it("tool-call: requires a tool name and, when present, valid JSON arguments", () => {
    expect(
      validateNodeInspectorValue({ type: "tool-call", toolName: "", argumentsJson: "" }),
    ).toHaveProperty("toolName");
    expect(
      validateNodeInspectorValue({
        type: "tool-call",
        toolName: "fetch_bill",
        argumentsJson: "{not json",
      }),
    ).toHaveProperty("argumentsJson");
    expect(
      validateNodeInspectorValue({
        type: "tool-call",
        toolName: "fetch_bill",
        argumentsJson: '{"account":"123"}',
      }),
    ).toEqual({});
  });

  it("handover: requires a reason and a queue", () => {
    expect(validateNodeInspectorValue({ type: "handover", reason: "", queue: "" })).toEqual({
      reason: expect.any(String),
      queue: expect.any(String),
    });
    expect(
      validateNodeInspectorValue({ type: "handover", reason: "Angry customer", queue: "billing" }),
    ).toEqual({});
  });

  it("condition: requires an expression and both branch labels", () => {
    expect(
      validateNodeInspectorValue({
        type: "condition",
        expression: "",
        trueBranchLabel: "",
        falseBranchLabel: "",
      }),
    ).toEqual({
      expression: expect.any(String),
      trueBranchLabel: expect.any(String),
      falseBranchLabel: expect.any(String),
    });
    expect(
      validateNodeInspectorValue({
        type: "condition",
        expression: "amount > 500",
        trueBranchLabel: "Yes",
        falseBranchLabel: "No",
      }),
    ).toEqual({});
  });
});

describe("emptyNodeInspectorValue", () => {
  it("returns a value matching each node type's own discriminant", () => {
    expect(emptyNodeInspectorValue("message").type).toBe("message");
    expect(emptyNodeInspectorValue("condition")).toEqual({
      type: "condition",
      expression: "",
      trueBranchLabel: "Yes",
      falseBranchLabel: "No",
    });
  });
});

const node: FlowNode = { id: "n1", type: "question", title: "Ask amount", summary: "s" };

function renderInspector(overrides: Partial<React.ComponentProps<typeof NodeInspector>> = {}) {
  const value: NodeInspectorFormValue = { type: "question", prompt: "", variableName: "" };
  const onChange = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <NodeInspector
      node={node}
      value={value}
      onChange={onChange}
      onSave={onSave}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onChange, onSave, onClose };
}

describe("NodeInspector", () => {
  it("renders the type badge and title", () => {
    renderInspector();
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ask amount" })).toBeInTheDocument();
  });

  it("Save is disabled while the current value is invalid, calls onSave when valid", () => {
    const { onSave, rerender, onChange, onClose } = renderInspector();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    const validValue: NodeInspectorFormValue = {
      type: "question",
      prompt: "How much?",
      variableName: "amount",
    };
    rerender(
      <NodeInspector
        node={node}
        value={validValue}
        onChange={onChange}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("typing into a field calls onChange with the updated value, not a mutated original", () => {
    const { onChange } = renderInspector();
    fireEvent.change(screen.getByLabelText("Question prompt"), {
      target: { value: "How much do you owe?" },
    });
    expect(onChange).toHaveBeenCalledWith({
      type: "question",
      prompt: "How much do you owe?",
      variableName: "",
    });
  });

  it("the close button and Escape both call onClose", () => {
    const { onClose, unmount } = renderInspector();
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(onClose).toHaveBeenCalledOnce();
    // Unmounted explicitly before the second render below — `afterEach`
    // cleanup only runs between *tests*, and both renders share one region
    // accessible name, so leaving the first mounted would make the second
    // `getByRole` query ambiguous.
    unmount();

    const { onClose: onCloseTwo } = renderInspector();
    fireEvent.keyDown(screen.getByRole("region", { name: "Node inspector" }), { key: "Escape" });
    expect(onCloseTwo).toHaveBeenCalledOnce();
  });

  it("saving disables the Save button and shows the saving label", () => {
    renderInspector({
      value: { type: "question", prompt: "Q", variableName: "amount" },
      saving: true,
    });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("has zero axe violations with a valid value", async () => {
    const { container } = renderInspector({
      value: { type: "question", prompt: "How much?", variableName: "amount" },
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
