import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type * as NextbotTenancy from "@nextbot/tenancy";

// "server-only" (imported transitively by client-ip.ts/rate-limit.ts) throws
// outside a Next build — stubbed the same way every other apps/web route test does.
vi.mock("server-only", () => ({}));

const resolveTenantBySlugMock = vi.fn();
const getTenantBrandingMock = vi.fn();
vi.mock("@nextbot/tenancy", async (importOriginal) => {
  // Real `checkContrastRatio` is reused (not mocked) so the route's
  // `pickForegroundForContrast` call — which this route deliberately reuses from
  // `build-brand-style-tag.ts` rather than a second/divergent implementation —
  // exercises the genuine WCAG contrast algorithm in this test.
  const actual = await importOriginal<typeof NextbotTenancy>();
  return {
    ...actual,
    resolveTenantBySlug: (...args: unknown[]) => resolveTenantBySlugMock(...args),
    getTenantBranding: (...args: unknown[]) => getTenantBrandingMock(...args),
  };
});

const checkRateLimitMock = vi.fn();
vi.mock("@/src/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

vi.mock("@/src/lib/client-ip", () => ({
  getClientIp: () => "203.0.113.5",
}));

const DEFAULT_BODY = { whiteLabelEnabled: false, primaryColor: null, accentForeground: null, logoUrl: null, tenantName: null };

function brandingRequest(slug: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/public/tenant-branding/${slug}`);
}

describe("GET /api/v1/public/tenant-branding/[slug] (FR-ADM-07 Part 2 — login-screen branding)", () => {
  beforeEach(() => {
    resolveTenantBySlugMock.mockReset();
    getTenantBrandingMock.mockReset();
    checkRateLimitMock.mockReset().mockResolvedValue({ allowed: true, remaining: 29, limit: 30 });
  });

  it("returns the real branding for an existing, white-labeled tenant", async () => {
    resolveTenantBySlugMock.mockResolvedValue({ id: "tenant-1", name: "Acme Corp" });
    getTenantBrandingMock.mockResolvedValue({
      whiteLabelEnabled: true,
      brandingConfig: {
        primaryColor: "#1B6B4A",
        secondaryColor: "#0E3B28",
        logoLightUrl: "https://example.com/logo.svg",
        logoDarkUrl: null,
        faviconUrl: null,
        fontFamily: null,
      },
    });
    const { GET } = await import("./route.js");

    const res = await GET(brandingRequest("acme"), { params: Promise.resolve({ slug: "acme" }) });

    expect(res.status).toBe(200);
    // #1B6B4A is a mid-tone green — white foreground clears AA against it, same
    // pairing `build-brand-style-tag.test.ts` verifies for the Admin Console shell.
    expect(await res.json()).toEqual({
      whiteLabelEnabled: true,
      primaryColor: "#1B6B4A",
      accentForeground: "#ffffff",
      logoUrl: "https://example.com/logo.svg",
      tenantName: "Acme Corp",
    });
  });

  it("returns the identical generic default response for a tenant that exists but has white-labeling disabled", async () => {
    resolveTenantBySlugMock.mockResolvedValue({ id: "tenant-2", name: "Beta Inc" });
    getTenantBrandingMock.mockResolvedValue({ whiteLabelEnabled: false, brandingConfig: null });
    const { GET } = await import("./route.js");

    const res = await GET(brandingRequest("beta"), { params: Promise.resolve({ slug: "beta" }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_BODY);
  });

  it("returns the identical generic default response for a nonexistent tenant slug — never a 404, never distinguishable from the disabled case", async () => {
    resolveTenantBySlugMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");

    const res = await GET(brandingRequest("does-not-exist"), { params: Promise.resolve({ slug: "does-not-exist" }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_BODY);
    // A nonexistent tenant must never even reach the branding lookup.
    expect(getTenantBrandingMock).not.toHaveBeenCalled();
  });

  it("returns the generic default response (never a distinct error) for a malformed slug, without querying the database", async () => {
    const { GET } = await import("./route.js");

    const res = await GET(brandingRequest("Not Valid!"), { params: Promise.resolve({ slug: "Not Valid!" }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_BODY);
    expect(resolveTenantBySlugMock).not.toHaveBeenCalled();
  });

  it("returns 429 once the per-IP rate limit is exceeded", async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 30 });
    const { GET } = await import("./route.js");

    const res = await GET(brandingRequest("acme"), { params: Promise.resolve({ slug: "acme" }) });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(resolveTenantBySlugMock).not.toHaveBeenCalled();
  });
});
