import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Input } from "./input";

describe("Input", () => {
  it("renders in its default state and accepts typed input", () => {
    const onChange = vi.fn();
    render(<Input aria-label="Agent name" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Agent name" });
    fireEvent.change(input, { target: { value: "Billing agent" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(input).toHaveValue("Billing agent");
  });

  it("forces dir=ltr and a bidi isolate on the mono variant regardless of ambient direction", () => {
    render(
      <div dir="rtl">
        <Input
          aria-label="MCP endpoint"
          variant="mono"
          defaultValue="mcp://sharjah-services.internal"
        />
      </div>,
    );
    const input = screen.getByRole("textbox", { name: "MCP endpoint" });
    expect(input).toHaveAttribute("dir", "ltr");
    expect(input).toHaveStyle({ unicodeBidi: "isolate" });
  });

  it("does not force dir on the default variant, leaving it to inherit", () => {
    render(<Input aria-label="Display name" />);
    expect(screen.getByRole("textbox", { name: "Display name" })).not.toHaveAttribute("dir");
  });

  it("marks itself invalid via the standard aria-invalid prop, not a colour-only signal", () => {
    render(<Input aria-label="Email" aria-invalid aria-describedby="email-error" />);
    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
  });

  it("shows a loading indicator and sets aria-busy", () => {
    const { container } = render(<Input aria-label="Checking availability" loading />);
    expect(screen.getByRole("textbox", { name: "Checking availability" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("disables the field natively when disabled", () => {
    render(<Input aria-label="Locked field" disabled />);
    expect(screen.getByRole("textbox", { name: "Locked field" })).toBeDisabled();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Input aria-label="Search transcripts" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
