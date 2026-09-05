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

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { EvalSuitesList } from "./EvalSuitesList.js";

describe("EvalSuitesList (BL-07 Eval Suite Runner, UX_GUIDELINES.md §6.5)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the empty state when no suites exist", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { suites: [] } });
    render(<EvalSuitesList canWrite={true} />);
    expect(await screen.findByText(/no eval suites yet/i)).toBeInTheDocument();
  });

  it("lists existing suites with a working link to their detail page", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { suites: [{ id: "s1", name: "golden-v1", description: "Golden set", passThresholdPct: "100.00" }] } });
    render(<EvalSuitesList canWrite={true} />);
    expect(await screen.findByText("golden-v1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "golden-v1" })).toHaveAttribute("href", "/agent-platform/evals/s1");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("creates a new eval suite via the modal form", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { suites: [] } });
    render(<EvalSuitesList canWrite={true} />);
    await screen.findByText(/no eval suites yet/i);

    fireEvent.click(screen.getByRole("button", { name: /new eval suite/i }));
    fireEvent.change(await screen.findByLabelText("Name", { exact: false }), { target: { value: "billing-suite" } });

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { suite: { id: "s2" } } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { suites: [{ id: "s2", name: "billing-suite", description: null, passThresholdPct: "100.00" }] } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByText("billing-suite")).toBeInTheDocument());
  });

  it("includes cost/latency budget fields in the create form and submits them (QA Defect U6)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { suites: [] } });
    render(<EvalSuitesList canWrite={true} />);
    await screen.findByText(/no eval suites yet/i);

    fireEvent.click(screen.getByRole("button", { name: /new eval suite/i }));
    fireEvent.change(await screen.findByLabelText("Name", { exact: false }), { target: { value: "budgeted-suite" } });
    fireEvent.change(screen.getByLabelText(/cost budget/i), { target: { value: "5.00" } });
    fireEvent.change(screen.getByLabelText(/latency budget/i), { target: { value: "6000" } });

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { suite: { id: "s3" } } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { suites: [] } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/v1/admin/agent-platform/eval-suites",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"costBudgetUsd":"5.00"'),
        }),
      ),
    );
    const [, options] = fetchJsonMock.mock.calls.find(([, opts]) => opts?.method === "POST")!;
    expect((options as { body: string }).body).toContain('"latencyBudgetMs":6000');
  });
});
