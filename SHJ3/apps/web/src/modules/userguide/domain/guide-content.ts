/**
 * `modules/userguide/domain` — the pure content shape every guide entry conforms to.
 *
 * ## Why static content files, not a database-backed module (a flagged, reasoned choice)
 *
 * Every other feature module in this codebase (`agents`, `tools`, `channels`, ...) follows
 * the domain/ports/adapters/application layering because its data is genuinely mutated by
 * end users at runtime, through a real persistence boundary that needs swapping-out
 * discipline. A user guide entry is not that: nobody edits "how to invite a user" from
 * inside the running app, the same way nobody edits `docs/design-system.md` from inside the
 * app either. Phase F's own spec allows either call ("static MDX/JSON... OR data-backed"),
 * explicitly asking for the reasoning to be stated rather than defaulted silently — this is
 * that statement.
 *
 * The content that *does* need a real seam — the drift-detection gate proving every real
 * route has a corresponding entry (`scripts/gates/user-guide-coverage.mjs`), and this
 * module's own pure lookup functions (`application/get-guide-entry.ts`,
 * `application/get-guide-nav.ts`) — is exactly as real and tested as any other module's
 * application layer. What's static is the *prose*, not the mechanism that serves it. A
 * later wave that genuinely needs staff to edit guide copy from inside the app (a CMS-like
 * requirement nothing in this brief asks for) would swap `content/` for a `ports/`-shaped
 * repository without touching `HelpGuideShell`, `application/`, or the routes at all — the
 * same swap-the-adapter promise every other module makes, just not yet exercised because
 * nothing here needs it today.
 *
 * Versioning ("tied to the app version/commit", per CLAUDE.md's Phase F spec): each entry
 * carries `lastVerifiedAgainst`, a short human-written note naming the real route/component
 * files this entry's prose was checked against and when — the same convention this repo
 * already uses informally in `tasks/todo.md`'s dated Review entries, made a first-class,
 * per-entry field here instead. There is no CI (ADR-0008) to mechanically fail a stale
 * entry, so this field is a discipline aid for the next author, not an enforced gate — the
 * one enforced gate this module ships is coverage (an entry exists at all), not freshness.
 */

/** One named subsection of a page's real feature surface — a tab, a panel, a control group. */
export interface GuideSection {
  readonly heading: string;
  readonly body: string;
}

/** A numbered walkthrough for one concrete task a non-technical user would come here to do. */
export interface GuideHowTo {
  readonly title: string;
  readonly steps: readonly string[];
}

/** The full prose content for one guide entry, in one locale. */
export interface GuidePageContent {
  readonly title: string;
  readonly purpose: string;
  readonly featureWalkthrough: readonly GuideSection[];
  readonly howTo: readonly GuideHowTo[];
  /** Plain-language notes on which roles/permissions change what the reader sees — cross-referenced against the real `requirePermission()` calls on the page this entry documents. */
  readonly permissionsNote: string;
  /** See the module doc comment's "Versioning" paragraph. Free text, e.g. `"tools/page.tsx, tools-screen.tsx — 2026-09-10"`. */
  readonly lastVerifiedAgainst: string;
}

export type GuideLocale = "en" | "ar";
