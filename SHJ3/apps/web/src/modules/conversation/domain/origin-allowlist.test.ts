import { describe, expect, it } from "vitest";
import { assertOriginAllowed, isOriginAllowed, OriginNotAllowedError } from "./origin-allowlist.js";

describe("assertOriginAllowed", () => {
  it("allows an exact host match", () => {
    expect(() => assertOriginAllowed("https://sharjah.ae", ["sharjah.ae"])).not.toThrow();
  });

  it("allows a single-label wildcard match", () => {
    expect(() =>
      assertOriginAllowed("https://services.sharjah.ae", ["*.sharjah.ae"]),
    ).not.toThrow();
  });

  it("is case-insensitive on both sides", () => {
    expect(() =>
      assertOriginAllowed("https://Services.SHARJAH.ae", ["*.sharjah.ae"]),
    ).not.toThrow();
  });

  it("respects the port/scheme being irrelevant — only hostname matters", () => {
    expect(() => assertOriginAllowed("https://sharjah.ae:8443", ["sharjah.ae"])).not.toThrow();
  });

  // The exact attack api.md §4.1 names: a bare suffix match would let this
  // through because "evil-sharjah.ae" ends with "sharjah.ae" as a string.
  it("rejects the evil-sharjah.ae suffix attack against an exact allow-list entry", () => {
    expect(() => assertOriginAllowed("https://evil-sharjah.ae", ["sharjah.ae"])).toThrow(
      OriginNotAllowedError,
    );
  });

  it("rejects the evil-sharjah.ae suffix attack against a wildcard allow-list entry", () => {
    expect(() => assertOriginAllowed("https://evil-sharjah.ae", ["*.sharjah.ae"])).toThrow(
      OriginNotAllowedError,
    );
  });

  it("rejects a multi-label prefix against a single-label wildcard", () => {
    expect(() => assertOriginAllowed("https://a.b.sharjah.ae", ["*.sharjah.ae"])).toThrow(
      OriginNotAllowedError,
    );
  });

  it("does not let a wildcard entry match its own apex", () => {
    expect(() => assertOriginAllowed("https://sharjah.ae", ["*.sharjah.ae"])).toThrow(
      OriginNotAllowedError,
    );
  });

  it("rejects a missing Origin header", () => {
    expect(() => assertOriginAllowed(null, ["sharjah.ae"])).toThrow(OriginNotAllowedError);
  });

  it("rejects an unparseable Origin header", () => {
    expect(() => assertOriginAllowed("not-a-url", ["sharjah.ae"])).toThrow(OriginNotAllowedError);
  });

  it("rejects a host not on the list at all", () => {
    expect(() => assertOriginAllowed("https://example.com", ["sharjah.ae"])).toThrow(
      OriginNotAllowedError,
    );
  });
});

describe("isOriginAllowed", () => {
  it("mirrors assertOriginAllowed as a boolean", () => {
    expect(isOriginAllowed("https://sharjah.ae", ["sharjah.ae"])).toBe(true);
    expect(isOriginAllowed("https://evil-sharjah.ae", ["sharjah.ae"])).toBe(false);
  });
});

/**
 * `sameOrigin` — the fix for two real, live-Chromium-found rejections of this
 * app's own `/{locale}/widget` SSR demo page talking to its own API: a
 * same-origin `GET` (real browsers send no `Origin` header at all there,
 * only `Referer`) and a same-origin `POST` (a real `Origin` header, but one
 * naming this app's own dev origin, `http://localhost:3000`, which has no
 * reason to ever be on a tenant's third-party embed allow-list).
 */
describe("assertOriginAllowed — sameOrigin (self-directed requests)", () => {
  const SELF = "http://localhost:3000";

  it("allows a missing Origin header when Referer proves the request is self-directed", () => {
    expect(() =>
      assertOriginAllowed(null, ["sharjah.ae"], {
        refererHeader: "http://localhost:3000/en/widget?channelKey=sewa.WebWidget",
        requestOrigin: SELF,
      }),
    ).not.toThrow();
  });

  it("allows a real Origin header that names this app's own origin, even off the allow-list", () => {
    expect(() =>
      assertOriginAllowed(SELF, ["sharjah.ae"], {
        refererHeader: null,
        requestOrigin: SELF,
      }),
    ).not.toThrow();
  });

  it("still rejects a missing Origin header when Referer names a DIFFERENT origin", () => {
    expect(() =>
      assertOriginAllowed(null, ["sharjah.ae"], {
        refererHeader: "https://evil-sharjah.ae/some-page",
        requestOrigin: SELF,
      }),
    ).toThrow(OriginNotAllowedError);
  });

  it("still rejects a missing Origin header with no Referer at all, even with sameOrigin evidence supplied", () => {
    expect(() =>
      assertOriginAllowed(null, ["sharjah.ae"], { refererHeader: null, requestOrigin: SELF }),
    ).toThrow(OriginNotAllowedError);
  });

  it("still rejects a genuinely cross-origin Origin header even with sameOrigin evidence supplied", () => {
    expect(() =>
      assertOriginAllowed("https://evil-sharjah.ae", ["sharjah.ae"], {
        refererHeader: null,
        requestOrigin: SELF,
      }),
    ).toThrow(OriginNotAllowedError);
  });

  it("a real allow-listed Origin still passes with sameOrigin evidence present but not matching", () => {
    expect(() =>
      assertOriginAllowed("https://sharjah.ae", ["sharjah.ae"], {
        refererHeader: null,
        requestOrigin: SELF,
      }),
    ).not.toThrow();
  });
});
