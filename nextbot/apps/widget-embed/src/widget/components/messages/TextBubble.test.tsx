// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TextBubble } from "./TextBubble.js";
import type { WidgetMessage } from "../../types.js";

function makeMessage(overrides: Partial<WidgetMessage>): WidgetMessage {
  return {
    id: "m1",
    sequence: 1,
    sender: "AI",
    contentType: "Text",
    payload: { contentType: "Text", text: "Hello" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("TextBubble (A.2.1)", () => {
  afterEach(() => cleanup());

  it("renders a System message with role=status, centered/muted", () => {
    render(<TextBubble message={makeMessage({ sender: "System", payload: { contentType: "Text", text: "Conversation started" } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Conversation started");
  });

  it("renders an AI message's text", () => {
    render(<TextBubble message={makeMessage({ sender: "AI", payload: { contentType: "Text", text: "Hi there" } })} />);
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("renders a customer message with a 'Sent' tick glyph", () => {
    render(<TextBubble message={makeMessage({ sender: "Customer", tick: "sent", payload: { contentType: "Text", text: "hey" } })} />);
    expect(screen.getByLabelText("Sent")).toBeInTheDocument();
  });

  it("renders a 'Failed to send' tick for a failed customer message", () => {
    render(<TextBubble message={makeMessage({ sender: "Customer", tick: "failed", payload: { contentType: "Text", text: "hey" } })} />);
    expect(screen.getByLabelText("Failed to send")).toBeInTheDocument();
  });

  it("renders a 'Queued' tick for an offline-queued customer message", () => {
    render(<TextBubble message={makeMessage({ sender: "Customer", tick: "queued", payload: { contentType: "Text", text: "hey" } })} />);
    expect(screen.getByLabelText(/queued/i)).toBeInTheDocument();
  });

  it("D11: renders a distinct 'Not sent — removed' tick for a dropped (offline-queue-evicted) customer message", () => {
    render(<TextBubble message={makeMessage({ sender: "Customer", tick: "dropped", payload: { contentType: "Text", text: "hey" } })} />);
    expect(screen.getByLabelText(/not sent — removed/i)).toBeInTheDocument();
  });

  it("A.2.11 (Phase 16, BL-09): a HumanAgent message renders a distinct 'Agent' label, unlike an AI message", () => {
    render(<TextBubble message={makeMessage({ sender: "HumanAgent", payload: { contentType: "Text", text: "I can help with that." } })} />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("I can help with that.")).toBeInTheDocument();
  });

  it("A.2.11: an AI message never shows the 'Agent' label", () => {
    render(<TextBubble message={makeMessage({ sender: "AI", payload: { contentType: "Text", text: "Sure, I can help." } })} />);
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });

  /**
   * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-07, §2.2's own explicit
   * in-scope note for the customer widget: "the requirement that it render citations
   * produced by the knowledge subsystem"). Real widget artifact — no lighter mock —
   * per this project's own "one widget artifact" invariant.
   */
  it("renders a grounded AI reply's real structured citations as labelled chips", () => {
    render(
      <TextBubble
        message={makeMessage({
          sender: "AI",
          payload: {
            contentType: "Text",
            text: "Refunds are processed within 14 days.",
            citations: [
              { collectionId: "col1", collectionName: "Refund Policy", documentId: "doc1", documentTitle: "Return Policy", chunkId: "chunk1", snippet: "Refunds within 14 days of purchase." },
              { collectionId: "col1", collectionName: "Refund Policy", documentId: "doc2", documentTitle: "FAQ", chunkId: "chunk2", snippet: "See our FAQ for exceptions." },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText("Refunds are processed within 14 days.")).toBeInTheDocument();
    expect(screen.getByLabelText("2 sources")).toBeInTheDocument();
    expect(screen.getByText(/1\. Return Policy/)).toBeInTheDocument();
    expect(screen.getByText(/2\. FAQ/)).toBeInTheDocument();
  });

  it("renders no citation chips at all when the payload carries none (every ordinary Text message, unaffected)", () => {
    render(<TextBubble message={makeMessage({ sender: "AI", payload: { contentType: "Text", text: "Sure, I can help." } })} />);
    expect(screen.queryByLabelText(/sources?/)).not.toBeInTheDocument();
  });

  it("a KnowledgeNotGrounded refusal (rendered as an Error bubble upstream, not TextBubble) never reaches this component with citations — TextBubble itself renders zero chips for an empty citations array", () => {
    render(<TextBubble message={makeMessage({ sender: "AI", payload: { contentType: "Text", text: "Refunds within 14 days.", citations: [] } })} />);
    expect(screen.queryByLabelText(/sources?/)).not.toBeInTheDocument();
  });
});
