/**
 * `GUIDE_REGISTRY` — the single source of truth mapping every real, shipped route in this
 * app to its guide entry. Three real consumers read this same array, never a copy:
 *
 *   1. `HelpGuideShell`'s side menu (via `application/get-guide-nav.ts`) — "built from the
 *      same nav model as `AppShell`" (design-system.md §5.5 #56).
 *   2. `apps/web/src/app/[locale]/help/[...slug]/page.tsx` — resolves a deep link to content.
 *   3. `scripts/gates/user-guide-coverage.mjs` — the drift-detection gate. It walks the real
 *      `app/[locale]/**\/page.tsx` tree independently and cross-checks every real route
 *      appears in some entry's `coversRoutes`, and every `coversRoutes` entry still points
 *      at a real page.tsx — bidirectional, so a stale entry (route deleted, guide forgotten)
 *      is caught exactly as loudly as a missing one (route added, guide forgotten).
 *
 * ## Why some entries cover more than one route
 *
 * `agents/new/page.tsx` and `agents/[id]/edit/page.tsx` render the same real `Wizard`
 * organism against the same ten steps (B-3's review entry) — two URLs, one screen a
 * non-technical reader needs exactly one walkthrough for. Modelling that as two guide
 * entries would either duplicate the same prose twice (drifting the moment one copy is
 * edited and the other isn't — this file's own sibling `tasks/lessons.md` entries are full
 * of exactly that failure shape elsewhere in this codebase) or force an arbitrary pick of
 * which URL "owns" the content. One entry, two covered routes, is the honest model.
 *
 * ## `moduleGroup`
 *
 * Mirrors `(backoffice)/layout.tsx`'s own `AppShellNavItem.group` values (`"assistant"` /
 * `"admin"`) plus three groups that file doesn't need: `"settings"` (the one real staff route
 * outside `(backoffice)` — `/settings/appearance`), `"citizen"` (the widget's own lighter
 * entry — see that entry's own comment for why the whole module is public rather than
 * splitting into a gated/ungated pair of route trees), and `"platform"` (the platform
 * operator's own `(platform-admin)` console, Part E of the platform-admin wave, 2026-09-13 —
 * a distinct persona from `(backoffice)`'s own tenant-admin nav, so it gets its own guide
 * group rather than being folded into `"admin"`).
 */

export type GuideModuleGroup = "admin" | "settings" | "citizen" | "platform";

export interface GuideRegistryEntry {
  /** Stable identity and the deep-link path segment(s) under `/help/` — e.g. `"agents/wizard"` renders at `/{locale}/help/agents/wizard`. */
  readonly slug: string;
  /** Real app routes (locale-relative, dynamic segments kept literal) this one entry documents. Every one of these must resolve to a real `page.tsx` — the coverage gate enforces it both ways. */
  readonly coversRoutes: readonly string[];
  readonly moduleGroup: GuideModuleGroup;
  /** Render order within its group — matches the real sidebar's own top-to-bottom order where one exists. */
  readonly order: number;
  /** Basename under `apps/web/public/user-guide/screenshots/` (no extension; `.png` is added by both the capture script and the renderer). */
  readonly screenshotBaseName: string;
}

