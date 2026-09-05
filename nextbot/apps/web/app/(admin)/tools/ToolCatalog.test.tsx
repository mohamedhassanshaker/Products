// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("../../../src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ToolCatalog } from "./ToolCatalog.js";

/** shadcn/Tailwind conversion (Batch D) — same `chooseOption` helper this migration
 * established in `RoutingConfig.test.tsx` (Batch A) for driving the new Base
 * UI-backed `Select` instead of a native `<select>`'s `fireEvent.change`. */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  const trigger = await screen.findByRole("combobox", { name: triggerName });
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

const tools = [
  {
    id: "t1",
    name: "get_ticket",
    displayName: null,
    connectorId: "conn-1",
    rwClass: "Read" as const,
    approvalTier: "Tier1" as const,
    visibleToAgent: true,
    priorityWeight: 50,
    status: "Active" as const,
    lastCalledAt: null,
  },
  {
    id: "t2",
    name: "delete_invoice",
    displayName: "Delete Invoice",
    connectorId: "conn-2",
    rwClass: "Write" as const,
    approvalTier: "Tier2" as const,
    visibleToAgent: false,
    priorityWeight: 80,
    status: "Disabled" as const,
    lastCalledAt: null,
  },
];

describe("ToolCatalog (QA Defects U3/U4/U11)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the full-page access-denied state on a 403 (QA Defect U3)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<ToolCatalog canMutate={false} />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("renders the genuinely-empty state on a real empty ok response", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tools: [] } });
    render(<ToolCatalog canMutate={false} />);
    expect(await screen.findByText(/no tools discovered yet/i)).toBeInTheDocument();
  });

  // QA Final Review S2: reaching the permission-rule matrix must not require a
  // hand-crafted API call — this link is the fix.
  it("links each tool to its own permission-rule editor", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tools } });
    render(<ToolCatalog canMutate={false} />);
    await screen.findByText("get_ticket");
    const links = screen.getAllByRole("link", { name: /edit permissions/i });
    expect(links[0]).toHaveAttribute("href", "/tools/t1/permissions");
  });

  it("disables the visibility switch and priority weight input when canMutate is false (QA Defect U4)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tools } });
    render(<ToolCatalog canMutate={false} />);
    await screen.findByText("get_ticket");

    // Base UI's `Switch` (unlike Chakra's, which delegated straight to a native
    // `<input type="checkbox" disabled>`) renders its interactive root as a `<span
    // role="switch">` with a *hidden* native input beside it for form submission —
    // jest-dom's `toBeDisabled()` only recognizes a real form element's `disabled`
    // attribute (or a `<fieldset disabled>` ancestor), not `aria-disabled`, so it
    // can never see this span as disabled. Assert the real signal Base UI does set
    // instead (`aria-disabled`, which is also what assistive tech reads).
    expect(screen.getByLabelText("Toggle visibility for get_ticket")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByLabelText("Priority weight for get_ticket")).toBeDisabled();
  });

  it("enables mutating controls when canMutate is true", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tools } });
    render(<ToolCatalog canMutate={true} />);
    await screen.findByText("get_ticket");

    expect(screen.getByLabelText("Toggle visibility for get_ticket")).not.toHaveAttribute("aria-disabled", "true");
  });

  it("filters by type (rwClass) via the filter bar (QA Defect U11)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tools } });
    render(<ToolCatalog canMutate={false} />);
    await screen.findByText("get_ticket");
    expect(screen.getByText("Delete Invoice")).toBeInTheDocument();

    await chooseOption("Filter by type", "Write");

    expect(screen.queryByText("get_ticket")).not.toBeInTheDocument();
    expect(screen.getByText("Delete Invoice")).toBeInTheDocument();
  });

  it("filters by status via the filter bar (QA Defect U11)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tools } });
    render(<ToolCatalog canMutate={false} />);
    await screen.findByText("get_ticket");

    await chooseOption("Filter by status", "Disabled");

    expect(screen.queryByText("get_ticket")).not.toBeInTheDocument();
    expect(screen.getByText("Delete Invoice")).toBeInTheDocument();
  });

  it("shows a 'no tools match filters' message distinct from the genuinely-empty state", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tools } });
    render(<ToolCatalog canMutate={false} />);
    await screen.findByText("get_ticket");

    await chooseOption("Filter by tier", "Tier 3");
    expect(await screen.findByText(/no tools match the current filters/i)).toBeInTheDocument();
  });

  it("renders '—' for a tool that has never been called", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { tools } });
    render(<ToolCatalog canMutate={false} />);
    await screen.findByText("get_ticket");
    expect(screen.getAllByLabelText("no call data yet")).toHaveLength(2);
  });
});
