import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { StatusCell, compareStatusCellRank } from "./status-cell";

describe("StatusCell", () => {
  it("variant=badge renders the real Badge atom with the status label", () => {
    render(<StatusCell label="Failed" family="destructive" rank={0} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("variant=badge-with-detail renders a Badge plus a real MonoSubLine detail line", () => {
    render(
      <StatusCell
        variant="badge-with-detail"
        label="Failed"
        family="destructive"
        rank={0}
        detail="TXN-88213"
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    const detail = screen.getByText("TXN-88213");
    expect(detail).toHaveAttribute("dir", "ltr");
  });

  it("variant=dot-with-label carries the label as a real second channel, not colour alone", () => {
    const { container } = render(
      <StatusCell variant="dot-with-label" label="Available" family="success" rank={0} />,
    );
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("sorts by status rank, not alphabetically — Failed outranks Active", () => {
    const rows = [
      { label: "Active", rank: 5 },
      { label: "Failed", rank: 0 },
      { label: "Draft", rank: 3 },
    ];
    const sorted = [...rows].sort(compareStatusCellRank);
    expect(sorted.map((row) => row.label)).toEqual(["Failed", "Draft", "Active"]);
  });

  it("has zero axe violations across all three variants", async () => {
    const { container: badge } = render(
      <StatusCell label="Failed" family="destructive" rank={0} />,
    );
    expect(await axe(badge)).toHaveNoViolations();

    const { container: withDetail } = render(
      <StatusCell
        variant="badge-with-detail"
        label="Failed"
        family="destructive"
        rank={0}
        detail="TXN-88213"
      />,
    );
    expect(await axe(withDetail)).toHaveNoViolations();

    const { container: dot } = render(
      <StatusCell variant="dot-with-label" label="Available" family="success" rank={0} />,
    );
    expect(await axe(dot)).toHaveNoViolations();
  });
});
