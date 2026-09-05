// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ChannelTypePicker } from "./ChannelTypePicker.js";

describe("ChannelTypePicker (FR-OC-03 'Add Channel' type-selection step, UX_GUIDELINES.md §7.1)", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows Web Widget and WhatsApp as selectable, and other types as visible 'Coming soon' cards", () => {
    render(<ChannelTypePicker />);
    expect(screen.getByRole("heading", { name: "Web Widget" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "WhatsApp" })).toBeInTheDocument();
    expect(screen.getByLabelText(/messenger — coming soon/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/instagram — coming soon/i)).toBeInTheDocument();
  });

  it("selecting WhatsApp shows the WhatsApp channel creation form", () => {
    render(<ChannelTypePicker />);
    fireEvent.click(screen.getByRole("heading", { name: "WhatsApp" }));
    expect(screen.getByRole("heading", { name: /add whatsapp channel/i })).toBeInTheDocument();
  });

  it("selecting Web Widget shows the existing widget creation form", () => {
    render(<ChannelTypePicker />);
    fireEvent.click(screen.getByRole("heading", { name: "Web Widget" }));
    expect(screen.getByRole("heading", { name: /add web widget channel/i })).toBeInTheDocument();
  });
});
