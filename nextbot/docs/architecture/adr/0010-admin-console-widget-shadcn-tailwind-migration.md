# ADR-0010 — UI stack migration: Chakra UI → shadcn/ui + Tailwind CSS v4 (all apps)

**Status:** Accepted · 2026-08-18
**Context refs:** ADR-0002 §4.2a (superseded by this record), FR-ADM-07, NFR-7, NFR-8
**Supersedes:** ADR-0002 §4.2a, for all three UI-bearing apps (`apps/web`, `packages/ui`,
`apps/widget-embed`) — not the Admin Console alone.
**Decision owner:** User (explicit decision, 2026-08-17), specifying a concrete shadcn/ui
preset (`ui.shadcn.com/create?preset=b5rR41Mtnc`) and requesting the Platform Branding
screen drive the resulting design system.

## 1. Context

ADR-0002 §4.2a chose Chakra UI over the architecture guide's own Tailwind CSS + shadcn/ui
default, on the stated rationale that Chakra's runtime `extendTheme()` theming layer was "a
materially better fit for FR-ADM-07's per-tenant brand profile" than a Tailwind config
compiled at build time.

Two things about that original rationale turned out not to hold, discovered during this
migration's own investigation phase:

1. **The dependency actually installed was never what §4.2a described.** Every `package.json`
   in the repo pinned `@chakra-ui/react@^2.10.4` — Emotion-based CSS-in-JS, no Ark UI
   anywhere in the dependency tree — not "Chakra UI v3, Ark UI primitives underneath" as
   §4.2a states. This was a factual error in the original ADR, not a later drift.
