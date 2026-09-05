import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { apiMethodNotFoundHandler, apiNotFoundResponse } = await import("./api-not-found-response.js");

/**
 * NFR-11, QA retry 3, Defect 1. This module is the single shared source of the
 * "nonexistent `/api/**` path" response used by BOTH `app/api/[...unmatched]/route.ts`
 * and `requirePlatformApi()`'s denial path — so the property that matters is that it is
 * *invariant*: every call, from every caller, for every path, produces the same bytes.
 * A regression here would silently reopen the fingerprinting defect at both call sites
 * at once.
 */
describe("apiNotFoundResponse", () => {
  it("is a 404 with a fixed text/plain body and an explicit Content-Length", async () => {
    const res = apiNotFoundResponse();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("Not Found");
    expect(res.headers.get("content-length")).toBe("9");
  });

  it("returns a byte-identical status/header/body triple on every call", async () => {
    const snapshots = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const res = apiNotFoundResponse();
        return JSON.stringify({
          status: res.status,
          headers: [...res.headers.entries()].sort(),
          body: await res.text(),
        });
      }),
    );
    expect(new Set(snapshots).size).toBe(1);
  });

  it("returns a fresh Response each call so the body stream is never already consumed", async () => {
    const first = apiNotFoundResponse();
    await first.text();
    // Would throw / yield "" if a single cached Response instance were shared.
    expect(await apiNotFoundResponse().text()).toBe("Not Found");
  });

  it("carries no header that could vary between two responses (only content-type/length)", () => {
    expect([...apiNotFoundResponse().headers.keys()].sort()).toEqual(["content-length", "content-type"]);
  });

  it("ignores any arguments it is handed, so it cannot vary by request or route params", async () => {
    // Next invokes a route-handler export as `(request, context)`; the response must
    // not depend on either. Deliberately typed loosely — the point of the test is that
    // the runtime value is unaffected.
    const handler = apiMethodNotFoundHandler as unknown as (...args: unknown[]) => Response;
    const withArgs = handler(new Request("http://localhost/api/internal/ops/tenants", { method: "PUT" }), {
      params: Promise.resolve({ id: "abc" }),
    });
    const withoutArgs = apiNotFoundResponse();
    expect(withArgs.status).toBe(withoutArgs.status);
    expect([...withArgs.headers.entries()].sort()).toEqual([...withoutArgs.headers.entries()].sort());
    expect(await withArgs.text()).toBe(await withoutArgs.text());
  });
});
