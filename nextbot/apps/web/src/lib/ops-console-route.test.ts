import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  OPS_CONSOLE_INTERNAL_PREFIX,
  OPS_CONSOLE_PUBLIC_PREFIX,
  decodeOpsPathnameOnce,
  isOpsConsoleInternalPath,
  isOpsConsolePublicPath,
  swapOpsConsolePrefix,
} from "./ops-console-route.js";

/** `apps/web/app`, resolved from this file rather than from `process.cwd()` so the suite
 * behaves the same however vitest is invoked. */
const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "app");
/** The on-disk folder the public prefix corresponds to (`app/internal/ops`). */
const PUBLIC_DIR = path.join(APP_DIR, ...OPS_CONSOLE_PUBLIC_PREFIX.split("/").filter(Boolean));
/** The single folder name the internal prefix adds beneath it. */
const INTERNAL_SEGMENT = OPS_CONSOLE_INTERNAL_PREFIX.slice(OPS_CONSOLE_PUBLIC_PREFIX.length + 1);

describe("ops-console-route.ts", () => {
  it("nests the internal prefix directly under the public one", () => {
    expect(OPS_CONSOLE_INTERNAL_PREFIX.startsWith(OPS_CONSOLE_PUBLIC_PREFIX + "/")).toBe(true);
    expect(INTERNAL_SEGMENT).not.toContain("/");
    // Next excludes `_`-prefixed folders from routing entirely, so an internal segment named
    // that way would make the console unreachable rather than merely unadvertised.
    expect(INTERNAL_SEGMENT.startsWith("_")).toBe(false);
  });

  it("maps a path from either prefix onto the other, preserving the tail exactly", () => {
    for (const tail of ["", "/login", "/tenants", "/tenants/new", "/tenants/abc/deeper"]) {
      const publicPath = OPS_CONSOLE_PUBLIC_PREFIX + tail;
      const internalPath = OPS_CONSOLE_INTERNAL_PREFIX + tail;
      expect(swapOpsConsolePrefix(publicPath, OPS_CONSOLE_PUBLIC_PREFIX, OPS_CONSOLE_INTERNAL_PREFIX)).toBe(internalPath);
      expect(swapOpsConsolePrefix(internalPath, OPS_CONSOLE_INTERNAL_PREFIX, OPS_CONSOLE_PUBLIC_PREFIX)).toBe(publicPath);
    }
  });

  it("recognizes the internal prefix itself and its descendants, and nothing else", () => {
    expect(isOpsConsoleInternalPath(OPS_CONSOLE_INTERNAL_PREFIX)).toBe(true);
    expect(isOpsConsoleInternalPath(`${OPS_CONSOLE_INTERNAL_PREFIX}/tenants`)).toBe(true);
    for (const other of [
      OPS_CONSOLE_PUBLIC_PREFIX,
      `${OPS_CONSOLE_PUBLIC_PREFIX}/tenants`,
      // Shares a character prefix but is a different (nonexistent) path — must not be
      // mistaken for the internal one, or it would be rewritten instead of left to 404.
      `${OPS_CONSOLE_INTERNAL_PREFIX}x`,
      `${OPS_CONSOLE_INTERNAL_PREFIX}x/tenants`,
      "/internal/opsx",
      "/",
    ]) {
      expect(isOpsConsoleInternalPath(other), other).toBe(false);
    }
  });

  it("recognizes the public prefix and its descendants, and nothing else", () => {
    for (const inside of [
      OPS_CONSOLE_PUBLIC_PREFIX,
      `${OPS_CONSOLE_PUBLIC_PREFIX}/login`,
      `${OPS_CONSOLE_PUBLIC_PREFIX}/tenants/new`,
      OPS_CONSOLE_INTERNAL_PREFIX,
    ]) {
      expect(isOpsConsolePublicPath(inside), inside).toBe(true);
    }
    // Sibling prefixes must NOT be treated as console paths: rewriting one would 404 a path
    // that could later become a real route, and it would put a middleware-rewrite header on a
    // response that should not have one.
    for (const outside of ["/internal/opsx", "/internal/ops-x", "/internal/op", "/internal", "/", "/api/internal/ops/tenants"]) {
      expect(isOpsConsolePublicPath(outside), outside).toBe(false);
    }
  });

  /**
   * QA round 5, Defect 2. `decodeOpsPathnameOnce` is what lets `middleware.ts` recognize an
   * escaped spelling of the internal prefix, which the router itself decodes before matching —
   * so without it those spellings reached the real console route and answered from a different
   * (and gate-dependent) code path.
   */
  describe("decodeOpsPathnameOnce", () => {
    it("decodes an escaped spelling of the internal prefix into the recognizable form", () => {
      const escapedSegment = `/internal/ops/nb%2Dc%2D${OPS_CONSOLE_INTERNAL_PREFIX.split("-").pop()}/tenants`;
      expect(isOpsConsoleInternalPath(escapedSegment)).toBe(false);
      expect(isOpsConsoleInternalPath(decodeOpsPathnameOnce(escapedSegment))).toBe(true);
      // An escape *outside* the secret segment dodges the raw check just as effectively.
      const escapedElsewhere = `/internal/o%70s/${OPS_CONSOLE_INTERNAL_PREFIX.split("/").pop()}/tenants`;
      expect(isOpsConsoleInternalPath(escapedElsewhere)).toBe(false);
      expect(isOpsConsoleInternalPath(decodeOpsPathnameOnce(escapedElsewhere))).toBe(true);
    });

    it("leaves an unescaped pathname untouched", () => {
      for (const p of ["/", "/internal/ops/tenants", OPS_CONSOLE_INTERNAL_PREFIX, "/login"]) {
        expect(decodeOpsPathnameOnce(p)).toBe(p);
      }
    });

    it("decodes exactly once, so a double-escaped spelling is not folded in", () => {
      // The router decodes once too, so a double-escaped path is a path that matches no route
      // and must be left to 404 like any other, not treated as the internal prefix.
      const doubled = "/internal/ops/nb%252Dc%252D4f21c8a7e3d9b605/tenants";
      expect(isOpsConsoleInternalPath(decodeOpsPathnameOnce(doubled))).toBe(false);
    });

    it("returns a malformed escape sequence unchanged instead of throwing", () => {
      // `decodeURIComponent` throws on these; middleware must not, or the console's only
      // routing mechanism would fail on a hostile URL.
      for (const p of ["/internal/ops/%zz", "/internal/ops/%", "/internal/ops/%E0%A4%A"]) {
        expect(decodeOpsPathnameOnce(p)).toBe(p);
      }
    });
  });
});

