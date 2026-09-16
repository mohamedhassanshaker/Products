import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Label } from "./label";

describe("Label", () => {
  it("associates with its field via htmlFor and renders its text", () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <input id="email" />
      </>,
    );
    expect(screen.getByText("Email")).toHaveAttribute("for", "email");
  });

  it("renders the word 'Required' for variant=required, not an asterisk alone", () => {
    render(
      <>
        <Label htmlFor="email" variant="required">
          Email
        </Label>
        <input id="email" />
      </>,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("renders the word 'Optional' for variant=optional", () => {
    render(
      <>
        <Label htmlFor="nickname" variant="optional">
          Nickname
        </Label>
        <input id="nickname" />
      </>,
    );
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("accepts a caller-supplied (translated) marker instead of the English default", () => {
    render(
      <>
        <Label htmlFor="email" variant="required" requiredText="مطلوب">
          البريد الإلكتروني
        </Label>
        <input id="email" />
      </>,
    );
    expect(screen.getByText("مطلوب")).toBeInTheDocument();
  });

  it("has zero axe violations", async () => {
    const { container } = render(
      <>
        <Label htmlFor="email" variant="required">
          Email
        </Label>
        <input id="email" />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
