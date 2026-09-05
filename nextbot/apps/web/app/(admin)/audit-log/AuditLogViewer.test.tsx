// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { AuditLogViewer } from "./AuditLogViewer.js";

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

const ENTRIES = [
  {
    id: "e1",
    occurredAt: new Date().toISOString(),
    actorLabel: "admin@example.com",
    actionType: "role.update",
    targetType: "Role",
    targetId: "r1",
    outcome: "Success" as const,
    // Already masked server-side (`queryMaskedAuditLog`) before this component ever
    // sees it — this fixture stands in for what a real masked payload looks like.
    details: { before: { name: "Old" }, after: { name: "New" }, actorEmail: "a***@example.com" },
  },
];

describe("AuditLogViewer (B.8.2 — filterable/searchable columns, masked detail drawer, CSV/JSON export)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the full-page access-denied state on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<AuditLogViewer />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("renders a real audit entry row", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { entries: ENTRIES } });
    render(<AuditLogViewer />);
    expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("role.update")).toBeInTheDocument();
    expect(screen.getByText("Role:r1")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
  });

  it("opens the masked-detail drawer on row click and shows the already-masked details verbatim (QA fix UI-D2)", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { entries: ENTRIES } });
    render(<AuditLogViewer />);
    const row = await screen.findByText("role.update");
    fireEvent.click(row.closest("tr")!);
    expect(await screen.findByText(/detail — role\.update/i)).toBeInTheDocument();
    // The masked actor email (`a***@example.com`) rendered verbatim — this component
    // never re-derives or further transforms `details`, it only displays what the
    // already-masked backend query returned.
    expect(screen.getByText(/a\*\*\*@example\.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText(/detail — role\.update/i)).not.toBeInTheDocument();
  });

  it("applies filters (outcome + free-text search) and re-fetches with them", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { entries: ENTRIES } });
    render(<AuditLogViewer />);
    await screen.findByText("role.update");

    fireEvent.change(screen.getByPlaceholderText("Search action/actor/target..."), { target: { value: "role" } });
    await chooseOption("Outcome", "Success");
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenLastCalledWith(expect.stringContaining("search=role")),
    );
    expect(fetchJsonMock.mock.calls.at(-1)![0]).toContain("outcome=Success");
  });

  it("exposes CSV/JSON export as real links to the export endpoints", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { entries: ENTRIES } });
    render(<AuditLogViewer />);
    await screen.findByText("role.update");
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/v1/admin/audit-log/export?format=csv");
    expect(screen.getByRole("link", { name: "Export JSON" })).toHaveAttribute("href", "/api/v1/admin/audit-log/export?format=json");
  });
});
