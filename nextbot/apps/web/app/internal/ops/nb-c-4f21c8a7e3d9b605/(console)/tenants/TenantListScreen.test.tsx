// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { TenantListScreen } from "./TenantListScreen.js";

const TENANTS = [
  {
    id: "t1",
    name: "Beta Co",
    slug: "beta-co",
    region: "EU",
    status: "Active",
    planTier: "Growth",
    createdAt: new Date().toISOString(),
    maxConcurrentRuns: 10,
    liveConcurrentRuns: 3,
  },
  {
    id: "t2",
    name: "Alpha Co",
    slug: "alpha-co",
    region: "US",
    status: "Suspended",
    planTier: "Starter",
    createdAt: new Date().toISOString(),
    maxConcurrentRuns: null,
    liveConcurrentRuns: 0,
  },
];

describe("TenantListScreen (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders every tenant sorted by name by default", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tenants: TENANTS } });
    render(<TenantListScreen />);

    await waitFor(() => expect(screen.getByText("Alpha Co")).toBeInTheDocument());
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows[0]).toHaveTextContent("Alpha Co");
    expect(rows[1]).toHaveTextContent("Beta Co");
  });

  it("shows the live concurrent-run gauge with its cap, or 'no cap'", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tenants: TENANTS } });
    render(<TenantListScreen />);
    await waitFor(() => expect(screen.getByText(/3 \/ 10/)).toBeInTheDocument());
    expect(screen.getByText(/0 \(no cap\)/)).toBeInTheDocument();
  });

  it("filters by name/slug", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tenants: TENANTS } });
    render(<TenantListScreen />);
    await waitFor(() => expect(screen.getByText("Alpha Co")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/filter by name or slug/i), { target: { value: "beta" } });
    expect(screen.queryByText("Alpha Co")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Co")).toBeInTheDocument();
  });

  it("renders the error alert on a fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 500, message: "Something went wrong." });
    render(<TenantListScreen />);
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
  });
});
