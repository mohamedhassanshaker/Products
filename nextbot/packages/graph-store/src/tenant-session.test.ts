import { describe, expect, it, vi } from "vitest";
import { mapGraphStoreError } from "./tenant-session.js";
import { GraphStoreForbiddenError, GraphStoreUnavailableError } from "./errors.js";

describe("mapGraphStoreError", () => {
  it("maps Neo.ClientError.Security.Forbidden to GraphStoreForbiddenError, never an empty result", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = Object.assign(new Error("ACCESS on database 't-b' is not allowed for user 'u_a'"), {
      code: "Neo.ClientError.Security.Forbidden",
    });
    const mapped = mapGraphStoreError(raw, { tenantId: "tenant-a", database: "t-b" });
    expect(mapped).toBeInstanceOf(GraphStoreForbiddenError);
    expect((mapped as GraphStoreForbiddenError).neo4jCode).toBe("Neo.ClientError.Security.Forbidden");
    // This is the "never silently treated as empty" requirement — a hard alert
    // must actually be observable, not merely a typed error nobody logs.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("SECURITY ALERT"),
      expect.objectContaining({ code: "Neo.ClientError.Security.Forbidden" }),
    );
    consoleErrorSpy.mockRestore();
  });

  it("maps Neo.ClientError.Security.Unauthorized to GraphStoreForbiddenError too (LLD §14.4.6's failure-mapping list names both)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = Object.assign(new Error("unauthorized"), { code: "Neo.ClientError.Security.Unauthorized" });
    const mapped = mapGraphStoreError(raw, {});
    expect(mapped).toBeInstanceOf(GraphStoreForbiddenError);
    vi.restoreAllMocks();
  });

  it("maps a connectivity error to GraphStoreUnavailableError, not GraphStoreForbiddenError", () => {
    const raw = Object.assign(new Error("could not connect"), { code: "ServiceUnavailable" });
    const mapped = mapGraphStoreError(raw, {});
    expect(mapped).toBeInstanceOf(GraphStoreUnavailableError);
    expect(mapped).not.toBeInstanceOf(GraphStoreForbiddenError);
  });

  it("passes an unrelated error through unchanged", () => {
    const raw = new TypeError("some genuine programming bug");
    expect(mapGraphStoreError(raw, {})).toBe(raw);
  });
});
