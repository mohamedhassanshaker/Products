// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../store.js";
import { InputArea } from "./InputArea.js";

describe("InputArea (A.1.2)", () => {
  beforeEach(() => {
    useWidgetStore.setState({ send: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => cleanup());

  it("sends the typed message on submit and clears the field", () => {
    render(<InputArea />);
    const input = screen.getByLabelText("Message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(useWidgetStore.getState().send).toHaveBeenCalledWith("Text", { contentType: "Text", text: "Hello" });
    expect(input.value).toBe("");
  });

  it("does not send an empty/whitespace-only message", () => {
    render(<InputArea />);
    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(useWidgetStore.getState().send).not.toHaveBeenCalled();
  });
});
