import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { KpiTile } from "./kpi-tile";

describe("KpiTile", () => {
  it("renders as a figure/figcaption with the label and formatted value", () => {
    render(<KpiTile label="Total conversations" value="36,410" />);
    expect(screen.getByText("Total conversations").closest("figcaption")).toBeInTheDocument();
    expect(screen.getByText("36,410")).toBeInTheDocument();
  });

  it("with-delta renders a direction glyph and a word, coloured success for an upward default metric", () => {
    render(
      <KpiTile
        label="Containment rate"
        value="71%"
        delta={{ direction: "up", magnitudeText: "3 pts" }}
      />,
    );
    const deltaText = screen.getByText(/up 3 pts/);
    expect(deltaText).toBeInTheDocument();
    expect(deltaText.closest("p")).toHaveClass("text-success-strong");
  });

  it("inverted-good flips the word to worse/better and the colour, without changing the glyph direction", () => {
    render(
      <KpiTile
        label="Tool error rate"
        value="3.1%"
        invertedGood
        delta={{ direction: "up", magnitudeText: "0.4 pts" }}
      />,
    );
    const deltaText = screen.getByText(/worse 0.4 pts/);
    expect(deltaText).toBeInTheDocument();
    expect(deltaText.closest("p")).toHaveClass("text-destructive-strong");
  });

  it("inverted-good reads a downward move as better", () => {
    render(
      <KpiTile
        label="Tool error rate"
        value="2.7%"
        invertedGood
        delta={{ direction: "down", magnitudeText: "0.4 pts" }}
      />,
    );
    const deltaText = screen.getByText(/better 0.4 pts/);
    expect(deltaText.closest("p")).toHaveClass("text-success-strong");
  });

  it("with-sparkline renders an inline, LTR, non-mirroring SVG polyline from the numeric array", () => {
    const { container } = render(
      <KpiTile label="Conversations" value="36,410" sparklineValues={[10, 14, 9, 20, 18]} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveAttribute("dir", "ltr");
    expect(container.querySelector("polyline")).toBeInTheDocument();
  });

  it("loading renders a skeleton and no value text", () => {
    render(<KpiTile label="Total conversations" state="loading" />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
    expect(screen.queryByText("36,410")).not.toBeInTheDocument();
  });

  it("error renders the error message as an alert", () => {
    render(
      <KpiTile
        label="Total conversations"
        state="error"
        errorMessage="Could not load this metric"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this metric");
  });

  it("empty renders an em dash labelled for screen readers", () => {
    render(<KpiTile label="Total conversations" state="empty" />);
    expect(screen.getByLabelText("no data for this range")).toHaveTextContent("—");
  });

  it("empty's accessible name is overridable, e.g. for a future translated string", () => {
    render(
      <KpiTile label="Total conversations" state="empty" emptyLabel="لا توجد بيانات لهذا النطاق" />,
    );
    expect(screen.getByLabelText("لا توجد بيانات لهذا النطاق")).toHaveTextContent("—");
  });

  it("has zero axe violations with a delta and a sparkline", async () => {
    const { container } = render(
      <KpiTile
        label="Containment rate"
        value="71%"
        delta={{ direction: "up", magnitudeText: "3 pts" }}
        sparklineValues={[10, 14, 9, 20, 18]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
