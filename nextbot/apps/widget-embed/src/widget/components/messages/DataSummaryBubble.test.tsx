// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DataSummaryBubble } from "./DataSummaryBubble.js";

describe("DataSummaryBubble (Phase 12 / FR-MCP-07)", () => {
  afterEach(() => cleanup());

  it("renders a title and each labeled field", () => {
    render(
      <DataSummaryBubble
        payload={{
          contentType: "DataSummary",
          title: "Order #4821",
          fields: [
            { label: "Status", value: "Shipped" },
            { label: "ETA", value: "Aug 18" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Order #4821")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Shipped")).toBeInTheDocument();
    expect(screen.getByText("ETA")).toBeInTheDocument();
    expect(screen.getByText("Aug 18")).toBeInTheDocument();
  });

  it("renders without a title", () => {
    render(<DataSummaryBubble payload={{ contentType: "DataSummary", fields: [{ label: "Total", value: "$42" }] }} />);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("$42")).toBeInTheDocument();
  });
});
