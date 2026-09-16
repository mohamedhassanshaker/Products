import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders a headline, a one-line cause, and defaults to the first-run variant", () => {
    render(<EmptyState headline="No agents yet" cause="Create your first agent to get started." />);
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByText("Create your first agent to get started.")).toBeInTheDocument();
  });

  it("renders the single resolving action and fires its callback", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        headline="No agents yet"
        cause="Create your first agent to get started."
        action={{ label: "Create agent", onClick }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders no action button when none is given", () => {
    render(
      <EmptyState headline="No results" cause="Try a different search." variant="no-results" />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("no-permission names the required role via the default English template", () => {
    render(
      <EmptyState
        headline="You can't view this"
        variant="no-permission"
        requiredRole="Agent Designer"
      />,
    );
    expect(screen.getByText("You need the Agent Designer role to view this.")).toBeInTheDocument();
  });

  it("no-permission's causeTemplate override still receives the structured role, not a freeform string", () => {
    render(
      <EmptyState
        headline="You can't view this"
        variant="no-permission"
        requiredRole="Agent Designer"
        causeTemplate={(role) => `يتطلب هذا دور ${role}`}
      />,
    );
    expect(screen.getByText("يتطلب هذا دور Agent Designer")).toBeInTheDocument();
  });

  it("error variant announces via role=alert", () => {
    render(<EmptyState headline="Couldn't load" cause="The request failed." variant="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("The request failed.");
  });

  it("has zero axe violations for the first-run and no-permission variants", async () => {
    const { container: firstRun } = render(
      <EmptyState headline="No agents yet" cause="Create your first agent to get started." />,
    );
    expect(await axe(firstRun)).toHaveNoViolations();

    const { container: noPermission } = render(
      <EmptyState
        headline="You can't view this"
        variant="no-permission"
        requiredRole="Agent Designer"
      />,
    );
    expect(await axe(noPermission)).toHaveNoViolations();
  });
});
