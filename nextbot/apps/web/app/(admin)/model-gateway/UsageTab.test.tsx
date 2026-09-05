// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { UsageTab } from "./UsageTab.js";

describe("UsageTab (Target Architecture Blueprint Phase 2, BL-33, FR-AGT-24)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders spend/volume rows grouped by provider and the cost-per-resolved-conversation figure", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/usage/cost-per-resolved-conversation")) {
        return Promise.resolve({ kind: "ok", data: { totalCostUsd: 12.5, conversationCount: 5, costPerConversation: 2.5 } });
      }
      if (url.includes("/model-gateway/usage")) {
        return Promise.resolve({
          kind: "ok",
          data: { rows: [{ groupKey: "openai-compatible", tokensIn: 100, tokensOut: 50, cachedTokens: 0, costUsd: 1.23, callCount: 4, cacheHitCount: 1, errorCount: 0 }] },
        });
      }
      return Promise.resolve({ kind: "ok", data: {} });
    });

    render(<UsageTab />);

    expect(await screen.findByText("openai-compatible")).toBeInTheDocument();
    expect(await screen.findByText("$2.5000")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
  });

  it("shows an empty-state message when no usage has been recorded yet", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/usage/cost-per-resolved-conversation")) return Promise.resolve({ kind: "ok", data: { totalCostUsd: 0, conversationCount: 0, costPerConversation: null } });
      if (url.includes("/model-gateway/usage")) return Promise.resolve({ kind: "ok", data: { rows: [] } });
      return Promise.resolve({ kind: "ok", data: {} });
    });

    render(<UsageTab />);
    expect(await screen.findByText(/no usage recorded/i)).toBeInTheDocument();
  });
});
