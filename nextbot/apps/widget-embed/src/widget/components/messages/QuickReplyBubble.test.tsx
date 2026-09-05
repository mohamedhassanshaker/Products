// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../../store.js";
import { QuickReplyBubble } from "./QuickReplyBubble.js";

describe("QuickReplyBubble (A.2.2 — single-use)", () => {
  const payload = {
    contentType: "QuickReply" as const,
    chips: [
      { id: "a", label: "Check Status" },
      { id: "b", label: "New Request" },
    ],
  };

  beforeEach(() => {
    useWidgetStore.setState({ send: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders every chip as a grouped, labeled button row", () => {
    render(<QuickReplyBubble payload={payload} />);
    expect(screen.getByRole("group", { name: "Quick reply options" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check Status" })).toBeEnabled();
  });

  it("tapping a chip sends it and disables every chip in the row", () => {
    render(<QuickReplyBubble payload={payload} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Status" }));

    expect(useWidgetStore.getState().send).toHaveBeenCalledWith("QuickReply", { ...payload, selectedChipId: "a" });
    expect(screen.getByRole("button", { name: "Check Status" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New Request" })).toBeDisabled();
  });

  it("renders already-answered when disabled prop is set (an older message in history)", () => {
    render(<QuickReplyBubble payload={payload} disabled />);
    expect(screen.getByRole("button", { name: "Check Status" })).toBeDisabled();
  });
});
