import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getClientIp } from "./client-ip.js";

describe("getClientIp (BE2 per-IP rate-limit key)", () => {
  it("returns the first entry of a comma-separated x-forwarded-for chain", () => {
    const req = new NextRequest("http://localhost/api/v1/widget/sessions", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" },
    });
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new NextRequest("http://localhost/api/v1/widget/sessions", {
      headers: { "x-real-ip": "203.0.113.9" },
    });
    expect(getClientIp(req)).toBe("203.0.113.9");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    const req = new NextRequest("http://localhost/api/v1/widget/sessions");
    expect(getClientIp(req)).toBe("unknown");
  });
});
