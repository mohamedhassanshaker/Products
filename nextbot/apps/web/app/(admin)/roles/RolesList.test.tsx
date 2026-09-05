// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

const fetchJsonMock = vi.fn();
vi.mock("../../../src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { RolesList } from "./RolesList.js";

const ROLES = [
  { id: "r1", name: "Tenant Admin", isSystem: true, permissionMatrix: {}, mfaRequired: false },
  { id: "r2", name: "My Custom Role", isSystem: false, permissionMatrix: {}, mfaRequired: true },
];

const USERS = [
  {
    id: "u1",
    email: "admin@example.com",
    displayName: "Ada Admin",
    status: "Active" as const,
    lastLoginAt: "2026-01-01T00:00:00.000Z",
    mfaEnrolled: true,
    roles: [{ id: "r1", name: "Tenant Admin" }],
  },
];

function mockOk() {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url === "/api/v1/admin/users") return Promise.resolve({ kind: "ok", data: { users: USERS } });
    if (url === "/api/v1/admin/roles") return Promise.resolve({ kind: "ok", data: { roles: ROLES } });
    throw new Error(`unexpected url ${url}`);
  });
}

describe("RolesList (Users & Roles screen)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the full-page access-denied state when either fetch 403s (QA Defect U3)", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url === "/api/v1/admin/users") return Promise.resolve({ kind: "forbidden", message: "denied" });
      return Promise.resolve({ kind: "ok", data: { roles: ROLES } });
    });
    render(<RolesList canWrite={false} />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("renders an h1 heading and the Users/Roles/SSO tabs on a real ok response", async () => {
    mockOk();
    render(<RolesList canWrite={true} />);
    expect(await screen.findByRole("heading", { level: 1, name: /users & roles/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Roles" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "SSO" })).toBeInTheDocument();
  });

  it("shows the seeded users in the Users tab by default", async () => {
    mockOk();
    render(<RolesList canWrite={true} />);
    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    // "Tenant Admin" appears at least once via the Users tab's role badge — the
    // Roles tab's panel (which would also render "Tenant Admin" as a row) is
    // unmounted while inactive under Base UI's `Tabs` (unlike Chakra's, which kept
    // every panel mounted by default), so this only asserts presence, not
    // uniqueness, to stay valid under either mounting strategy.
    expect(screen.getAllByText("Tenant Admin").length).toBeGreaterThan(0);
    expect(screen.getByText("Enrolled")).toBeInTheDocument();
  });

  it("shows the + Invite User action only when canWrite is true", async () => {
    mockOk();
    render(<RolesList canWrite={false} />);
    await screen.findByText("Ada Admin");
    expect(screen.queryByRole("button", { name: /invite user/i })).not.toBeInTheDocument();
    cleanup();

    mockOk();
    render(<RolesList canWrite={true} />);
    expect(await screen.findByRole("button", { name: /invite user/i })).toBeInTheDocument();
  });
});
