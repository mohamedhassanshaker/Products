import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { FormField } from "./form-field";
import { Input } from "./input";
import { TooltipProvider } from "./tooltip";

describe("FormField", () => {
  it("wires a generated id between the label and the control, with no error/help present", () => {
    render(
      <FormField label="Team name">
        {(field) => <Input {...field} placeholder="e.g. Platform" />}
      </FormField>,
    );
    const input = screen.getByRole("textbox", { name: "Team name" });
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("an explicit id override is used instead of the generated one", () => {
    render(
      <FormField label="Team name" id="team-name">
        {(field) => <Input {...field} />}
      </FormField>,
    );
    expect(screen.getByRole("textbox", { name: "Team name" })).toHaveAttribute("id", "team-name");
  });

  it("help text is wired via aria-describedby when there is no error", () => {
    render(
      <FormField label="Team name" help="Shown to members when they pick a team.">
        {(field) => <Input {...field} />}
      </FormField>,
    );
    const input = screen.getByRole("textbox", { name: "Team name" });
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Shown to members when they pick a team.",
    );
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("an error marks the control invalid, is announced via role=alert, and replaces the help text rather than stacking under it", () => {
    render(
      <FormField
        label="Team name"
        help="Shown to members when they pick a team."
        error="A team with this name already exists."
      >
        {(field) => <Input {...field} />}
      </FormField>,
    );
    const input = screen.getByRole("textbox", { name: "Team name" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description).toHaveTextContent("A team with this name already exists.");
    expect(description).toHaveAttribute("role", "alert");
    expect(screen.queryByText("Shown to members when they pick a team.")).not.toBeInTheDocument();
  });

  it("the required marker is the word 'Required', not an asterisk alone (mirrors label.tsx's own rule)", () => {
    render(
      <FormField label="Team name" labelVariant="required">
        {(field) => <Input {...field} />}
      </FormField>,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("renders all three layout variants without error", () => {
    for (const variant of ["stacked", "inline", "horizontal"] as const) {
      const { unmount } = render(
        <FormField label={`Field (${variant})`} variant={variant}>
          {(field) => <Input {...field} />}
        </FormField>,
      );
      expect(screen.getByRole("textbox", { name: `Field (${variant})` })).toBeInTheDocument();
      unmount();
    }
  });

  it("has zero axe violations with an error present", async () => {
    const { container } = render(
      <FormField label="Team name" error="A team with this name already exists.">
        {(field) => <Input {...field} />}
      </FormField>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  describe("labelHelp", () => {
    it("renders no help icon when labelHelp is omitted", () => {
      render(
        <FormField label="Team name">{(field) => <Input {...field} />}</FormField>,
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("a real accessible icon button opens a tooltip with the given content on focus", async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <FormField
            label="Slot name"
            labelHelp="The name this answer is stored under, for later nodes to reference."
            labelHelpAriaLabel="More information about Slot name"
          >
            {(field) => <Input {...field} />}
          </FormField>
        </TooltipProvider>,
      );
      const trigger = screen.getByRole("button", { name: "More information about Slot name" });
      expect(
        screen.queryByText("The name this answer is stored under, for later nodes to reference."),
      ).not.toBeInTheDocument();

      fireEvent.focus(trigger);
      await waitFor(() =>
        expect(
          screen.getByText("The name this answer is stored under, for later nodes to reference."),
        ).toBeInTheDocument(),
      );
    });

    it("falls back to a generic accessible name when labelHelpAriaLabel is omitted", () => {
      render(
        <TooltipProvider delayDuration={0}>
          <FormField label="Slot name" labelHelp="Some guidance.">
            {(field) => <Input {...field} />}
          </FormField>
        </TooltipProvider>,
      );
      expect(screen.getByRole("button", { name: "More information" })).toBeInTheDocument();
    });

    it("the help/error text below the field is untouched by labelHelp — both can be present at once", () => {
      render(
        <TooltipProvider delayDuration={0}>
          <FormField
            label="Slot name"
            help="Shown permanently below the field."
            labelHelp="Shown only in the tooltip."
            labelHelpAriaLabel="More information about Slot name"
          >
            {(field) => <Input {...field} />}
          </FormField>
        </TooltipProvider>,
      );
      expect(screen.getByText("Shown permanently below the field.")).toBeInTheDocument();
      expect(screen.queryByText("Shown only in the tooltip.")).not.toBeInTheDocument();
    });

    it("has zero axe violations with a labelHelp tooltip present and open", async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <FormField
            label="Slot name"
            labelHelp="Some guidance."
            labelHelpAriaLabel="More information about Slot name"
          >
            {(field) => <Input {...field} />}
          </FormField>
        </TooltipProvider>,
      );
      fireEvent.focus(screen.getByRole("button", { name: "More information about Slot name" }));
      await waitFor(() => expect(screen.getByText("Some guidance.")).toBeInTheDocument());
      expect(
        await axe(document.body, { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations();
    });
  });
});
