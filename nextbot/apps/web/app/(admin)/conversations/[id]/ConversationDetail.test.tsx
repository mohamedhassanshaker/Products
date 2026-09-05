// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ConversationDetail } from "./ConversationDetail.js";

const SAMPLE_CONVERSATION = {
  id: "conv-1",
  channelId: "chan-1",
  status: "Resolved",
  recognizedGoal: "order_status",
  resolutionType: "AI",
  language: "en",
  startedAt: "2026-08-15T10:00:00.000Z",
  endedAt: "2026-08-15T10:05:00.000Z",
  lastActivityAt: "2026-08-15T10:05:00.000Z",
  totalCostUsd: "0.0042",
  totalTokensIn: 100,
  totalTokensOut: 50,
  externalThreadId: null,
  customerIdentifier: null,
  metadata: null,
  messages: [
    { id: "m1", sequence: 1, sender: "Customer", contentType: "Text", payload: { contentType: "Text", text: "where is my order" }, confidenceScore: null, agentRunId: null, createdAt: "2026-08-15T10:00:01.000Z" },
    { id: "m2", sequence: 2, sender: "AI", contentType: "Text", payload: { contentType: "Text", text: "Your order shipped." }, confidenceScore: 0.9, agentRunId: "run-1", createdAt: "2026-08-15T10:00:05.000Z" },
  ],
};

const SAMPLE_TRACE = {
  runs: [
    {
      run: { id: "run-1", status: "Succeeded", otelTraceId: "abc123def456abc123def456abc12345", tokensIn: 10, tokensOut: 5, costUsd: "0.001", durationMs: 500 },
      spans: [
        { spanId: "s1", parentSpanId: null, name: "goal_selection", kind: "ModelCall", attributes: { action: "call_tool" }, status: "Ok", startedAt: "2026-08-15T10:00:02.000Z", durationMs: 100 },
        { spanId: "s2", parentSpanId: "s1", name: "tool_call:get_order", kind: "ToolCall", attributes: { toolName: "get_order" }, status: "Ok", startedAt: "2026-08-15T10:00:03.000Z", durationMs: 200 },
      ],
    },
  ],
  traceStoreUnavailable: false,
};

