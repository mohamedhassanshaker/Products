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

import { UsersTable } from "./UsersTable.js";

const ROLES = [
  { id: "r1", name: "Tenant Admin", isSystem: true },
  { id: "r2", name: "Read-Only", isSystem: true },
];

const USERS = [
  {
    id: "u1",
    email: "ada@example.com",
    displayName: "Ada Admin",
    status: "Active" as const,
    lastLoginAt: null,
    mfaEnrolled: false,
    roles: [{ id: "r1", name: "Tenant Admin" }],
  },
  {
    id: "u2",
    email: "orphan@example.com",
    displayName: "No Role Yet",
    status: "Invited" as const,
    lastLoginAt: null,
    mfaEnrolled: false,
    roles: [],
  },
];

describe("UsersTable", () => {
  it("renders the user table with name, email, roles, last login, and MFA status", () => {
    render(<UsersTable users={USERS} roles={ROLES} canWrite={true} onRefresh={vi.fn()} />);
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Tenant Admin")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0); // no last login yet
    expect(screen.getAllByText("Not enrolled").length).toBe(2); // both seeded users are unenrolled
  });

  it("QA D3: the trailing actions column header is never empty for screen readers", () => {
    render(<UsersTable users={USERS} roles={ROLES} canWrite={true} onRefresh={vi.fn()} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(6);
    // Visually hidden, but present in the accessible name — axe-core's
    // `empty-table-header` rule requires exactly this.
    expect(headers[5]).toHaveTextContent("Actions");
  });

  it("flags a user with zero assigned roles (FR-ADM-02 fail-closed) distinctly", () => {
    render(<UsersTable users={USERS} roles={ROLES} canWrite={true} onRefresh={vi.fn()} />);
    expect(screen.getByText(/no role — cannot sign in/i)).toBeInTheDocument();
  });

  it("hides mutating actions when canWrite is false", () => {
    render(<UsersTable users={USERS} roles={ROLES} canWrite={false} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /invite user/i })).not.toBeInTheDocument();
    for (const btn of screen.getAllByRole("button", { name: "Change roles" })) expect(btn).toBeDisabled();
  });

  it("creates a user via the invite modal, requiring at least one role", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ userId: "u3" }) });
    render(<UsersTable users={USERS} roles={ROLES} canWrite={true} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /invite user/i }));
    // `exact: false` — these fields are `isRequired`, so Chakra appends a visually
    // presentational "*" to the label's rendered text content (still `aria-hidden`,
    // but `dom-testing-library`'s label-text match uses raw textContent, not the
    // accessible name computation that would exclude it).
    fireEvent.change(await screen.findByLabelText("Display name", { exact: false }), { target: { value: "New Person" } });
    fireEvent.change(screen.getByLabelText("Email", { exact: false }), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Initial password", { exact: false }), { target: { value: "supersecret1" } });

    // Create should stay disabled until a role is selected.
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    // Base UI's `Checkbox` renders a visible `span[role=checkbox]` plus a hidden
    // native `<input type="checkbox">` for form participation, both associated with
    // the same wrapping `<label>` — `getByLabelText` matches both, so grab the first
    // (the visible, actually-clickable control).
    fireEvent.click(screen.getAllByLabelText("Read-Only (System)")[0]!);
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/users",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"roleIds":["r2"]') }),
    );
  });

  it("reassigns roles via the change-roles modal", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<UsersTable users={USERS} roles={ROLES} canWrite={true} onRefresh={onRefresh} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Change roles" })[0]!);
    expect(await screen.findByText(/change roles — ada admin/i)).toBeInTheDocument();
    // Base UI's `Checkbox` renders a visible `span[role=checkbox]` plus a hidden
    // native `<input type="checkbox">` for form participation, both associated with
    // the same wrapping `<label>` — `getByLabelText` matches both, so grab the first
    // (the visible, actually-clickable control).
    fireEvent.click(screen.getAllByLabelText("Read-Only (System)")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/v1/admin/users/u1/roles", expect.objectContaining({ method: "PUT" })),
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it("resets a user's MFA enrollment only when they are enrolled", async () => {
    const enrolledUser = { ...USERS[0]!, mfaEnrolled: true };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<UsersTable users={[enrolledUser, USERS[1]!]} roles={ROLES} canWrite={true} onRefresh={vi.fn()} />);

    const resetButtons = screen.getAllByRole("button", { name: "Reset MFA" });
    expect(resetButtons[0]).not.toBeDisabled(); // enrolled
    expect(resetButtons[1]).toBeDisabled(); // not enrolled

    fireEvent.click(resetButtons[0]!);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/v1/admin/users/u1/mfa-reset", expect.objectContaining({ method: "POST" })),
    );
  });
});