export const GUIDE_REGISTRY: readonly GuideRegistryEntry[] = [
  {
    slug: "command-centre",
    coversRoutes: ["/command-centre"],
    moduleGroup: "admin",
    order: 1,
    screenshotBaseName: "command-centre",
  },
  {
    slug: "agents",
    coversRoutes: ["/agents"],
    moduleGroup: "admin",
    order: 2,
    screenshotBaseName: "agents",
  },
  {
    slug: "agents/wizard",
    coversRoutes: ["/agents/new", "/agents/[id]/edit"],
    moduleGroup: "admin",
    order: 3,
    screenshotBaseName: "agents-wizard",
  },
  {
    slug: "agents/new-with-ai",
    coversRoutes: ["/agents/new-with-ai"],
    moduleGroup: "admin",
    order: 4,
    screenshotBaseName: "agents-new-with-ai",
  },
  {
    slug: "tools",
    coversRoutes: ["/tools"],
    moduleGroup: "admin",
    order: 5,
    screenshotBaseName: "tools",
  },
  {
    slug: "orchestrator",
    coversRoutes: ["/orchestrator"],
    moduleGroup: "admin",
    order: 6,
    screenshotBaseName: "orchestrator",
  },
  {
    slug: "knowledge",
    coversRoutes: ["/knowledge"],
    moduleGroup: "admin",
    order: 7,
    screenshotBaseName: "knowledge",
  },
  {
    slug: "iam",
    coversRoutes: ["/iam"],
    moduleGroup: "admin",
    order: 8,
    screenshotBaseName: "iam",
  },
  {
    slug: "channels",
    coversRoutes: ["/channels"],
    moduleGroup: "admin",
    order: 9,
    screenshotBaseName: "channels",
  },
  {
    slug: "escalations",
    coversRoutes: ["/escalations"],
    moduleGroup: "admin",
    order: 10,
    screenshotBaseName: "escalations",
  },
  {
    slug: "identity",
    coversRoutes: ["/identity"],
    moduleGroup: "admin",
    order: 11,
    screenshotBaseName: "identity",
  },
  {
    slug: "evaluation",
    coversRoutes: ["/evaluation"],
    moduleGroup: "admin",
    order: 12,
    screenshotBaseName: "evaluation",
  },
  {
    slug: "governance",
    coversRoutes: ["/governance"],
    moduleGroup: "admin",
    order: 13,
    screenshotBaseName: "governance",
  },
  {
    slug: "guardrails",
    coversRoutes: ["/guardrails"],
    moduleGroup: "admin",
    order: 14,
    screenshotBaseName: "guardrails",
  },
  {
    slug: "ai-settings",
    coversRoutes: ["/ai-settings"],
    moduleGroup: "admin",
    order: 15,
    screenshotBaseName: "ai-settings",
  },
  {
    slug: "settings/appearance",
    coversRoutes: ["/settings/appearance"],
    moduleGroup: "settings",
    order: 1,
    screenshotBaseName: "settings-appearance",
  },
  {
    slug: "settings/appearance/reset",
    coversRoutes: ["/settings/appearance/reset"],
    moduleGroup: "settings",
    order: 2,
    screenshotBaseName: "settings-appearance-reset",
  },
  {
    slug: "sign-in",
    coversRoutes: ["/sign-in"],
    moduleGroup: "settings",
    order: 3,
    screenshotBaseName: "sign-in",
  },
  {
    slug: "citizen-widget",
    coversRoutes: ["/widget"],
    moduleGroup: "citizen",
    order: 1,
    screenshotBaseName: "citizen-widget",
  },
  {
    slug: "tenants",
    coversRoutes: ["/tenants"],
    moduleGroup: "platform",
    order: 1,
    screenshotBaseName: "tenants",
  },
  {
    slug: "branding",
    coversRoutes: ["/branding"],
    moduleGroup: "platform",
    order: 2,
    screenshotBaseName: "branding",
  },
  {
    slug: "branding/reset",
    coversRoutes: ["/branding/reset"],
    moduleGroup: "platform",
    order: 3,
    screenshotBaseName: "branding-reset",
  },
];

/**
 * Routes deliberately outside this registry's scope, so the coverage gate does not treat
 * them as missing entries. Both are real files (`next build` needs them to exist), neither
 * is a real product screen a user guide entry would describe:
 *
 *  - `[locale]/page.tsx` — the root placeholder (its own doc comment: "exists so `next build`
 *    produces a real route and the app boots"); real content lives at the routes above.
 *  - `[locale]/help/**` — the guide module documenting *itself* would be a recursion with no
 *    real content, the same reason `docs/design-system.md` has no entry describing itself.
 */
export const GUIDE_COVERAGE_EXEMPT_ROUTES: readonly string[] = ["/", "/help"];
