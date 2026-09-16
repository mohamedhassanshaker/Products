import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { ChipInput } from "./chip-input";

describe("ChipInput", () => {
  it("renders existing chips, each with a separately focusable, correctly labelled remove button", () => {
    render(
      <ChipInput
        chips={["sharjah.ae", "shj.ae"]}
        onChipsChange={vi.fn()}
        aria-label="Allowed domains"
      />,
    );
    expect(screen.getByText("sharjah.ae")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove sharjah.ae" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove shj.ae" })).toBeInTheDocument();
  });

  it("Enter commits the typed text as a new chip and clears the input", () => {
    const onChipsChange = vi.fn();
    render(
      <ChipInput
        chips={["sharjah.ae"]}
        onChipsChange={onChipsChange}
        aria-label="Allowed domains"
      />,
    );
    const input = screen.getByRole("textbox", { name: "Allowed domains" });
    fireEvent.change(input, { target: { value: "shj.ae" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChipsChange).toHaveBeenCalledWith(["sharjah.ae", "shj.ae"]);
    expect(input).toHaveValue("");
  });

  it("a configured delimiter key (comma) also commits the current text", () => {
    const onChipsChange = vi.fn();
    render(
      <ChipInput
        chips={[]}
        onChipsChange={onChipsChange}
        aria-label="Tags"
        delimiterKeys={[","]}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Tags" });
    fireEvent.change(input, { target: { value: "billing" } });
    fireEvent.keyDown(input, { key: "," });
    expect(onChipsChange).toHaveBeenCalledWith(["billing"]);
  });

  it("rejects a duplicate chip with an inline message and does not call onChipsChange", () => {
    const onChipsChange = vi.fn();
    render(
      <ChipInput
        chips={["sharjah.ae"]}
        onChipsChange={onChipsChange}
        aria-label="Allowed domains"
      />,
    );
    const input = screen.getByRole("textbox", { name: "Allowed domains" });
    fireEvent.change(input, { target: { value: "sharjah.ae" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChipsChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("This value has already been added.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("Backspace on an empty input removes the last chip", () => {
    const onChipsChange = vi.fn();
    render(
      <ChipInput
        chips={["sharjah.ae", "shj.ae"]}
        onChipsChange={onChipsChange}
        aria-label="Allowed domains"
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Allowed domains" }), {
      key: "Backspace",
    });
    expect(onChipsChange).toHaveBeenCalledWith(["sharjah.ae"]);
  });

  it("Backspace with text still in the input does not remove a chip", () => {
    const onChipsChange = vi.fn();
    render(
      <ChipInput
        chips={["sharjah.ae"]}
        onChipsChange={onChipsChange}
        aria-label="Allowed domains"
      />,
    );
    const input = screen.getByRole("textbox", { name: "Allowed domains" });
    fireEvent.change(input, { target: { value: "partial" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChipsChange).not.toHaveBeenCalled();
  });

  it("clicking one chip's remove button removes exactly that chip, not another", () => {
    const onChipsChange = vi.fn();
    render(
      <ChipInput
        chips={["sharjah.ae", "shj.ae", "customs.shj.ae"]}
        onChipsChange={onChipsChange}
        aria-label="Allowed domains"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove shj.ae" }));
    expect(onChipsChange).toHaveBeenCalledWith(["sharjah.ae", "customs.shj.ae"]);
  });

  it("validated variant rejects a candidate that fails validate(), leaving the input intact", () => {
    const onChipsChange = vi.fn();
    render(
      <ChipInput
        chips={[]}
        onChipsChange={onChipsChange}
        aria-label="Allowed domains"
        variant="validated"
        validate={(candidate) =>
          candidate.includes(".") ? undefined : "Enter a full domain, e.g. shj.ae"
        }
      />,
    );
    const input = screen.getByRole("textbox", { name: "Allowed domains" });
    fireEvent.change(input, { target: { value: "notadomain" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChipsChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a full domain, e.g. shj.ae");
    expect(input).toHaveValue("notadomain");
  });

  it("has zero axe violations with chips and an error both present", async () => {
    const { container } = render(
      <ChipInput chips={["sharjah.ae"]} onChipsChange={vi.fn()} aria-label="Allowed domains" />,
    );
    const input = screen.getByRole("textbox", { name: "Allowed domains" });
    fireEvent.change(input, { target: { value: "sharjah.ae" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
