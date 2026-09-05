// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import { PresenceToggle } from "./PresenceToggle.js";

/** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — the self-service
 * presence status toggle. */
describe("PresenceToggle (Phase 13, BL-45)", () => {
  beforeEach(() => fetchJsonMock.mockReset());
  afterEach(() => cleanup());

  it("loads and displays the agent's current presence (auto-provisioned server-side)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { state: "Offline", maxConcurrent: 3, currentLoad: 0 } });
    render(<PresenceToggle />);
    await waitFor(() => expect(screen.getByText("(0/3 active)")).toBeInTheDocument());
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/admin/agent-presence/me");
  });

  it("renders nothing until the initial fetch resolves", () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { state: "Offline", maxConcurrent: 3, currentLoad: 0 } });
    const { container } = render(<PresenceToggle />);
    expect(container).toBeEmptyDOMElement();
  });

  it("changing state PATCHes agent-presence/me and updates the displayed load", async () => {
    fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Promise.resolve({ kind: "ok", data: { state: "Available", maxConcurrent: 3, currentLoad: 1 } });
      return Promise.resolve({ kind: "ok", data: { state: "Offline", maxConcurrent: 3, currentLoad: 0 } });
    });
    render(<PresenceToggle />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Your presence status" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("combobox", { name: "Your presence status" }));
    const option = await screen.findByRole("option", { name: "Available" });
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/v1/admin/agent-presence/me",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ state: "Available" }) }),
      ),
    );
    await waitFor(() => expect(screen.getByText("(1/3 active)")).toBeInTheDocument());
  });
});
