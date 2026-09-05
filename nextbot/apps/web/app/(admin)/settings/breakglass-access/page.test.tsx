// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

const getModuleAccessLevelMock = vi.fn();
vi.mock("@/src/lib/require-module-access", () => ({
  getModuleAccessLevel: (...a: unknown[]) => getModuleAccessLevelMock(...a),
}));

const { default: BreakglassAccessPage } = await import("./page.js");

describe("app/(admin)/settings/breakglass-access/page.tsx (Phase 20, FR-ADM-09)", () => {
  it("renders AccessDeniedState when the caller can't read security_settings", async () => {
    getModuleAccessLevelMock.mockResolvedValue("None");
    render(await BreakglassAccessPage());
    expect(await screen.findByText(/don.t have access|access denied/i)).toBeInTheDocument();
  });

  it("renders the settings screen for a Read-level caller", async () => {
    getModuleAccessLevelMock.mockResolvedValue("Read");
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { grants: [] } });
    render(await BreakglassAccessPage());
    expect(await screen.findByText("Break-Glass Access")).toBeInTheDocument();
  });
});
