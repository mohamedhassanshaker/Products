import { describe, expect, it } from "vitest";
import { selectRenderedCard } from "./render-selection.js";

describe("selectRenderedCard (LLD §7.5, FR-MCP-07 — no per-connector UI code)", () => {
  it("selects DataTable for a columns+rows shape", () => {
    const card = selectRenderedCard("list_orders", { columns: ["Order", "Status"], rows: [["#1", "Shipped"]] });
    expect(card).toEqual({ contentType: "DataTable", title: undefined, columns: ["Order", "Status"], rows: [["#1", "Shipped"]] });
  });

  it("selects DataSummary for a fields shape", () => {
    const card = selectRenderedCard("get_order", { title: "Order #1", fields: [{ label: "Status", value: "Shipped" }] });
    expect(card).toEqual({ contentType: "DataSummary", title: "Order #1", fields: [{ label: "Status", value: "Shipped" }] });
  });

  it("selects Document for a url + mimeType shape", () => {
    const card = selectRenderedCard("get_invoice", { title: "Invoice", url: "https://x.example.com/i.pdf", mimeType: "application/pdf" });
    expect(card).toMatchObject({ contentType: "Document", url: "https://x.example.com/i.pdf", mimeType: "application/pdf" });
  });

  it("selects ExternalLink for a plain url shape", () => {
    const card = selectRenderedCard("track_shipment", { title: "Track", url: "https://carrier.example.com/1" });
    expect(card).toMatchObject({ contentType: "ExternalLink", url: "https://carrier.example.com/1" });
  });

  // QA Final Review S3: a flat key-value shape (no nested object/array values)
  // that matches none of NextBot's own narrow output conventions now gets a
  // structured `DataSummary` fallback by default (the object's own keys as
  // labels) instead of a raw `JSON.stringify` dump — the observed QA case was
  // exactly this: a realistic tool result whose shape wasn't anticipated, which
  // previously surfaced a customer email address as raw text.
  it("degrades to a DataSummary card (own keys as labels) for a generic flat key-value shape, instead of a raw JSON dump", () => {
    const card = selectRenderedCard("mystery_tool", { customerEmail: "jane@example.com", accountId: "acc_123" });
    expect(card).toEqual({
      contentType: "DataSummary",
      title: "mystery_tool",
      fields: [
        { label: "customerEmail", value: "jane@example.com" },
        { label: "accountId", value: "acc_123" },
      ],
    });
  });

  it("still degrades to Text for a genuinely nested/complex shape a flat card can't represent", () => {
    const card = selectRenderedCard("mystery_tool", { weird: true, nested: { a: 1 } });
    expect(card.contentType).toBe("Text");
    expect((card as { text: string }).text).toContain("mystery_tool");
  });

  it("still degrades to Text for a non-object output (e.g. a bare string/number/null)", () => {
    const card = selectRenderedCard("mystery_tool", "just a string");
    expect(card.contentType).toBe("Text");
  });
});
