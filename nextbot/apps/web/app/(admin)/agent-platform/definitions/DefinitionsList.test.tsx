// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { DefinitionsList } from "./DefinitionsList.js";

describe("DefinitionsList (BL-07 Agent Definition Registry, UX_GUIDELINES.md §6.1)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    pushMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the full-page access-denied state on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<DefinitionsList canWrite={false} />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("renders the empty state with a CTA for a Write caller", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { definitions: [] } });
    render(<DefinitionsList canWrite={true} />);
    expect(await screen.findByText(/no agent definitions yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /new agent definition/i }).length).toBeGreaterThan(0);
  });

  it("does not show the CTA for a Read-only caller on the empty state", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { definitions: [] } });
    render(<DefinitionsList canWrite={false} />);
    await screen.findByText(/no agent definitions yet/i);
    expect(screen.queryByRole("button", { name: /new agent definition/i })).not.toBeInTheDocument();
  });

  it("renders a real definition row linking to its detail page, with version-count/production-version columns", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: {
        definitions: [
          { id: "d1", name: "support-triage", description: "Handles support", updatedAt: new Date().toISOString(), versionCount: 3, productionVersion: "1.2.0" },
        ],
      },
    });
    render(<DefinitionsList canWrite={true} />);
    expect(await screen.findByText("support-triage")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "support-triage" })).toHaveAttribute("href", "/agent-platform/definitions/d1");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1.2.0")).toBeInTheDocument();
  });

  it("opens the create-definition modal, submits a new definition, and navigates directly to its Definition Detail (QA Defect U4)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { definitions: [] } });
    render(<DefinitionsList canWrite={true} />);
    await screen.findByText(/no agent definitions yet/i);

    const [newDefinitionButton] = screen.getAllByRole("button", { name: /new agent definition/i });
    fireEvent.click(newDefinitionButton!);
    const nameInput = await screen.findByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: "billing-helper" } });

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { definition: { id: "d2" } } });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/agent-platform/definitions/d2"));
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/admin/agent-platform/definitions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error alert with a Retry action on a load failure", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 500, message: "Something went wrong." });
    render(<DefinitionsList canWrite={true} />);
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
