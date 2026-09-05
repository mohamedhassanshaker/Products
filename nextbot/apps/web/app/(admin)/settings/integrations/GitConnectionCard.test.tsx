// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { GitConnectionCard } from "./GitConnectionCard.js";

describe("GitConnectionCard (BL-07 Git-connect flow, UX_GUIDELINES.md §6.3)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    sessionStorage.clear();
    // jsdom doesn't implement navigation; stub it so clicking "Connect GitHub"
    // doesn't throw when the component sets window.location.href.
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { href: string } }).location = { href: "" };
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the not-connected default with Connect buttons when no connection exists", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connection: null } });
    render(<GitConnectionCard canWrite={true} />);
    expect(await screen.findByRole("button", { name: /connect github/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect gitlab/i })).toBeInTheDocument();
  });

  it("shows the read-only message for a caller without Write access when not connected", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connection: null } });
    render(<GitConnectionCard canWrite={false} />);
    expect(await screen.findByText(/an admin with write access must connect/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect github/i })).not.toBeInTheDocument();
  });

  it("shows the Connected status badge + repo details when a connection exists", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connection: { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", status: "Connected" } } });
    render(<GitConnectionCard canWrite={true} />);
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("GitHub: acme/agent-defs")).toBeInTheDocument();
  });

  it("shows the Unreachable warning banner distinctly", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connection: { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", status: "Unreachable" } } });
    render(<GitConnectionCard canWrite={true} />);
    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
    expect(screen.getByText(/this connection is unreachable/i)).toBeInTheDocument();
  });

  it("initiates the GitHub connect flow via a real redirect (not a popup)", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/git/connect/GitHub")) return Promise.resolve({ kind: "ok", data: { redirectUrl: "https://github.com/login/oauth/authorize?x=1" } });
      return Promise.resolve({ kind: "ok", data: { connection: null } });
    });
    render(<GitConnectionCard canWrite={true} />);
    fireEvent.click(await screen.findByRole("button", { name: /connect github/i }));
    await waitFor(() => expect(window.location.href).toBe("https://github.com/login/oauth/authorize?x=1"));
  });

  it("shows a confirm dialog stating the concrete consequence before disconnecting", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { connection: { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", status: "Connected" } } });
    render(<GitConnectionCard canWrite={true} />);
    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    expect(await screen.findByText(/existing deployed agent versions keep running normally/i)).toBeInTheDocument();
  });
});
