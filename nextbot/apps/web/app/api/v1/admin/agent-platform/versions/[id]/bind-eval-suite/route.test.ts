import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { generateId } from "@nextbot/db";

/**
 * HTTP-route-level regression test for the QA-reported defect: `packages/contracts/src/formats.ts`
 * never registered TypeBox's `"uuid"` format, so `Value.Check` on this route's
 * `BindEvalSuiteRequestSchema` (which uses `Type.String({ format: "uuid" })`) failed
 * closed for *every* request — including ones with a genuinely valid UUID — returning
 * a 422 no matter what. All prior test coverage for this feature called the
 * application-service function (`bindEvalSuite()`) directly, bypassing this route's
 * request-validation layer entirely, which is exactly why the bug went uncaught. This
 * test exercises the real `POST` handler (mocking only the session/RBAC/service-layer
 * seams), so a regression here — either "uuid" becoming unregistered again, or any
 * other change to this route's validation — is caught at the HTTP boundary.
 *
 * **Retry 3 correction.** The prior fix attempt's version of this file used a
 * hand-picked example UUID (`3fa85f64-...`, version 4) rather than an id this system's
 * own `generateId()` (`@nextbot/db`, UUIDv7) actually produces — so it passed even
 * though the underlying regex rejected every real v7 id. `generateId()` is imported
 * directly here (this app already depends on `@nextbot/db` for real, no test-only
 * addition) and used for every id fixture below, so this test would have caught the
 * regression the first time.
 */

// "server-only" (imported by "@/src/lib/api-guard", which this route imports for
// real) unconditionally throws unless imported through Next's own webpack build —
// vitest has no such build step, so it must be stubbed to a no-op here the same way
// apps/web/src/lib/api-guard.test.ts already does.
vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getSessionTenantContextMock = vi.fn();
vi.mock("@/src/lib/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionTenantContext: (...args: unknown[]) => getSessionTenantContextMock(...args),
}));

const requirePermissionMock = vi.fn();
vi.mock("@nextbot/iam", () => ({
  requirePermission: (...args: unknown[]) => requirePermissionMock(...args),
}));

const handleBindEvalSuiteMock = vi.fn();
vi.mock("@nextbot/agent-platform", () => ({
  handleBindEvalSuite: (...args: unknown[]) => handleBindEvalSuiteMock(...args),
}));

/** Builds a `NextRequest` for this route the same way the real Admin Console client would. */
function bindEvalSuiteRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/admin/agent-platform/versions/version-1/bind-eval-suite", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/v1/admin/agent-platform/versions/[id]/bind-eval-suite (QA regression: TypeBox 'uuid' format)", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ permissions: {}, tenantId: "tenant-1" });
    getSessionTenantContextMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", region: "eu", environment: "Sandbox" });
    requirePermissionMock.mockReset(); // no-op = permission granted
    handleBindEvalSuiteMock.mockReset().mockResolvedValue(undefined);
  });

  it("accepts a request with a real UUIDv7 evalSuiteId (this system's own generateId() output) and delegates to the service (regression: previously 422'd on every request, including real ids)", async () => {
    const { POST } = await import("./route.js");
    // A real id from this system's own generator, not a hand-picked example — the
    // specific gap that let the prior fix attempt pass while the live system 422'd.
    const realUuid = generateId();

    const res = await POST(bindEvalSuiteRequest({ evalSuiteId: realUuid }), {
      params: Promise.resolve({ id: "version-1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handleBindEvalSuiteMock).toHaveBeenCalledWith(expect.anything(), "version-1", realUuid);
  });

  it("accepts a request with a hand-picked RFC 4122 v4 UUID too (older UUID versions must keep working)", async () => {
    const { POST } = await import("./route.js");
    const v4Uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    const res = await POST(bindEvalSuiteRequest({ evalSuiteId: v4Uuid }), {
      params: Promise.resolve({ id: "version-1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handleBindEvalSuiteMock).toHaveBeenCalledWith(expect.anything(), "version-1", v4Uuid);
  });

  it("still rejects a genuinely malformed (non-UUID) evalSuiteId with 422 and never calls the service", async () => {
    const { POST } = await import("./route.js");

    const res = await POST(bindEvalSuiteRequest({ evalSuiteId: "not-a-uuid" }), {
      params: Promise.resolve({ id: "version-1" }),
    });

    expect(res.status).toBe(422);
    expect(handleBindEvalSuiteMock).not.toHaveBeenCalled();
  });

  it("rejects a request body missing evalSuiteId entirely with 422", async () => {
    const { POST } = await import("./route.js");

    const res = await POST(bindEvalSuiteRequest({}), { params: Promise.resolve({ id: "version-1" }) });

    expect(res.status).toBe(422);
    expect(handleBindEvalSuiteMock).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session (guard short-circuit branch)", async () => {
    getSessionMock.mockResolvedValue(null);
    const { POST } = await import("./route.js");

    const res = await POST(bindEvalSuiteRequest({ evalSuiteId: generateId() }), {
      params: Promise.resolve({ id: "version-1" }),
    });

    expect(res.status).toBe(401);
    expect(handleBindEvalSuiteMock).not.toHaveBeenCalled();
  });

  it("maps a service-layer failure through problemResponse rather than letting it escape unhandled", async () => {
    const { DomainError } = await import("@nextbot/contracts");
    class EvalSuiteNotFoundError extends DomainError {
      readonly code = "EVAL_SUITE_NOT_FOUND";
      readonly httpStatus = 404;
      constructor() {
        super("Eval suite not found.");
      }
    }
    handleBindEvalSuiteMock.mockRejectedValue(new EvalSuiteNotFoundError());
    const { POST } = await import("./route.js");

    const res = await POST(bindEvalSuiteRequest({ evalSuiteId: generateId() }), {
      params: Promise.resolve({ id: "version-1" }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("EVAL_SUITE_NOT_FOUND");
  });
});
