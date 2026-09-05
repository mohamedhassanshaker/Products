// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsValue,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import GitCallbackPage from "./page.js";

describe("Git-connect callback page (UX_GUIDELINES.md §6.3 steps 4-6)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    pushMock.mockReset();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the neutral cancelled message when the OAuth prompt was denied", async () => {
    searchParamsValue = new URLSearchParams({ error: "access_denied" });
    render(<GitCallbackPage />);
    expect(await screen.findByText(/connection cancelled/i)).toBeInTheDocument();
  });

  it("exchanges the code and shows a searchable repo picker with the residency disclosure gated on selection", async () => {
    searchParamsValue = new URLSearchParams({ provider: "GitHub", code: "abc123" });
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { accessToken: "tok", repos: [{ owner: "acme", name: "agent-defs" }, { owner: "acme", name: "other-repo" }] },
    });
    render(<GitCallbackPage />);
    expect(await screen.findByRole("option", { name: "acme/agent-defs" })).toBeInTheDocument();
    // Residency disclosure and Connect button are not shown until a repo is picked.
    expect(screen.queryByText(/regional data-residency guarantee/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "acme/agent-defs" }));
    expect(await screen.findByText(/regional data-residency guarantee/i)).toBeInTheDocument();
  });

  it("filters the repo list via the search input", async () => {
    searchParamsValue = new URLSearchParams({ provider: "GitHub", code: "abc123" });
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: { accessToken: "tok", repos: [{ owner: "acme", name: "agent-defs" }, { owner: "acme", name: "other-repo" }] },
    });
    render(<GitCallbackPage />);
    await screen.findByRole("option", { name: "acme/agent-defs" });
    fireEvent.change(screen.getByRole("textbox", { name: /search repositories/i }), { target: { value: "other" } });
    expect(screen.queryByRole("option", { name: "acme/agent-defs" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "acme/other-repo" })).toBeInTheDocument();
  });

  it("completes the connection and navigates to Integrations on Connect", async () => {
    searchParamsValue = new URLSearchParams({ provider: "GitHub", code: "abc123" });
    fetchJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve({ kind: "ok", data: {} });
      return Promise.resolve({ kind: "ok", data: { accessToken: "tok", repos: [{ owner: "acme", name: "agent-defs" }] } });
    });
    render(<GitCallbackPage />);
    fireEvent.click(await screen.findByRole("option", { name: "acme/agent-defs" }));
    fireEvent.click(await screen.findByRole("button", { name: /^connect$/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/settings/integrations"));
  });

  it("shows an error state with the verbatim message when the exchange fails", async () => {
    searchParamsValue = new URLSearchParams({ provider: "GitHub", code: "abc123" });
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 502, message: "GitHub OAuth token exchange failed: invalid_grant" });
    render(<GitCallbackPage />);
    expect(await screen.findByText("GitHub OAuth token exchange failed: invalid_grant")).toBeInTheDocument();
  });
});
