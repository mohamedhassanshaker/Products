// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { EntityDetail } from "./EntityDetail.js";

const ENTITY_DETAIL = {
  entity: {
    id: "e1",
    canonicalName: "acme corp",
    type: "Organization",
    aliases: ["Acme", "ACME Corp."],
    summary: "A fictional company used in test documents.",
    degree: 1,
    mentionCount: 2,
    communityId: "com1",
    communityTitle: "Acme-Globex Partnership",
  },
  relations: [
    {
      edgeId: "edge1",
      direction: "outgoing" as const,
      relation: "PARTNERED_WITH",
      weight: 1,
      confidence: 0.9,
      otherEntity: { id: "e2", canonicalName: "globex corporation", type: "Organization" },
      provenance: { chunkId: "chunk1", documentTitle: "Acme doc", blockIndex: 0, span: null },
    },
  ],
};

describe("EntityDetail (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the entity's canonical name, type, aliases, summary, and community", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: ENTITY_DETAIL });
    render(<EntityDetail collectionId="c1" generationId="gen1" entityId="e1" />);
    expect(await screen.findByRole("heading", { name: "acme corp" })).toBeInTheDocument();
    expect(screen.getAllByText("Organization").length).toBeGreaterThan(0); // the entity's own type badge, plus the related entity's type badge in the relations table
    expect(screen.getByText(/Acme, ACME Corp\./)).toBeInTheDocument();
    expect(screen.getByText("A fictional company used in test documents.")).toBeInTheDocument();
    expect(screen.getByText("Acme-Globex Partnership")).toBeInTheDocument();
  });

  it("FR-KB-04 CRITICAL PATH: 'View source' opens a dialog showing the ACTUAL chunk text, not merely a chunk id", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities/e1")) return Promise.resolve({ kind: "ok", data: ENTITY_DETAIL });
      if (url.includes("/chunks/chunk1")) {
        return Promise.resolve({
          kind: "ok",
          data: { chunk: { id: "chunk1", text: "Acme Corp signed a partnership agreement with Globex Corporation in 2024.", tokenCount: 12, documentTitle: "Acme doc", sourceName: "Acme/Globex test document", provenance: { documentTitle: "Acme doc" } } },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<EntityDetail collectionId="c1" generationId="gen1" entityId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: /view source/i }));
    expect(await screen.findByText(/Acme Corp signed a partnership agreement with Globex Corporation in 2024\./)).toBeInTheDocument();
    expect(screen.getByText(/Acme\/Globex test document/)).toBeInTheDocument();
  });

  it("renders an incoming relation's arrow direction, an untitled community, and a chunk's full page/section metadata", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities/e1")) {
        return Promise.resolve({
          kind: "ok",
          data: {
            entity: { ...ENTITY_DETAIL.entity, communityTitle: null },
            relations: [
              {
                edgeId: "edge-in",
                direction: "incoming",
                relation: "MENTIONS",
                weight: 1,
                confidence: 0.5,
                otherEntity: { id: "e3", canonicalName: "springfield", type: "Location" },
                provenance: { chunkId: "chunk2", documentTitle: null, blockIndex: 0, span: null },
              },
            ],
          },
        });
      }
      if (url.includes("/chunks/chunk2")) {
        return Promise.resolve({
          kind: "ok",
          data: { chunk: { id: "chunk2", text: "Acme Corp is headquartered in Springfield.", tokenCount: 6, documentTitle: null, sourceName: "Acme/Globex test document", provenance: { documentTitle: null, page: 2, section: "Overview" } } },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<EntityDetail collectionId="c1" generationId="gen1" entityId="e1" />);
    expect(await screen.findByText("(untitled)")).toBeInTheDocument();
    expect(screen.getByText("MENTIONS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view source/i }));
    await screen.findByText(/Acme Corp is headquartered in Springfield\./);
    expect(screen.getByText(/Untitled document/)).toBeInTheDocument();
    expect(screen.getByText(/page 2/)).toBeInTheDocument();
    expect(screen.getByText(/Overview/)).toBeInTheDocument();
  });

  it("boundary: an entity with no relations renders a distinct message rather than an empty table", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "ok", data: { entity: { ...ENTITY_DETAIL.entity, communityId: null, communityTitle: null }, relations: [] } });
    render(<EntityDetail collectionId="c1" generationId="gen1" entityId="e1" />);
    expect(await screen.findByText(/no relations extracted for this entity/i)).toBeInTheDocument();
  });

  it("surfaces the entity-detail fetch error at the top level rather than an empty/silent state", async () => {
    fetchJsonMock.mockResolvedValueOnce({ kind: "error", status: 404, message: "Entity 'e1' was not found." });
    render(<EntityDetail collectionId="c1" generationId="gen1" entityId="e1" />);
    expect(await screen.findByText("Entity 'e1' was not found.")).toBeInTheDocument();
  });

  it("surfaces the chunk fetch error inside the dialog rather than an empty/silent state", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/graph/entities/e1")) return Promise.resolve({ kind: "ok", data: ENTITY_DETAIL });
      if (url.includes("/chunks/chunk1")) return Promise.resolve({ kind: "error", status: 404, message: "Chunk 'chunk1' was not found." });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<EntityDetail collectionId="c1" generationId="gen1" entityId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: /view source/i }));
    await waitFor(() => expect(screen.getByText("Chunk 'chunk1' was not found.")).toBeInTheDocument());
  });
});
