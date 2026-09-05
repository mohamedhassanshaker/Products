// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { EvalSuiteDetail } from "./EvalSuiteDetail.js";

describe("EvalSuiteDetail (BL-07 case list + add-case form, UX_GUIDELINES.md §6.5)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the empty-cases prompt when there are none", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { cases: [] } });
    render(<EvalSuiteDetail suiteId="s1" canWrite={true} />);
    expect(await screen.findByText(/no test cases yet/i)).toBeInTheDocument();
  });

  it("renders a 'not yet supported' expected column for a tool-call case, distinct from a genuine pattern case", async () => {
    fetchJsonMock.mockResolvedValue({
      kind: "ok",
      data: {
        cases: [
          { id: "c1", name: "tool-case", inputTranscript: [{ sender: "Customer", text: "book" }], expectedToolCalls: [{ toolName: "book_flight" }], expectedResponsePattern: null },
          { id: "c2", name: "pattern-case", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedToolCalls: null, expectedResponsePattern: ".*" },
        ],
      },
    });
    render(<EvalSuiteDetail suiteId="s1" canWrite={true} />);
    expect(await screen.findByText(/not yet supported/i)).toBeInTheDocument();
    expect(screen.getByText(".*")).toBeInTheDocument();
    // The proactive warning about a suite containing tool-call cases never reaching 100%.
    expect(screen.getByText(/can't reach 100% until then/i)).toBeInTheDocument();
  });

  it("adds a new case via the modal form with an appendable transcript row", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { cases: [] } });
    render(<EvalSuiteDetail suiteId="s1" canWrite={true} />);
    await screen.findByText(/no test cases yet/i);

    fireEvent.click(screen.getByRole("button", { name: /add case/i }));
    fireEvent.change(await screen.findByLabelText("Name", { exact: false }), { target: { value: "case-1" } });
    fireEvent.click(screen.getByRole("button", { name: /add turn/i }));

    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { case: { id: "c1" } } });
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { cases: [{ id: "c1", name: "case-1", inputTranscript: [], expectedToolCalls: null, expectedResponsePattern: null }] } });

    fireEvent.click(screen.getByRole("button", { name: "Add Case" }));
    await waitFor(() => expect(screen.getByText("case-1")).toBeInTheDocument());
  });
});
