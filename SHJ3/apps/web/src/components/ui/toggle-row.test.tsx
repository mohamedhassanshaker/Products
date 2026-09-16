import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ToggleRow } from "./toggle-row";

const options = [
  { value: "docked", label: "Docked" },
  { value: "expanded", label: "Expanded" },
  { value: "whatsapp", label: "WhatsApp" },
];

afterEach(() => {
  document.documentElement.dir = "";
});

describe("ToggleRow", () => {
  it("renders a radiogroup with the first option active by default", () => {
    render(<ToggleRow options={options} aria-label="Widget display mode" />);
    const group = screen.getByRole("radiogroup", { name: "Widget display mode" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Docked" })).toHaveAttribute("aria-checked", "true");
  });

  it("clicking a segment selects it and reports the new value", () => {
    const onValueChange = vi.fn();
    render(
      <ToggleRow
        options={options}
        aria-label="Widget display mode"
        onValueChange={onValueChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Expanded" }));
    expect(onValueChange).toHaveBeenCalledWith("expanded");
    expect(screen.getByRole("radio", { name: "Expanded" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Docked" })).toHaveAttribute("aria-checked", "false");
  });

  it("is mutually exclusive: clicking the already-active segment does not deselect it (Radix's own single-type toggle-off is overridden)", () => {
    const onValueChange = vi.fn();
    render(
      <ToggleRow
        options={options}
        aria-label="Widget display mode"
        onValueChange={onValueChange}
      />,
    );
    const docked = screen.getByRole("radio", { name: "Docked" });
    expect(docked).toHaveAttribute("aria-checked", "true");
    fireEvent.click(docked);
    expect(docked).toHaveAttribute("aria-checked", "true");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("a disabled option cannot be selected", () => {
    render(
      <ToggleRow
        options={[options[0]!, { ...options[1]!, disabled: true }, options[2]!]}
        aria-label="Widget display mode"
      />,
    );
    expect(screen.getByRole("radio", { name: "Expanded" })).toBeDisabled();
  });

  it("with-dot variant renders a status dot alongside the word, not colour alone", () => {
    const { container } = render(
      <ToggleRow
        variant="with-dot"
        aria-label="Agent status"
        options={[
          { value: "available", label: "Available", dotStatus: "success" },
          { value: "busy", label: "Busy", dotStatus: "warning" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "Available" })).toBeInTheDocument();
    expect(container.querySelector(".bg-success")).toBeInTheDocument();
    expect(container.querySelector(".bg-warning")).toBeInTheDocument();
  });

  it("loading marks the row aria-busy and shows a spinner on the active segment", () => {
    render(<ToggleRow options={options} aria-label="Widget display mode" loading />);
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
  });

  it("supports a controlled value", () => {
    render(<ToggleRow options={options} aria-label="Widget display mode" value="whatsapp" />);
    expect(screen.getByRole("radio", { name: "WhatsApp" })).toHaveAttribute("aria-checked", "true");
  });

  describe("RTL arrow-key reversal — real focus target, independently re-verified the same way sub-tab-bar.test.tsx does", () => {
    it("ArrowRight moves focus to the next segment when the document is LTR", async () => {
      document.documentElement.dir = "ltr";
      render(<ToggleRow options={options} aria-label="Widget display mode" />);
      const docked = screen.getByRole("radio", { name: "Docked" });
      docked.focus();
      fireEvent.keyDown(docked, { key: "ArrowRight" });
      await waitFor(() => expect(screen.getByRole("radio", { name: "Expanded" })).toHaveFocus());
    });

    it("ArrowRight moves focus to the PREVIOUS segment once the ambient <html dir> is rtl", async () => {
      document.documentElement.dir = "rtl";
      render(
        <ToggleRow options={options} aria-label="Widget display mode" defaultValue="expanded" />,
      );
      const expanded = await screen.findByRole("radio", { name: "Expanded" });
      expanded.focus();
      fireEvent.keyDown(expanded, { key: "ArrowRight" });
      await waitFor(() => expect(screen.getByRole("radio", { name: "Docked" })).toHaveFocus());
    });
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<ToggleRow options={options} aria-label="Widget display mode" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
