// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { CommunityDetail } from "./CommunityDetail.js";

describe("CommunityDetail (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the community's own generated summary and every member entity", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      kind: "ok",
      data: {
        community: { id: "com1", level: 0, title: "Acme-Globex Partnership", summary: "Acme Corp and Globex Corporation have a partnership.", summaryStale: false, entityCount: 2 },
        members: [
          { id: "e1", canonicalName: "acme corp", type: "Organization", degree: 1, mentionCount: 2 },
          { id: "e2", canonicalName: "globex corporation", type: "Organization", degree: 1, mentionCount: 1 },
        ],
      },
    });
    render(<CommunityDetail collectionId="c1" generationId="gen1" communityId="com1" />);
    expect(await screen.findByRole("heading", { name: "Acme-Globex Partnership" })).toBeInTheDocument();
    expect(screen.getByText("Acme Corp and Globex Corporation have a partnership.")).toBeInTheDocument();
    expect(screen.getByText("acme corp")).toBeInTheDocument();
    expect(screen.getByText("globex corporation")).toBeInTheDocument();
  });

  it("shows a 'summary stale' badge when the community's own summary is marked stale (regenerated incrementally)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      kind: "ok",
      data: { community: { id: "com1", level: 0, title: "A community", summary: "old summary", summaryStale: true, entityCount: 1 }, members: [] },
    });
    render(<CommunityDetail collectionId="c1" generationId="gen1" communityId="com1" />);
    expect(await screen.findByText(/summary stale/i)).toBeInTheDocument();
  });

  it("boundary: a community with zero member entities renders a distinct message rather than an empty table", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      kind: "ok",
      data: { community: { id: "com1", level: 0, title: null, summary: null, summaryStale: false, entityCount: 0 }, members: [] },
    });
    render(<CommunityDetail collectionId="c1" generationId="gen1" communityId="com1" />);
    expect(await screen.findByText(/no member entities/i)).toBeInTheDocument();
    // Untitled community and un-summarized community both degrade to a labelled placeholder, never a blank.
    expect(screen.getByRole("heading", { name: "(untitled community)" })).toBeInTheDocument();
    expect(screen.getByText(/no summary generated for this community yet/i)).toBeInTheDocument();
  });

  it("FR-KB-04 boundary: a member entity with degree 0 is tagged 'No relations extracted' rather than hidden", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      kind: "ok",
      data: {
        community: { id: "com1", level: 0, title: "A community", summary: "s", summaryStale: false, entityCount: 1 },
        members: [{ id: "e1", canonicalName: "isolated entity", type: "Organization", degree: 0, mentionCount: 1 }],
      },
    });
    render(<CommunityDetail collectionId="c1" generationId="gen1" communityId="com1" />);
    expect(await screen.findByText("No relations extracted")).toBeInTheDocument();
  });

  it("surfaces a fetch error instead of silently rendering nothing", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "error", status: 404, message: "Community 'com1' was not found." });
    render(<CommunityDetail collectionId="c1" generationId="gen1" communityId="com1" />);
    expect(await screen.findByText("Community 'com1' was not found.")).toBeInTheDocument();
  });
});
