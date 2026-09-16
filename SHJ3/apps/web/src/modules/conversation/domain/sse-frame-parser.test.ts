import { describe, expect, it } from "vitest";
import { encodeSseFrame, SseFrameParser } from "./sse-frame-parser.js";

describe("SseFrameParser", () => {
  it("parses a single complete frame", () => {
    const parser = new SseFrameParser();
    const frames = parser.push('id: 1\nevent: turn_started\ndata: {"turnId":"trn_1"}\n\n');
    expect(frames).toEqual([{ id: "1", event: "turn_started", data: '{"turnId":"trn_1"}' }]);
  });

  it("buffers a partial frame across two push() calls", () => {
    const parser = new SseFrameParser();
    expect(parser.push("id: 1\nevent: tok")).toEqual([]);
    const frames = parser.push('en\ndata: {"text":"hi"}\n\n');
    expect(frames).toEqual([{ id: "1", event: "token", data: '{"text":"hi"}' }]);
  });

  it("parses multiple frames delivered in one chunk", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("id: 1\nevent: a\ndata: {}\n\nid: 2\nevent: b\ndata: {}\n\n");
    expect(frames.map((f) => f.event)).toEqual(["a", "b"]);
  });

  it("joins multi-line data fields with a newline", () => {
    const parser = new SseFrameParser();
    const frames = parser.push("event: multi\ndata: line1\ndata: line2\n\n");
    expect(frames[0]?.data).toBe("line1\nline2");
  });

  it("ignores a bare heartbeat comment", () => {
    const parser = new SseFrameParser();
    const frames = parser.push(":heartbeat\n\n");
    expect(frames).toEqual([]);
  });
});

describe("encodeSseFrame", () => {
  it("round-trips through SseFrameParser", () => {
    const encoded = encodeSseFrame({ id: "5", event: "done", data: '{"status":"completed"}' });
    const parser = new SseFrameParser();
    expect(parser.push(encoded)).toEqual([
      { id: "5", event: "done", data: '{"status":"completed"}' },
    ]);
  });
});
