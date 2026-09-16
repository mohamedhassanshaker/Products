/**
 * A minimal `text/event-stream` frame parser/encoder (api.md §5.2's grammar).
 *
 * Pure string-in/string-out — no `fetch`, no `ReadableStream`, no Node
 * `Buffer` — so it is usable from three places that would otherwise each
 * hand-roll the same parsing: the server-side proxy Route Handler (turns raw
 * bytes from `shj3-ai` into typed frames it can filter and re-encode), the
 * React client hook (`use-widget-conversation.ts`, parsing the browser
 * `fetch` body's own bytes), and — accepted as one deliberate duplication,
 * see `apps/web/src/widget-embed/`'s own module comment — the standalone
 * embeddable bundle, which re-implements an equivalent small parser rather
 * than importing this one, so its esbuild entry point stays fully
 * self-contained with no dependency on the rest of this app's module graph.
 */

export interface SseFrame {
  readonly id: string | null;
  readonly event: string | null;
  /** Raw `data:` payload, already joined across multi-line `data:` fields with `\n`, NOT JSON-parsed. */
  readonly data: string;
}

/**
 * Incremental parser: feed it chunks as they arrive (`push()`), and it
 * returns every complete frame the chunk completed. A frame is terminated by
 * a blank line, per the SSE spec, and may span more than one `push()` call —
 * the parser buffers a trailing partial frame across calls.
 */
export class SseFrameParser {
  private buffer = "";

  /** Feed one chunk of raw text (already UTF-8 decoded). Returns every complete frame the chunk completed. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];

    // Frames are separated by a blank line — `\n\n` (or `\r\n\r\n`, which the
    // `\r` normalisation below reduces to the same case).
    this.buffer = this.buffer.replace(/\r\n/g, "\n");

    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const frame = parseOneFrame(rawFrame);
      if (frame) frames.push(frame);
    }

    return frames;
  }
}

function parseOneFrame(raw: string): SseFrame | null {
  let id: string | null = null;
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) continue; // blank/comment (heartbeat)
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0 && id === null && event === null) return null; // pure comment/heartbeat frame
  return { id, event, data: dataLines.join("\n") };
}

/** Encode one frame back to wire format — `id: N\nevent: name\ndata: json\n\n`, matching `conversation_router.py`'s own `_event()` helper exactly. */
export function encodeSseFrame(frame: SseFrame): string {
  const lines: string[] = [];
  if (frame.id !== null) lines.push(`id: ${frame.id}`);
  if (frame.event !== null) lines.push(`event: ${frame.event}`);
  for (const dataLine of frame.data.split("\n")) lines.push(`data: ${dataLine}`);
  return `${lines.join("\n")}\n\n`;
}

/** A `:heartbeat` comment line (api.md §5.2: "every 15 seconds stops intermediaries closing an idle stream"). */
export function encodeHeartbeatComment(): string {
  return ":heartbeat\n\n";
}
