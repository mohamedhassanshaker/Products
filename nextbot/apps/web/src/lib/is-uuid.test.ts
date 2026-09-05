import { describe, expect, it } from "vitest";
import { isUuid } from "./is-uuid.js";

describe("isUuid (QA Final Review minor item — clean 404 instead of a raw DB 500 for a non-UUID route param)", () => {
  it("accepts a real UUID (any version, any case)", () => {
    expect(isUuid("01a008d8-32b5-7d33-9530-fcdd04711032")).toBe(true);
    expect(isUuid("01A008D8-32B5-7D33-9530-FCDD04711032")).toBe(true);
  });

  it("rejects a non-UUID string that would otherwise throw a raw Postgres cast error", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("123")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
