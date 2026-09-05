import { describe, expect, it } from "vitest";
import { rateLimitedResponse } from "./rate-limit-response.js";

describe("rateLimitedResponse (BE2 — 429 problem+json)", () => {
  it("returns a 429 with a Retry-After header matching the window", async () => {
    const res = rateLimitedResponse(60);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.status).toBe(429);
    expect(body.title).toContain("Too many requests");
  });
});
