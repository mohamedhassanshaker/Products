// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { GraphExplorer } from "./GraphExplorer.js";

const ENTITY = {
  id: "e1",
  canonicalName: "acme corp",
  type: "Organization",
  aliases: [],
  summary: null,
  degree: 2,
  mentionCount: 3,
  communityId: "com1",
  communityTitle: "Acme-Globex Partnership",
};

const ISOLATED_ENTITY = { ...ENTITY, id: "e2", canonicalName: "isolated entity", degree: 0, communityId: null, communityTitle: null };

const COMMUNITY = { id: "com1", level: 0, title: "Acme-Globex Partnership", summary: "Acme Corp and Globex Corporation have a partnership.", summaryStale: false, entityCount: 2 };

describe("GraphExplorer (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders real entities with their type, community, and relation count", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities?")) return Promise.resolve({ kind: "ok", data: { entities: [ENTITY], nextCursor: null } });
      if (url.includes("/graph/communities")) return Promise.resolve({ kind: "ok", data: { communities: [COMMUNITY] } });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<GraphExplorer collectionId="c1" generationId="gen1" />);
    expect(await screen.findByText("acme corp")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Acme-Globex Partnership")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // degree
  });

  it("FR-KB-04 boundary: an isolated entity (degree 0) still renders, tagged distinctly rather than hidden", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities?")) return Promise.resolve({ kind: "ok", data: { entities: [ISOLATED_ENTITY], nextCursor: null } });
      if (url.includes("/graph/communities")) return Promise.resolve({ kind: "ok", data: { communities: [] } });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<GraphExplorer collectionId="c1" generationId="gen1" />);
    expect(await screen.findByText("isolated entity")).toBeInTheDocument();
    expect(screen.getByText("No relations extracted")).toBeInTheDocument();
  });

  it("shows a Load more button only when the server reports a nextCursor, and fetches the next page on click", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities?") && !url.includes("cursor=")) {
        return Promise.resolve({ kind: "ok", data: { entities: [ENTITY], nextCursor: "opaque-cursor" } });
      }
      if (url.includes("cursor=opaque-cursor")) {
        return Promise.resolve({ kind: "ok", data: { entities: [ISOLATED_ENTITY], nextCursor: null } });
      }
      if (url.includes("/graph/communities")) return Promise.resolve({ kind: "ok", data: { communities: [] } });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<GraphExplorer collectionId="c1" generationId="gen1" />);
    await screen.findByText("acme corp");
    const loadMore = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMore);
    await waitFor(() => expect(screen.getByText("isolated entity")).toBeInTheDocument());
    // Both pages' rows remain visible — Load more appends, it doesn't replace.
    expect(screen.getByText("acme corp")).toBeInTheDocument();
  });

  it("re-queries with the search term when the filter form is submitted", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities?")) return Promise.resolve({ kind: "ok", data: { entities: [], nextCursor: null } });
      if (url.includes("/graph/communities")) return Promise.resolve({ kind: "ok", data: { communities: [] } });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<GraphExplorer collectionId="c1" generationId="gen1" />);
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalled());
    fetchJsonMock.mockClear();
    fireEvent.change(screen.getByLabelText(/search by name/i), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("q=acme")));
  });

  it("renders a community's own generated summary in the Communities tab", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities?")) return Promise.resolve({ kind: "ok", data: { entities: [], nextCursor: null } });
      if (url.includes("/graph/communities")) return Promise.resolve({ kind: "ok", data: { communities: [COMMUNITY] } });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<GraphExplorer collectionId="c1" generationId="gen1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Communities" }));
    expect(await screen.findByText("Acme Corp and Globex Corporation have a partnership.")).toBeInTheDocument();
  });

  it("tags a community whose summary hasn't caught up with a recent membership change as 'Summary stale' (FR-KB-02: regenerated incrementally)", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities?")) return Promise.resolve({ kind: "ok", data: { entities: [], nextCursor: null } });
      if (url.includes("/graph/communities")) return Promise.resolve({ kind: "ok", data: { communities: [{ ...COMMUNITY, summaryStale: true }] } });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<GraphExplorer collectionId="c1" generationId="gen1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Communities" }));
    expect(await screen.findByText("Summary stale")).toBeInTheDocument();
  });

  it("surfaces a fetch error instead of silently rendering an empty list", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "error", status: 500, message: "Something went wrong. Please try again." });
    render(<GraphExplorer collectionId="c1" generationId="gen1" />);
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });
});
