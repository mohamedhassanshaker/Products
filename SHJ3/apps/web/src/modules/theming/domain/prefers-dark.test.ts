import { describe, expect, it } from "vitest";
import { resolvePrefersDark } from "./prefers-dark.js";

describe("resolvePrefersDark", () => {
  it("prefers the client hint over the cookie", () => {
    expect(resolvePrefersDark({ clientHint: "dark", cookie: "light" })).toBe(true);
    expect(resolvePrefersDark({ clientHint: "light", cookie: "dark" })).toBe(false);
  });

  it("falls back to the cookie when the client hint is absent", () => {
    expect(resolvePrefersDark({ clientHint: null, cookie: "dark" })).toBe(true);
    expect(resolvePrefersDark({ clientHint: null, cookie: "light" })).toBe(false);
  });

  it("defaults to light with neither signal present", () => {
    expect(resolvePrefersDark({ clientHint: null, cookie: null })).toBe(false);
  });

  it("ignores an unrecognised value at either layer rather than throwing", () => {
    expect(resolvePrefersDark({ clientHint: "no-preference", cookie: "dark" })).toBe(true);
    expect(resolvePrefersDark({ clientHint: "no-preference", cookie: null })).toBe(false);
  });
});