/**
 * **The structural invariant the whole page-surface fix now rests on** (NFR-11, page-surface
 * Defect 1): *nothing* in this app is routable at `/internal/ops/**` except beneath the
 * internal prefix.
 *
 * That, and not any pattern matching, is what makes a denied request indistinguishable from a
 * nonexistent path: middleware does nothing on a denial, so Next resolves the requested path
 * against the route tree, finds no route, and answers with the one prerendered not-found entry
 * every other missing path in the app gets. The property survives a matcher that misses a
 * request shape, a middleware bundle that fails to build, and the middleware being deleted
 * outright.
 *
 * Adding `app/internal/ops/<anything>/page.tsx` outside the internal prefix — the single
 * change that would silently reopen the leak, because that path would then render (or gate,
 * distinguishably) instead of 404ing — fails this test.
 */
describe("route tree: /internal/ops must have no routes of its own", () => {
  const ROUTE_FILE = /^(page|route|default)\.(t|j)sx?$/;

  /** @returns Every routable file under `dir`, as paths relative to `APP_DIR`. */
  function routeFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...routeFiles(full));
      else if (ROUTE_FILE.test(entry.name)) found.push(path.relative(APP_DIR, full).split(path.sep).join("/"));
    }
    return found;
  }

  it("keeps every console route file beneath the internal prefix", () => {
    const outside = routeFiles(PUBLIC_DIR).filter((f) => !f.startsWith(`internal/ops/${INTERNAL_SEGMENT}/`));
    expect(outside).toEqual([]);
  });

  it("has the internal prefix folder the constant names, with the console inside it", () => {
    const internalDir = path.join(PUBLIC_DIR, INTERNAL_SEGMENT);
    expect(fs.existsSync(internalDir)).toBe(true);
    // A rename that left the constant behind would take the console offline for every
    // operator (all requests would be rewritten to a path that no longer exists).
    const inside = routeFiles(internalDir);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside).toContain(`internal/ops/${INTERNAL_SEGMENT}/login/page.tsx`);
  });

  it("leaves no other route in the app addressable under the public prefix", () => {
    // A route group (`(x)`) or a catch-all elsewhere in the tree could in principle serve
    // `/internal/ops/**` from outside `app/internal/ops` — scan the whole app for any route
    // file whose folder chain, with route groups stripped, lands under the public prefix.
    const stripGroups = (p: string) =>
      "/" +
      p
        .split("/")
        .slice(0, -1)
        .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")")))
        .join("/");
    const offenders = routeFiles(APP_DIR).filter((f) => {
      const url = stripGroups(f);
      return (
        (url === OPS_CONSOLE_PUBLIC_PREFIX || url.startsWith(OPS_CONSOLE_PUBLIC_PREFIX + "/")) &&
        !url.startsWith(OPS_CONSOLE_INTERNAL_PREFIX)
      );
    });
    expect(offenders).toEqual([]);
  });
});
