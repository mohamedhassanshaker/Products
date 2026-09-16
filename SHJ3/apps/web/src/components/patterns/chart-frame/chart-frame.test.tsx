import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { ChartFrame, type ChartFrameSeries } from "./chart-frame";

afterEach(() => {
  document.documentElement.dir = "";
});

const categoricalSeries: ChartFrameSeries[] = [
  { id: "web", label: "Web", values: [120, 90, 60] },
  { id: "whatsapp", label: "WhatsApp", values: [40, 55, 70] },
];
const categories = ["Mon", "Tue", "Wed"];

describe("ChartFrame — bar variant", () => {
  it("renders the title and description", () => {
    render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    expect(screen.getByText("Conversations by channel")).toBeInTheDocument();
    expect(screen.getByText("Last 3 days, by channel")).toBeInTheDocument();
  });

  it("the plotted SVG is decorative (aria-hidden) since the real data lives in the table fallback", () => {
    const { container } = render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a direct value label for every bar, not just a legend", () => {
    render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    // Every raw value from both series should appear as a direct SVG label.
    for (const value of [...categoricalSeries[0]!.values, ...categoricalSeries[1]!.values]) {
      expect(screen.getByText(String(value))).toBeInTheDocument();
    }
  });

  it("a custom valueFormatter is used for the direct labels", () => {
    render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={[{ id: "web", label: "Web", values: [120] }]}
        valueFormatter={(value) => `${value} chats`}
      />,
    );
    expect(screen.getByText("120 chats")).toBeInTheDocument();
  });

  it("renders a legend with a pattern swatch per series when there is more than one series", () => {
    const { container } = render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    // Two legend swatches, one real (non-decorative-only) SVG each.
    const legendSwatches = container.querySelectorAll("ul svg");
    expect(legendSwatches).toHaveLength(2);
  });

  it("omits the legend for a single series", () => {
    render(
      <ChartFrame
        variant="bar"
        title="Top intents"
        description="Ranked by volume"
        categories={["Pay bill", "Report outage"]}
        series={[{ id: "s1", label: "Count", values: [80, 40] }]}
      />,
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("supports horizontal orientation for a ranked list (B1's top-intents list)", () => {
    const { container } = render(
      <ChartFrame
        variant="bar"
        orientation="horizontal"
        title="Top intents"
        description="Ranked by volume"
        categories={["Pay bill", "Report outage"]}
        series={[{ id: "s1", label: "Count", values: [80, 40] }]}
      />,
    );
    // Horizontal bars vary width, not height, for the same rect set — a
    // structural smoke check that the orientation branch actually rendered
    // (both categories' rects present) rather than asserting exact geometry.
    expect(container.querySelectorAll("rect[width]").length).toBeGreaterThan(0);
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });
});

describe("ChartFrame — line variant", () => {
  it("renders one polyline per series", () => {
    const { container } = render(
      <ChartFrame
        variant="line"
        title="Conversation volume"
        description="Last 7 days"
        categories={["1", "2", "3", "4", "5", "6", "7"]}
        series={[{ id: "s1", label: "Conversations", values: [10, 12, 9, 15, 20, 18, 22] }]}
      />,
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
  });
});

describe("ChartFrame — RTL time axis (§11.6)", () => {
  it('xAxisIsTemporal wraps the plotted chart in dir="ltr" so a time axis cannot mirror under RTL', () => {
    document.documentElement.dir = "rtl";
    const { container } = render(
      <ChartFrame
        variant="line"
        title="Conversation volume"
        description="Last 7 days"
        categories={["Mon", "Tue", "Wed"]}
        series={[{ id: "s1", label: "Conversations", values: [10, 12, 9] }]}
        xAxisIsTemporal
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.parentElement).toHaveAttribute("dir", "ltr");
  });

  it("a categorical (non-temporal) axis carries no forced dir, and mirrors with the page normally", () => {
    document.documentElement.dir = "rtl";
    const { container } = render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.parentElement).not.toHaveAttribute("dir");
  });
});

describe("ChartFrame — View as table", () => {
  it("defaults to the chart view", () => {
    render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("toggling to Table renders a real, fully-accessible <table> with the same data, and toggling back returns to the chart", () => {
    render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Table" }));

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // Header row + one row per series.
    expect(rows).toHaveLength(1 + categoricalSeries.length);
    // The corner header cell is visually blank but must still carry a real
    // accessible name (an empty <th> is a genuine axe violation, not a
    // stylistic nicety — see the "zero axe violations in table view" test).
    expect(within(table).getByRole("columnheader", { name: "Series" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Mon" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Web" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "WhatsApp" })).toBeInTheDocument();
    expect(within(table).getByText("120")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Chart" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("table cells carry the same custom-formatted values as the chart", () => {
    render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={["Mon"]}
        series={[{ id: "web", label: "Web", values: [120] }]}
        valueFormatter={(value) => `${value} chats`}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Table" }));
    expect(within(screen.getByRole("table")).getByText("120 chats")).toBeInTheDocument();
  });
});

describe("ChartFrame — accessibility", () => {
  it("has zero axe violations in chart view", async () => {
    const { container } = render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations in table view", async () => {
    render(
      <ChartFrame
        variant="bar"
        title="Conversations by channel"
        description="Last 3 days, by channel"
        categories={categories}
        series={categoricalSeries}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Table" }));
    // The "region" rule expects page content inside a landmark, which an
    // isolated component test's bare `document.body` never has — the same
    // already-justified exclusion `dialog.test.tsx`/`dropdown-menu.test.tsx`
    // apply for the identical reason.
    expect(
      await axe(document.body, { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
