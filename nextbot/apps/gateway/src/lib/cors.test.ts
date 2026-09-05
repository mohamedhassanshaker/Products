import { describe, expect, it } from "vitest";
import { corsHeaders, corsPreflightResponse } from "./cors.js";

describe("cors helpers (apps/gateway, LLD §5.1)", () => {
  it("corsHeaders allows the widget's required methods/headers", () => {
    const headers = corsHeaders() as Record<string, string>;
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
  });

  it("corsPreflightResponse returns a 204 with no body", async () => {
    const res = corsPreflightResponse();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});
