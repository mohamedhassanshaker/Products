// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
});

import { RolesTable, type RoleListItem } from "./RolesTable.js";

const ROLES: RoleListItem[] = [
  { id: "r1", name: "Tenant Admin", isSystem: true, permissionMatrix: {} as never, mfaRequired: false },
  { id: "r2", name: "Custom Role", isSystem: false, permissionMatrix: { connectors: "Read" } as never, mfaRequired: false },
];

describe("RolesTable", () => {
  it("the trailing actions column header is never empty for screen readers (axe-core empty-table-header)", () => {
    render(<RolesTable roles={ROLES} canWrite={true} onRefresh={vi.fn()} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(4);
    expect(headers[3]).toHaveTextContent("Actions");
  });

  it("shows system and custom roles, disabling Edit for system roles", () => {
    render(<RolesTable roles={ROLES} canWrite={true} onRefresh={vi.fn()} />);
    expect(screen.getByText("Tenant Admin")).toBeInTheDocument();
    expect(screen.getByText("Custom Role")).toBeInTheDocument();
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    expect(editButtons[0]).toBeDisabled(); // Tenant Admin — system role
    expect(editButtons[1]).not.toBeDisabled(); // Custom Role
  });

  it("hides the + New Role action when canWrite is false", () => {
    render(<RolesTable roles={ROLES} canWrite={false} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /new role/i })).not.toBeInTheDocument();
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    for (const btn of editButtons) expect(btn).toBeDisabled();
  });

  it("creates a new custom role via the modal form and refreshes", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ roleId: "r3" }) });
    render(<RolesTable roles={ROLES} canWrite={true} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /new role/i }));
    fireEvent.change(await screen.findByLabelText("Role name", { exact: false }), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/roles",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("edits a custom role via the modal form, sending the update to the correct id", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<RolesTable roles={ROLES} canWrite={true} onRefresh={onRefresh} />);

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[1]!); // Custom Role
    expect(await screen.findByText(/edit role — custom role/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/v1/admin/roles/r2", expect.objectContaining({ method: "PUT" })),
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it("surfaces a server error message instead of closing the modal", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ title: "A role named 'Ops' already exists." }),
    });
    render(<RolesTable roles={ROLES} canWrite={true} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /new role/i }));
    fireEvent.change(await screen.findByLabelText("Role name", { exact: false }), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });
});
