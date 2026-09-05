import { describe, expect, it, vi } from "vitest";

// "server-only" throws outside a Next build — stubbed the same way every other
// apps/web unit test does (see build-brand-style-tag.test.ts's identical comment).
vi.mock("server-only", () => ({}));

const { getClientIp } = await import("./client-ip.js");
const { NextRequest } = await import("next/server");

/**
 * Mirrors `apps/gateway/src/lib/client-ip.test.ts` exactly — this file is a
 * deliberate, documented duplication (see `client-ip.ts`'s own header comment),
 * so its test coverage is duplicated too rather than left unverified in this app.
 */
describe("getClientIp (apps/web's public tenant-branding lookup, FR-ADM-07 Part 2)", () => {
  it("returns the first entry of a comma-separated x-forwarded-for chain", () => {
    const req = new NextRequest("http://localhost/api/v1/public/tenant-branding/acme", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" },
    });
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new NextRequest("http://localhost/api/v1/public/tenant-branding/acme", {
      headers: { "x-real-ip": "203.0.113.9" },
    });
    expect(getClientIp(req)).toBe("203.0.113.9");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    const req = new NextRequest("http://localhost/api/v1/public/tenant-branding/acme");
    expect(getClientIp(req)).toBe("unknown");
  });
});
