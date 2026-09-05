import type { ChunkingConfig, ChunkProvenance, ParsedBlock } from "@nextbot/contracts";

/**
 * The Parse stage's text-extraction logic (LLD §14.4.3 stage 2). This phase's real,
 * working implementation handles plain text and Markdown-shaped documents — the two
 * mime types this phase's own Upload/Url source kinds can genuinely produce end to
 * end. **Disclosed narrowing**: real PDF/DOCX layout extraction (OCR, structured
 * page/column detection) is out of this phase's bar — it is a separate, sizeable
 * parsing-library integration decision (LLD's own "OCR via the parse adapter" note
 * implies a pluggable adapter seam, which this function IS that seam for; a future
 * adapter can be added here without changing `ParsedBlock`'s shape). Tables ARE
 * preserved as structured blocks, never flattened to prose (FR-KB-02) — this is the
 * one structural requirement this implementation does satisfy for real, for the
 * Markdown pipe-table shape.
 *
 * Block kinds recognized: `heading` (`#`..`######` Markdown ATX headings), `table`
 * (a contiguous run of `|`-delimited lines with a `---`-style separator row —
 * standard Markdown table syntax), `list` (contiguous `-`/`*`/`1.`-prefixed lines),
 * `code` (a fenced ``` block), and `text` (everything else, split on blank lines).
 */
export function parseText(rawText: string, documentTitle: string | null): ParsedBlock[] {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const blocks: ParsedBlock[] = [];
  let currentSection: string | undefined = documentTitle ?? undefined;
  let i = 0;

  function isTableSeparatorRow(line: string): boolean {
    return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
  }

  function splitPipeRow(line: string): string[] {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const content = (headingMatch[2] ?? "").trim();
      currentSection = content;
      blocks.push({ kind: "heading", section: currentSection, content });
      i += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // consume closing fence
      blocks.push({ kind: "code", section: currentSection, content: codeLines.join("\n") });
      continue;
    }

    // A table: this line and the next both look pipe-delimited, and the next is a
    // separator row (`---|---`) — standard Markdown table syntax.
    if (line.includes("|") && isTableSeparatorRow(lines[i + 1] ?? "")) {
      const header = splitPipeRow(line);
      const rows: string[][] = [header];
      i += 2; // header + separator
      while (i < lines.length && (lines[i] ?? "").includes("|") && !/^\s*$/.test(lines[i] ?? "")) {
        rows.push(splitPipeRow(lines[i] ?? ""));
        i += 1;
      }
      blocks.push({ kind: "table", section: currentSection, content: rows.map((r) => r.join(" | ")).join("\n"), tableJson: rows });
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const listLines: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "") && !/^\s*$/.test(lines[i] ?? "")) {
        listLines.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ kind: "list", section: currentSection, content: listLines.join("\n") });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i] ?? "") && !/^(#{1,6})\s+/.test(lines[i] ?? "") && !(lines[i] ?? "").trim().startsWith("```")) {
      paraLines.push(lines[i] ?? "");
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: "text", section: currentSection, content: paraLines.join(" ").trim() });
    }
  }

  return blocks;
}

/** Cheap English-text token-count heuristic (chars/4) — no tokenizer library exists
 *  in this codebase yet, and adding one is a dependency decision outside this
 *  phase's bar-check scope (see this module's README). Advisory only: it drives
 *  chunk sizing/overlap, never a billing or context-window-exactness path. */
export function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface DraftChunk {
  text: string;
  tokenCount: number;
  provenance: ChunkProvenance;
}

/**
 * The Chunk stage (LLD §14.4.3 stage 3): accumulates parsed blocks into chunks up to
 * `config.targetTokens`, carrying `config.overlapTokens` worth of trailing text
 * forward into the next chunk for continuity (`semantic`/`fixed` strategy — this
 * phase's real, disclosed simplification treats both the same way: block-boundary-
 * respecting accumulation rather than a genuine embedding-similarity semantic split,
 * which is a quality refinement for a later phase, not a structural requirement).
 * `preserveTables: true` (the default, and this phase's only behavior) means a
 * `table` block is ALWAYS its own standalone chunk, never merged with adjoining
 * text and never split across chunks (FR-KB-02).
 */
export function chunkParsedBlocks(blocks: ParsedBlock[], config: ChunkingConfig, documentTitle: string | null): DraftChunk[] {
  const chunks: DraftChunk[] = [];
  let bufferText = "";
  let bufferTokens = 0;
  let bufferStartBlockIndex = 0;

  function flush(endBlockIndex: number): void {
    if (bufferText.trim().length === 0) {
      bufferText = "";
      bufferTokens = 0;
      return;
    }
    const text = bufferText.trim();
    chunks.push({
      text,
      tokenCount: estimateTokenCount(text),
      provenance: { documentTitle, blockIndex: bufferStartBlockIndex, charStart: 0, charEnd: text.length, section: blocks[endBlockIndex]?.section },
    });
    // Carry forward an overlap tail (approx overlapTokens*4 chars) for continuity.
    const overlapChars = Math.max(0, config.overlapTokens * 4);
    bufferText = overlapChars > 0 ? text.slice(Math.max(0, text.length - overlapChars)) : "";
    bufferTokens = estimateTokenCount(bufferText);
  }

  blocks.forEach((block, index) => {
    if (config.preserveTables && block.kind === "table") {
      flush(index - 1);
      chunks.push({
        text: block.content,
        tokenCount: estimateTokenCount(block.content),
        provenance: { documentTitle, blockIndex: index, charStart: 0, charEnd: block.content.length, section: block.section },
      });
      bufferText = "";
      bufferTokens = 0;
      bufferStartBlockIndex = index + 1;
      return;
    }

    const blockTokens = estimateTokenCount(block.content);
    if (bufferTokens > 0 && bufferTokens + blockTokens > config.targetTokens) {
      flush(index - 1);
      bufferStartBlockIndex = index;
    }
    bufferText = bufferText.length > 0 ? `${bufferText}\n\n${block.content}` : block.content;
    bufferTokens = estimateTokenCount(bufferText);
  });

  flush(blocks.length - 1);
  return chunks;
}
