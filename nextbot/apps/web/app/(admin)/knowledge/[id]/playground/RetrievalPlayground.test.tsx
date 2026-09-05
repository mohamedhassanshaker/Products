// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { RetrievalPlayground } from "./RetrievalPlayground.js";

const PLAYGROUND_RESPONSE = {
  query: "does acme corp partner with globex corporation?",
  generationId: "gen1",
  results: [
    {
      strategy: "Vector",
      items: [{ kind: "Chunk", score: 0.82, chunkId: "c1", documentTitle: "Acme Corp", sourceName: "acme-globex.md", snippet: "Acme Corp signed a partnership agreement with Globex Corporation in 2024." }],
      metrics: { groundednessScore: 0.82, latencyMs: 120, costUsd: "0.00000050" },
    },
    {
      strategy: "GraphLocal",
      items: [
        {
          kind: "Chunk",
          score: 0.9,
          chunkId: "c1",
          documentTitle: "Acme Corp",
          sourceName: "acme-globex.md",
          snippet: "Acme Corp signed a partnership agreement with Globex Corporation in 2024.",
          relationPath: [{ srcName: "acme corp", relation: "PARTNERED_WITH", dstName: "globex corporation", provenanceChunkId: "c1" }],
        },
      ],
      metrics: { groundednessScore: 0.9, latencyMs: 45, costUsd: "0.00000000" },
    },
    {
      strategy: "GraphGlobal",
      items: [{ kind: "CommunitySummary", score: 0.77, communityTitle: "Acme-Globex Partnership", summary: "Acme Corp and Globex Corporation have a partnership." }],
      metrics: { groundednessScore: 0.77, latencyMs: 310, costUsd: "0.00001200" },
      synthesizedAnswer: "Acme Corp and Globex Corporation have a partnership agreement.",
    },
    {
      strategy: "Hybrid",
      items: [],
      metrics: { groundednessScore: null, latencyMs: 60, costUsd: "0.00000050" },
      note: "Vector recall returned nothing to expand.",
    },
  ],
};

describe("RetrievalPlayground (Target Architecture Blueprint Phase 9, BL-40, FR-KB-05)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("runs all four strategies by default and renders each one's own groundedness/latency/cost plus evidence", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: PLAYGROUND_RESPONSE });
    render(<RetrievalPlayground collectionId="c1" />);

    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "Does Acme Corp partner with Globex Corporation?" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalled());
    const [url, init] = fetchJsonMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/knowledge/playground");
    const body = JSON.parse(init.body as string);
    expect(body.collectionId).toBe("c1");
    expect(body.strategies).toEqual(["Vector", "GraphLocal", "GraphGlobal", "Hybrid"]);

    // Each strategy card renders its own metrics — the Figure 5 comparison view.
    // Result cards carry a `data-testid` (the strategy checkbox labels ALSO render
    // the bare strategy name text, so scoping to each card avoids that ambiguity).
    const vectorCard = within(await screen.findByTestId("playground-result-Vector"));
    const graphLocalCard = within(screen.getByTestId("playground-result-GraphLocal"));
    const graphGlobalCard = within(screen.getByTestId("playground-result-GraphGlobal"));
    const hybridCard = within(screen.getByTestId("playground-result-Hybrid"));

    expect(vectorCard.getByText("120 ms")).toBeInTheDocument();
    // GraphLocal's groundedness metric — scoped to the metrics line specifically,
    // since its top evidence item's own per-item score badge renders the identical
    // "90%" text elsewhere in the same card (both are genuinely 0.9 in this fixture).
    expect(graphLocalCard.getByText("Groundedness:").closest("span")).toHaveTextContent("Groundedness: 90%");

    // GraphLocal's relation path — the distinguishing evidence Vector never has.
    expect(graphLocalCard.getByText(/acme corp.*PARTNERED_WITH.*globex corporation/)).toBeInTheDocument();
    expect(vectorCard.queryByText(/PARTNERED_WITH/)).not.toBeInTheDocument();

    // GraphGlobal's synthesized answer.
    expect(graphGlobalCard.getByText("Acme Corp and Globex Corporation have a partnership agreement.")).toBeInTheDocument();

    // Hybrid's note, surfaced rather than hidden.
    expect(hybridCard.getByText("Vector recall returned nothing to expand.")).toBeInTheDocument();
  });

  it("lets a human deselect strategies to run only a subset", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { ...PLAYGROUND_RESPONSE, results: [PLAYGROUND_RESPONSE.results[0]] } });
    render(<RetrievalPlayground collectionId="c1" />);

    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "test query" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Graph — local" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Graph — global" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hybrid" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalled());
    const [, init] = fetchJsonMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.strategies).toEqual(["Vector"]);
  });

  it("shows an inline error instead of running when the query is empty", async () => {
    render(<RetrievalPlayground collectionId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Enter a query first.")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("surfaces a server error without crashing", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 409, message: "Knowledge generation 'g1' is not Ready." });
    render(<RetrievalPlayground collectionId="c1" />);
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "test query" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Knowledge generation 'g1' is not Ready.")).toBeInTheDocument();
  });
});
