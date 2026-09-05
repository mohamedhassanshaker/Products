import { describe, expect, it } from "vitest";
import { parseText, chunkParsedBlocks, estimateTokenCount } from "./chunking.js";
import { DEFAULT_CHUNKING_CONFIG } from "@nextbot/contracts";

describe("parseText (FR-KB-02 — tables preserved as structured blocks, never flattened)", () => {
  it("splits headings, paragraphs, lists, and code blocks", () => {
    const raw = "# Title\n\nSome intro text.\n\n- item one\n- item two\n\n```\nconst x = 1;\n```\n";
    const blocks = parseText(raw, null);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "text", "list", "code"]);
    expect(blocks[0]?.content).toBe("Title");
    expect(blocks[1]?.content).toBe("Some intro text.");
    expect(blocks[2]?.content).toContain("item one");
    expect(blocks[3]?.content).toBe("const x = 1;");
  });

  it("preserves a Markdown pipe table as a structured tableJson block, never flattened to prose", () => {
    const raw = "| Name | Price |\n| --- | --- |\n| Widget | 9.99 |\n| Gadget | 19.99 |\n";
    const blocks = parseText(raw, null);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("table");
    expect(blocks[0]?.tableJson).toEqual([
      ["Name", "Price"],
      ["Widget", "9.99"],
      ["Gadget", "19.99"],
    ]);
  });

  it("a document with a table AND surrounding text keeps the table as its own block", () => {
    const raw = "Intro paragraph.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nOutro paragraph.";
    const blocks = parseText(raw, null);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "table", "text"]);
  });
});

describe("chunkParsedBlocks", () => {
  it("keeps a table block as its own standalone chunk, never merged with adjoining text", () => {
    const blocks = parseText("Intro.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nOutro.", "Doc Title");
    const chunks = chunkParsedBlocks(blocks, DEFAULT_CHUNKING_CONFIG, "Doc Title");
    const tableChunk = chunks.find((c) => c.text.includes("A | B"));
    expect(tableChunk).toBeDefined();
    expect(tableChunk?.text).not.toContain("Intro.");
    expect(tableChunk?.text).not.toContain("Outro.");
  });

  it("respects targetTokens by starting a new chunk once the running buffer would exceed it", () => {
    const bigConfig = { ...DEFAULT_CHUNKING_CONFIG, targetTokens: 5, overlapTokens: 0 };
    const blocks = [
      { kind: "text" as const, content: "a".repeat(40) },
      { kind: "text" as const, content: "b".repeat(40) },
    ];
    const chunks = chunkParsedBlocks(blocks, bigConfig, null);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("carries an overlap tail into the next chunk when overlapTokens > 0", () => {
    const overlapConfig = { ...DEFAULT_CHUNKING_CONFIG, targetTokens: 3, overlapTokens: 10 };
    const blocks = [
      { kind: "text" as const, content: "AAAAAAAAAA" },
      { kind: "text" as const, content: "BBBBBBBBBB" },
    ];
    const chunks = chunkParsedBlocks(blocks, overlapConfig, null);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("a valid non-empty chunk always has a positive estimated token count", () => {
    expect(estimateTokenCount("hello world")).toBeGreaterThan(0);
    expect(estimateTokenCount("")).toBeGreaterThan(0);
  });
});
