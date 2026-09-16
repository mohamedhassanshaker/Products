import { describe, it, expect } from "vitest";
import { GUIDE_REGISTRY } from "../domain/guide-registry.js";
import { CONTENT_BY_SLUG } from "../content/index.js";
import { getGuideEntry } from "./get-guide-entry.js";
import { getGuideNav } from "./get-guide-nav.js";

describe("getGuideEntry", () => {
  it("resolves a real registry slug in both locales", () => {
    const en = getGuideEntry("iam", "en");
    const ar = getGuideEntry("iam", "ar");
    expect(en?.content.title).toBe("Users, teams & roles");
    expect(ar?.content.title).not.toBe(en?.content.title);
    expect(en?.registry.coversRoutes).toContain("/iam");
  });

  it("returns null for an unknown slug", () => {
    expect(getGuideEntry("not-a-real-page", "en")).toBeNull();
  });

  it("every GUIDE_REGISTRY entry has real content in both locales — the direct sibling to the coverage gate's route-side check", () => {
    for (const entry of GUIDE_REGISTRY) {
      const localized = CONTENT_BY_SLUG[entry.slug];
      expect(localized, `missing content/index.ts entry for slug "${entry.slug}"`).toBeDefined();
      expect(localized?.en.title.length).toBeGreaterThan(0);
      expect(localized?.ar.title.length).toBeGreaterThan(0);
      expect(localized?.en.howTo.length).toBeGreaterThan(0);
      expect(localized?.en.featureWalkthrough.length).toBeGreaterThan(0);
    }
  });

  it("CONTENT_BY_SLUG has no orphaned entry absent from the registry", () => {
    const registrySlugs = new Set(GUIDE_REGISTRY.map((entry) => entry.slug));
    for (const slug of Object.keys(CONTENT_BY_SLUG)) {
      expect(registrySlugs.has(slug), `content/index.ts has "${slug}" with no registry entry`).toBe(
        true,
      );
    }
  });
});

describe("getGuideNav", () => {
  it("groups and orders items per GUIDE_REGISTRY, using localized titles as labels", () => {
    const nav = getGuideNav("en");
    const adminGroup = nav.find((g) => g.group === "admin");
    expect(adminGroup).toBeDefined();
    expect(adminGroup?.items[0]).toEqual({ slug: "command-centre", label: "Command centre" });
    // "admin" (9 real backoffice screens) must appear before "settings", "citizen" and
    // "platform" (the platform operator's own console, platform-admin wave, 2026-09-13).
    expect(nav.map((g) => g.group)).toEqual(["admin", "settings", "citizen", "platform"]);
  });

  it("filters by query against label or slug, case-insensitively", () => {
    const nav = getGuideNav("en", "IAM");
    const allSlugs = nav.flatMap((g) => g.items.map((i) => i.slug));
    expect(allSlugs).toEqual(["iam"]);
  });

  it("an unmatched query returns no items at all, in either locale", () => {
    expect(getGuideNav("en", "zzz-nothing-matches").flatMap((g) => g.items)).toHaveLength(0);
    expect(getGuideNav("ar", "zzz-nothing-matches").flatMap((g) => g.items)).toHaveLength(0);
  });
});