2. **The runtime-theming advantage §4.2a was justified on was never actually implemented
   for the Admin Console.** `AdminShell.tsx` applied a tenant's `branding_config.primaryColor`
   /`secondaryColor` as raw inline hex strings passed directly to Chakra style props
   (`bg={branding.primaryColor}`), computed server-side per request — never via
   `extendTheme()`, never via a re-mounted `ChakraProvider`, never via CSS variable
   injection. The `brand.*` token slot `packages/ui/src/theme.ts` reserved in a doc comment
   for exactly this purpose was dead — nothing ever read it for the Admin Console's
   branding. (The embeddable widget's `createWidgetTheme()` *did* build a genuine
   per-request `extendTheme()` instance correctly — it just wasn't the surface §4.2a's
   justification was actually about, and it wasn't what the user asked to change.)

So the "materially better fit" §4.2a claimed as Chakra's deciding advantage was, for the
surface it was actually justified for, not real. Reversing it costs nothing that
theming rationale promised, because that promise was never delivered.

## 2. Decision

**Chakra UI is removed from all three UI-bearing apps and replaced with shadcn/ui +
Tailwind CSS v4, using Base UI as the underlying accessible-primitive layer**, per the
user's specified preset:

| Token | Value |
|---|---|
| Style | Lyra |
| Base Color | Stone |
| Theme / accent color | Orange |
| Chart Color | Orange |
| Radius | None |
| Heading font | Oxanium |
| Body font | Outfit |
| Icon Library | Hugeicons |

Applied to:
- **`apps/web`** (Admin Console — all five portals' Control Plane surface)
- **`packages/ui`** (the shared component package — `theme.ts`/`AppProviders.tsx` deleted;
  `AccessDeniedState`/`StatusBadge` rebuilt on shadcn primitives with unchanged public prop
  surfaces; `packages/ui/src/components/ui/*` is now the shared shadcn primitive home,
  hand-authored on `@base-ui/react` — see §3)
- **`apps/widget-embed`** (the embeddable customer widget — its own separate Tailwind
  build/theme instance, matching its existing scoped-CSS isolation requirement so
  host-page styles still never leak either direction)

### 2.1 New per-tenant branding mechanism (the thing §4.2a's rationale was actually about)

Since Chakra's theming layer was never real for the Admin Console, this migration is the
**first actual implementation** of runtime per-tenant branding for that surface, not a
port of an existing mechanism:

- Only `--primary` (+ a computed `--primary-foreground` via the existing WCAG
  contrast-checker, reused rather than reimplemented) is tenant-overridable from
  `primaryColor`. `secondaryColor` maps to a narrowly-scoped `--brand-sidebar` token —
  deliberately not reusing shadcn's own `--secondary` token, so a tenant's brand color can
  never silently override NextBot's own neutral/semantic UI colors.
- Both apps inject these as a server/build-time-computed `<style>` block ahead of the
  static `globals.css` cascade (`apps/web/src/lib/build-brand-style-tag.ts`, and the
  widget's equivalent in `apps/widget-embed/src/widget/theme.ts`) — SSR'd for the Admin
  Console (no flash-of-wrong-color, no client `useEffect`), and computed at session-init
  for the widget's iframe document.
- This is a genuine improvement over both the old (fake) Admin Console rationale and the
  old (real but Chakra-specific) widget mechanism: CSS custom properties need no
  theme-object re-render, only a variable override, and the same mechanism now works
  identically across both apps.

### 2.2 Deviation within this decision — Base UI instead of Radix

The shadcn CLI, for the exact preset code supplied, resolves its underlying accessible
primitive layer to **`@base-ui/react`** (the MUI team's headless primitive library), not
Radix UI as most shadcn documentation and this migration's own initial plan assumed.
Confirmed via `components.json`'s own `"base-lyra"` style name and the CLI's actual
generated imports — not a substitution made during implementation. Base UI is MIT-licensed,
actively maintained, and was verified during this migration (live keyboard/ARIA testing on
`Tooltip`, `Switch`, `Select`, `Dialog`, focus-trap behavior) to provide accessibility
parity with what Radix would have. No action needed; noted here so a future reader isn't
confused by `@base-ui/react` appearing instead of `@radix-ui/*` in the dependency tree.

### 2.3 Deviation within this decision — hand-authored primitives, no live shadcn registry access

The shadcn CLI's own component registry was not reachable from this build environment for
most of this migration's dispatches. Every primitive under `packages/ui/src/components/ui/`
(`button`, `input`, `select`, `dialog`, `table`, `form`, etc.) was hand-authored directly on
`@base-ui/react`, matching the same ergonomics and file conventions the CLI would have
produced, rather than pulled via `npx shadcn add`. Functionally equivalent; flagged as a
process deviation, not an architectural one — if registry access becomes available, these
can be reconciled against official CLI output at a later date without a behavior change.

## 3. Consequences

- **RTL (NFR-8)**: Tailwind's logical utilities (`ps-*`/`pe-*`/`ms-*`/`me-*`/`start-*`/
  `end-*`) replace Chakra's logical style props one-for-one — no regression, re-verified
  live across the migration's QA passes.
- **Accessibility (NFR-7)**: re-verified screen-by-screen via live axe-core scans across
  every migrated screen and the widget's every state, not assumed "fine because Base UI is
  accessible by default" — this class of assumption specifically caused two real,
  QA-caught defects during the migration (a Chakra shim's unscoped global focus-visible
  rule defeating the new design-system ring almost everywhere it was still mounted; a
  shared `Select` primitive not resolving labels for programmatically-preset values).
  Both fixed and re-verified before this ADR was written.
- **Bundle cost**: Chakra's Emotion-based runtime CSS-in-JS is gone from all three apps;
  Tailwind's static extraction is the new cost model. Net improvement for the concern
  ADR-0002 §4.2a accepted as a trade-off in Chakra's favor.
- **Icon library**: Hugeicons is now the icon package across all three apps — not
  abstracted by shadcn (a direct-import-per-component convention), so a future icon-library
  swap would touch every consuming component, same caveat that applied when Chakra was
  originally chosen for a different reason.
- **Widget isolation requirement unchanged**: the widget still ships its own scoped
  Tailwind build inside its iframe document, exactly as it shipped its own scoped Chakra
  theme before — no change to the host-page-never-leaks-either-direction guarantee.

## 4. What did not change

- The underlying data model (`tenant.branding_config`, `white_label_enabled`) — no schema
  changes were needed; both fields already existed as plain hex/URL/string values.
- The WCAG contrast-checking algorithm — reused from `packages/modules/tenancy`, not
  reimplemented (the widget's copy is an intentionally duplicated, verified-identical
  version, to avoid pulling Node-only dependencies into the browser bundle).
- Multi-tenant isolation, RBAC, credential vaulting, audit logging, and every other
  architectural decision recorded in ADR-0001 through ADR-0009 — this ADR is scoped
  strictly to the UI component/styling layer.
