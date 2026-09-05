// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DataTableBubble } from "./DataTableBubble.js";

describe("DataTableBubble (Phase 12 / FR-MCP-07)", () => {
  afterEach(() => cleanup());

  it("renders column headers and every row's cells", () => {
    render(
      <DataTableBubble
        payload={{
          contentType: "DataTable",
          title: "Recent Orders",
          columns: ["Order", "Status"],
          rows: [
            ["#1", "Delivered"],
            ["#2", "Pending"],
          ],
        }}
      />,
    );
    expect(screen.getByText("Recent Orders")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Order" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});