describe("ConversationDetail (Phase 13, BL-06, screen inventory B.4.2)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the full-page access-denied state on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<ConversationDetail conversationId="conv-1" permissionLevel="None" />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("renders a not-found state for a 404", async () => {
    fetchJsonMock.mockImplementation((url: string) =>
      url.includes("/trace") ? Promise.resolve({ kind: "ok", data: { runs: [], traceStoreUnavailable: false } }) : Promise.resolve({ kind: "error", status: 404, message: "not found" }),
    );
    render(<ConversationDetail conversationId="missing" permissionLevel="Read" />);
    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
  });

  it("renders the transcript and reveals the reasoning trace (ModelCall + ToolCall spans) on toggle", async () => {
    fetchJsonMock.mockImplementation((url: string) =>
      url.includes("/trace") ? Promise.resolve({ kind: "ok", data: SAMPLE_TRACE }) : Promise.resolve({ kind: "ok", data: { conversation: SAMPLE_CONVERSATION } }),
    );
    render(<ConversationDetail conversationId="conv-1" permissionLevel="Read" />);

    await screen.findByText("where is my order");
    expect(screen.getAllByText("Your order shipped.").length).toBeGreaterThan(0);

    const toggle = screen.getByRole("button", { name: /show reasoning trace/i });
    fireEvent.click(toggle);
    expect(await screen.findByText("goal_selection")).toBeInTheDocument();
    // U5 fix (QA fix pass): the reasoning block now renders the parsed
    // goal-recognized/tool-selected fields, not a raw span-name/JSON dump — and the
    // inline transcript tool-call card renders the backend/connector name as a badge
    // ("get_order", from the span's `toolName` attribute) rather than the raw
    // `tool_call:get_order` span name.
    expect(screen.getByText("call_tool")).toBeInTheDocument();
    expect(screen.getAllByText("get_order").length).toBeGreaterThan(0);
  });

  it("shows the tool-call timeline derived from ToolCall spans, with the backend name and jump-to-message control", async () => {
    fetchJsonMock.mockImplementation((url: string) =>
      url.includes("/trace") ? Promise.resolve({ kind: "ok", data: SAMPLE_TRACE }) : Promise.resolve({ kind: "ok", data: { conversation: SAMPLE_CONVERSATION } }),
    );
    render(<ConversationDetail conversationId="conv-1" permissionLevel="Read" />);
    await screen.findByText("Tool-call timeline");
    expect(await screen.findAllByText("get_order")).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /jump to message/i }).length).toBeGreaterThan(0);
  });

  it("renders the masked customer identifier in the context panel (U1 fix)", async () => {
    fetchJsonMock.mockImplementation((url: string) =>
      url.includes("/trace")
        ? Promise.resolve({ kind: "ok", data: SAMPLE_TRACE })
        : Promise.resolve({ kind: "ok", data: { conversation: { ...SAMPLE_CONVERSATION, customerIdentifier: "customer-98765" } } }),
    );
    render(<ConversationDetail conversationId="conv-1" permissionLevel="Read" />);
    expect(await screen.findByText("••••8765")).toBeInTheDocument();
  });

  it("renders a per-message confidence gauge and conversation-level trend sparkline (U3 fix)", async () => {
    fetchJsonMock.mockImplementation((url: string) =>
      url.includes("/trace") ? Promise.resolve({ kind: "ok", data: SAMPLE_TRACE }) : Promise.resolve({ kind: "ok", data: { conversation: SAMPLE_CONVERSATION } }),
    );
    render(<ConversationDetail conversationId="conv-1" permissionLevel="Read" />);
    await screen.findAllByText("Your order shipped.");
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("Confidence trend")).toBeInTheDocument();
    expect(screen.getByText("90% latest")).toBeInTheDocument();
  });

  it("shows a distinct warning when the trace store is unavailable (not conflated with 'no trace')", async () => {
    fetchJsonMock.mockImplementation((url: string) =>
      url.includes("/trace")
        ? Promise.resolve({ kind: "ok", data: { runs: [], traceStoreUnavailable: true } })
        : Promise.resolve({ kind: "ok", data: { conversation: SAMPLE_CONVERSATION } }),
    );
    render(<ConversationDetail conversationId="conv-1" permissionLevel="Read" />);
    expect(await screen.findByText(/trace store is temporarily unavailable/i)).toBeInTheDocument();
  });

  /**
   * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-07, Blueprint §7.5's closing
   * note) — citations render in Conversations, straight off the message's own
   * persisted payload, plus a "Retrieval" span's own strategy/outcome/citations card.
   */
  describe("Phase 10 (BL-41) — bounded retrieval agent citations", () => {
    const CONVERSATION_WITH_CITATIONS = {
      ...SAMPLE_CONVERSATION,
      messages: [
        SAMPLE_CONVERSATION.messages[0],
        {
          id: "m2",
          sequence: 2,
          sender: "AI",
          contentType: "Text",
          payload: {
            contentType: "Text",
            text: "Refunds are processed within 14 days.",
            citations: [{ collectionId: "col1", collectionName: "Refund Policy", documentId: "doc1", documentTitle: "Return Policy", chunkId: "chunk1", snippet: "Refunds within 14 days of purchase." }],
          },
          confidenceScore: null,
          agentRunId: "run-2",
          createdAt: "2026-08-15T10:00:05.000Z",
        },
      ],
    };

    const TRACE_WITH_RETRIEVAL_SPAN = {
      runs: [
        {
          run: { id: "run-2", status: "Succeeded", otelTraceId: "abc123def456abc123def456abc12345", tokensIn: 0, tokensOut: 0, costUsd: "0.00001", durationMs: 40 },
          spans: [
            {
              spanId: "rs1",
              parentSpanId: null,
              name: "retrieval:Vector",
              kind: "Retrieval",
              attributes: {
                outcome: "Grounded",
                strategy: "Vector",
                hops: "2",
                expansions: "0",
                citationCount: "1",
                costUsd: "0.00001",
                retrievalEventId: "evt-1",
                citations: JSON.stringify([{ collectionId: "col1", collectionName: "Refund Policy", documentId: "doc1", documentTitle: "Return Policy", chunkId: "chunk1", snippet: "Refunds within 14 days of purchase." }]),
              },
              status: "Ok",
              startedAt: "2026-08-15T10:00:04.000Z",
              durationMs: 40,
            },
          ],
        },
      ],
      traceStoreUnavailable: false,
    };

    it("renders a grounded reply's real structured citations directly under the transcript message", async () => {
      fetchJsonMock.mockImplementation((url: string) =>
        url.includes("/trace") ? Promise.resolve({ kind: "ok", data: TRACE_WITH_RETRIEVAL_SPAN }) : Promise.resolve({ kind: "ok", data: { conversation: CONVERSATION_WITH_CITATIONS } }),
      );
      render(<ConversationDetail conversationId="conv-1" permissionLevel="Read" />);
      await screen.findByText("Refunds are processed within 14 days.");
      expect(screen.getByText(/Sources \(1\)/)).toBeInTheDocument();
      expect(screen.getByText("Return Policy")).toBeInTheDocument();
      expect(screen.getByText("Refund Policy")).toBeInTheDocument();
    });

    it("renders the Retrieval span's own strategy/outcome badge and expandable citation detail", async () => {
      fetchJsonMock.mockImplementation((url: string) =>
        url.includes("/trace") ? Promise.resolve({ kind: "ok", data: TRACE_WITH_RETRIEVAL_SPAN }) : Promise.resolve({ kind: "ok", data: { conversation: CONVERSATION_WITH_CITATIONS } }),
      );
      render(<ConversationDetail conversationId="conv-1" permissionLevel="Read" />);
      await screen.findByText("Refunds are processed within 14 days.");
      expect(screen.getByText("Vector")).toBeInTheDocument();
      expect(screen.getByText("Grounded")).toBeInTheDocument();

      const toggle = screen.getByRole("button", { name: /show retrieval detail/i });
      fireEvent.click(toggle);
      expect(await screen.findByText("$0.000010")).toBeInTheDocument();
    });

    it("a Refused turn's Retrieval span still renders (with a destructive badge) even though the transcript message itself carries no citations", async () => {
      const refusedConversation = {
        ...SAMPLE_CONVERSATION,
        messages: [
          SAMPLE_CONVERSATION.messages[0],
          { id: "m2", sequence: 2, sender: "AI", contentType: "Error", payload: { contentType: "Error", reason: "KnowledgeNotGrounded", text: "I don't have a sourced answer for that — let me get a colleague to help." }, confidenceScore: null, agentRunId: "run-2", createdAt: "2026-08-15T10:00:05.000Z" },
        ],
      };
      const refusedTrace = {
        runs: [
          {
            run: { id: "run-2", status: "Succeeded", otelTraceId: "abc123def456abc123def456abc12345", tokensIn: 0, tokensOut: 0, costUsd: "0", durationMs: 40 },
            spans: [
              { spanId: "rs1", parentSpanId: null, name: "retrieval:Vector", kind: "Retrieval", attributes: { outcome: "Refused", strategy: "Vector", hops: "2", expansions: "0", citationCount: "0", costUsd: "0", retrievalEventId: "evt-2", citations: "[]" }, status: "Error", startedAt: "2026-08-15T10:00:04.000Z", durationMs: 40 },
            ],
          },
        ],
        traceStoreUnavailable: false,
      };
      fetchJsonMock.mockImplementation((url: string) => (url.includes("/trace") ? Promise.resolve({ kind: "ok", data: refusedTrace }) : Promise.resolve({ kind: "ok", data: { conversation: refusedConversation } })));
      render(<ConversationDetail conversationId="conv-1" permissionLevel="Read" />);
      await screen.findByText(/I don't have a sourced answer/);
      expect(screen.getByText("Refused")).toBeInTheDocument();
      expect(screen.queryByText(/Sources \(/)).not.toBeInTheDocument(); // no citations on this refused turn.
    });
  });
});
