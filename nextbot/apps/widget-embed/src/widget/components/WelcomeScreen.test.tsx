// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../store.js";
import { WelcomeScreen } from "./WelcomeScreen.js";

describe("WelcomeScreen (A.1.3)", () => {
  beforeEach(() => {
    useWidgetStore.setState({ send: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => cleanup());

  it("renders quick-action cards from the embed config and sends the mapped request on tap", () => {
    render(
      <WelcomeScreen
        config={{
          tenantId: "acme",
          channelId: "wc_1",
          quickActions: [{ label: "Check Status", request: "I want to check my order status" }],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check Status" }));
    expect(useWidgetStore.getState().send).toHaveBeenCalledWith("Text", { contentType: "Text", text: "I want to check my order status" });
  });

  it("renders no card grid when the config has none", () => {
    render(<WelcomeScreen config={{ tenantId: "acme", channelId: "wc_1" }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("free-text submit sends the typed message and clears the input", () => {
    render(<WelcomeScreen config={{ tenantId: "acme", channelId: "wc_1" }} />);
    const input = screen.getByLabelText("Ask me anything") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Where's my order?" } });
    fireEvent.submit(input.closest("form")!);
    expect(useWidgetStore.getState().send).toHaveBeenCalledWith("Text", { contentType: "Text", text: "Where's my order?" });
    expect(input.value).toBe("");
  });

  it("submitting an empty free-text input does not call send", () => {
    render(<WelcomeScreen config={{ tenantId: "acme", channelId: "wc_1" }} />);
    const input = screen.getByLabelText("Ask me anything");
    fireEvent.submit(input.closest("form")!);
    expect(useWidgetStore.getState().send).not.toHaveBeenCalled();
  });
});
