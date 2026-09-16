import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { InlineAlert } from "./inline-alert";

describe("InlineAlert", () => {
  it("info renders role=status with a visible 'Info:' prefix, not colour alone", () => {
    render(<InlineAlert variant="info">Anonymous users may view public rates.</InlineAlert>);
    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("Info:");
    expect(alert).toHaveTextContent("Anonymous users may view public rates.");
  });

  it("success renders role=status", () => {
    render(<InlineAlert variant="success">Promotion approved.</InlineAlert>);
    expect(screen.getByRole("status")).toHaveTextContent("Success:");
  });

  it("warning renders role=alert, which interrupts a screen reader — not role=status", () => {
    render(<InlineAlert variant="warning">Arabic parity is below the floor.</InlineAlert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Warning:");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("destructive renders role=alert with the 'Error:' prefix word", () => {
    render(<InlineAlert variant="destructive">Could not save the routing rule.</InlineAlert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Error:");
  });

  it("dismissible renders a labelled dismiss control that calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(
      <InlineAlert variant="info" dismissible onDismiss={onDismiss}>
        Dismiss me
      </InlineAlert>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss info message" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("is not dismissible by default — no dismiss control renders", () => {
    render(<InlineAlert variant="info">Not dismissible</InlineAlert>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has zero axe violations for a dismissible destructive alert", async () => {
    const { container } = render(
      <InlineAlert variant="destructive" dismissible onDismiss={vi.fn()}>
        Could not save the routing rule.
      </InlineAlert>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * `dismissible: true` requires `onDismiss` — never called; its only job is
 * to fail `tsc` if the `@ts-expect-error` stops being necessary.
 */
function typeLevelProofDismissibleRequiresOnDismiss() {
  return (
    // @ts-expect-error - dismissible: true requires onDismiss.
    <InlineAlert variant="info" dismissible>
      no onDismiss
    </InlineAlert>
  );
}
void typeLevelProofDismissibleRequiresOnDismiss;
