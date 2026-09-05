import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchJson } from "./fetch-json.js";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

describe("fetchJson (QA Defect U3 — distinguish 403 from an empty result)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns kind:'ok' with the parsed body on a 2xx response", async () => {
    mockFetchOnce(200, { connectors: [{ id: "c1" }] });
    const result = await fetchJson<{ connectors: unknown[] }>("/api/v1/admin/connectors");
    expect(result).toEqual({ kind: "ok", data: { connectors: [{ id: "c1" }] } });
  });

  it("returns kind:'forbidden' (never 'ok' with an empty list) on a 403", async () => {
    mockFetchOnce(403, { type: "about:blank", title: "You do not have Read access to 'connectors'.", status: 403 });
    const result = await fetchJson("/api/v1/admin/connectors");
    expect(result.kind).toBe("forbidden");
    if (result.kind === "forbidden") {
      expect(result.message).toBe("You do not have Read access to 'connectors'.");
    }
  });

  it("falls back to a generic forbidden message when the 403 body has no title", async () => {
    mockFetchOnce(403, {});
    const result = await fetchJson("/api/v1/admin/connectors");
    expect(result).toEqual({ kind: "forbidden", message: "You don't have access to this section." });
  });

  it("returns kind:'error' with the status for other non-2xx responses", async () => {
    mockFetchOnce(500, { title: "boom" });
    const result = await fetchJson("/api/v1/admin/connectors");
    expect(result).toEqual({ kind: "error", status: 500, message: "boom" });
  });

  it("tolerates a non-JSON body without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );
    const result = await fetchJson("/api/v1/admin/connectors");
    expect(result).toEqual({ kind: "forbidden", message: "You don't have access to this section." });
  });
});
