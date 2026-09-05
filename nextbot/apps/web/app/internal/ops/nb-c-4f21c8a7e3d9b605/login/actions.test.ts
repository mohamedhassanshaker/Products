import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const cookieStoreSet = vi.fn();
const cookieStoreDelete = vi.fn();
const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieStoreSet, delete: cookieStoreDelete }),
  headers: async () => headersMock(),
}));

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
}));

const checkRateLimitMock = vi.fn();
vi.mock("@/src/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimitMock(...a),
}));

const { opsLoginAction, opsLogoutAction } = await import("./actions.js");
const { OPS_SESSION_COOKIE } = await import("@/src/lib/platform-ops-auth");

const ORIGINAL_ENV = { ...process.env };

function formData(token: string): FormData {
  const fd = new FormData();
  fd.set("token", token);
  return fd;
}

function allowedHeaders() {
  // QA retry 1, Defect 2: X-Forwarded-For is only trusted once a
  // NEXTBOT_OPS_TRUSTED_PROXY_CIDRS is configured (see platform-ops-auth.ts) — the
  // trailing hop here represents that trusted proxy, peeled off to resolve
  // "10.0.0.5" as the real caller.
  return new Headers({ "x-forwarded-for": "10.0.0.5, 192.168.1.1" });
}

describe("internal/ops/login actions", () => {
  beforeEach(() => {
    cookieStoreSet.mockReset();
    cookieStoreDelete.mockReset();
    redirectMock.mockReset();
    checkRateLimitMock.mockReset();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 4, limit: 5 });
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "correct-token";
    process.env.NEXTBOT_OPS_IP_ALLOWLIST = "10.0.0.0/24";
    process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "192.168.1.1/32";
    headersMock.mockReturnValue(allowedHeaders());
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("sets the ops session cookie and redirects on a correct token", async () => {
    await opsLoginAction({}, formData("correct-token"));
    expect(cookieStoreSet).toHaveBeenCalledWith(
      OPS_SESSION_COOKIE,
      "correct-token",
      // QA retry 1, Defect 3 fix: Path=/ (not the narrower "/internal/ops", which
      // never matches the sibling "/api/internal/ops/**" route handlers per RFC
      // 6265 — the console's own client-side fetches were never sending this
      // cookie at all).
      expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/" }),
    );
    expect(redirectMock).toHaveBeenCalledWith("/internal/ops/tenants");
  });

  it("returns a generic error for a wrong token, without setting a cookie", async () => {
    const result = await opsLoginAction({}, formData("wrong-token"));
    expect(result.error).toMatch(/invalid operator token/i);
    expect(cookieStoreSet).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns a generic (not surface-revealing) error when unconfigured", async () => {
    delete process.env.NEXTBOT_OPS_OPERATOR_TOKEN;
    delete process.env.NEXTBOT_OPS_IP_ALLOWLIST;
    const result = await opsLoginAction({}, formData("correct-token"));
    expect(result.error).toBe("Sign-in failed.");
    expect(cookieStoreSet).not.toHaveBeenCalled();
  });

  it("returns a generic error from a disallowed IP even with the correct token", async () => {
    headersMock.mockReturnValue(new Headers({ "x-forwarded-for": "203.0.113.99" }));
    const result = await opsLoginAction({}, formData("correct-token"));
    expect(result.error).toBe("Sign-in failed.");
    expect(cookieStoreSet).not.toHaveBeenCalled();
  });

  it("rate-limits repeated attempts per caller IP", async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 5 });
    const result = await opsLoginAction({}, formData("correct-token"));
    expect(result.error).toMatch(/too many attempts/i);
    expect(cookieStoreSet).not.toHaveBeenCalled();
  });

  it("logout clears the cookie and redirects to the login form", async () => {
    await opsLogoutAction();
    expect(cookieStoreDelete).toHaveBeenCalledWith({ name: OPS_SESSION_COOKIE, path: "/" });
    expect(redirectMock).toHaveBeenCalledWith("/internal/ops/login");
  });
});
