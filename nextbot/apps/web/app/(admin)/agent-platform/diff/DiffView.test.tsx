// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { DiffView } from "./DiffView.js";

describe("DiffView (BL-07 version diff, UX_GUIDELINES.md §6.2 — accessible diff)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders a textual summary line and per-line added/removed accessible prefixes", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { files: [{ path: "agents/d1/1.0.0.yaml", patch: "+added line\n-removed line\n context line", additions: 1, deletions: 1 }] },
    });
    render(<DiffView versionAId="a" versionBId="b" />);
    expect(await screen.findByText(/1 file changed, 1 addition, 1 deletion/i)).toBeInTheDocument();
    expect(screen.getByText("Added:")).toBeInTheDocument();
    expect(screen.getByText("Removed:")).toBeInTheDocument();
  });

  it("renders the empty-diff message for two identical versions", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { files: [] } });
    render(<DiffView versionAId="a" versionBId="b" />);
    expect(await screen.findByText(/no differences between these two versions/i)).toBeInTheDocument();
  });

  it("shows the GIT_CONNECTION_UNAVAILABLE alert verbatim with a Retry action", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 409, message: "Git connection unavailable — reconnect in Settings." });
    render(<DiffView versionAId="a" versionBId="b" />);
    expect(await screen.findByText("Git connection unavailable — reconnect in Settings.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
