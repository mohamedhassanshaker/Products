import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
vi.mock("./session", () => ({
  getSession: () => getSessionMock(),
}));

const { getModuleAccessLevel, hasModuleAccess } = await import("./require-module-access.js");

describe("getModuleAccessLevel / hasModuleAccess (QA Defect U3 — SSR fail-closed guard)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });

  it("returns 'None' (fail-closed) when there is no session at all", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await getModuleAccessLevel("connectors")).toBe("None");
    expect(await hasModuleAccess("connectors", "Read")).toBe(false);
  });

  it("returns 'None' when the session's matrix has no entry for the module", async () => {
    getSessionMock.mockResolvedValue({ permissions: {} });
    expect(await getModuleAccessLevel("connectors")).toBe("None");
  });

  it("returns the session's actual level for the module", async () => {
    getSessionMock.mockResolvedValue({ permissions: { connectors: "Read" } });
    expect(await getModuleAccessLevel("connectors")).toBe("Read");
    expect(await hasModuleAccess("connectors", "Read")).toBe(true);
    expect(await hasModuleAccess("connectors", "Write")).toBe(false);
  });
});
