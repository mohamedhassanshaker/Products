# ADR-0007 — shadcn/ui + Tailwind with runtime CSS-variable tokens

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Product owner (UI library selection), architecture

## Context

Phase E of this project's delivery process makes theming a **mandatory in-product module**, not a build-time configuration file. The requirement is specific and unusually strict:

- Everything themable is driven by **runtime** design tokens. "Changing a token repaints the whole app — no per-component overrides, no rebuild, no redeploy."
- An authorised user controls brand colours, semantic colours, logos, favicon, app title, typography, corner radius, spacing density, shadow depth, sidebar style, light/dark/system mode, and LTR/RTL direction.
- **Skins** are named, saveable presets, exportable and importable as JSON.
- Live preview with explicit Save / Reset, never a half-applied state.
- Resolution order: **user preference → tenant/organisation theme → system default**, with per-tenant branding that must never bleed across tenants.
- WCAG 2.1 AA contrast is **validated before save**, with a one-click restore.
- Enforcement: "any component that hardcodes a color, radius, spacing, or font instead of consuming a token fails review."

Alongside this, the backoffice is 14 screens of dense tables, filters, wizards, matrices and editors — B9's 7×8 permission matrix, B6's graph explorer, B3's 10-step wizard — so component depth matters too. And B10 tab 5 plus the Arabic parity requirement mean RTL and i18n must be in the base components, not retrofitted.

This combination is the deciding constraint: **the theming requirement is architectural, and it rules out any library that themes through a JavaScript object rather than CSS custom properties.**

## Options considered

### A. shadcn/ui + Tailwind — **chosen**

Components are copied into the repository and styled through CSS custom properties.

- **For:** Tokens *are* CSS variables, so runtime repaint is native — set `--primary` on `:root` and the app changes with no rebuild, which is precisely Phase E's requirement. Per-tenant branding is a stylesheet of variable values injected at load. Radix primitives underneath supply WCAG 2.1 AA keyboard/ARIA behaviour and RTL support. Tailwind's arbitrary-value syntax can be lint-banned, which turns "no hardcoded colours" from a review convention into a mechanical check. No runtime CSS-in-JS cost.
- **Against:** The component code is yours to own and maintain — there is no upstream to upgrade from. No built-in heavy data grid, so B1's conversation explorer and B9's matrix need TanStack Table assembled on top.

### B. Material UI

- **For:** Largest ready-made component set; mature data grid; a theme provider that does support runtime overrides.
- **Against:** Themes are JavaScript objects consumed through React context, so a token change re-renders the tree rather than repainting via CSS — workable but fighting the grain of Phase E's "repaints the whole app" requirement, and awkward for injecting per-tenant CSS at load. Heavy bundle. A strongly opinionated Material identity to override for government branding. Rejected on the theming mechanism.

### C. Ant Design

- **For:** The best enterprise tables, forms and filters available — closest to the backoffice screens out of the box.
- **Against:** CSS-in-JS theming with the same mechanism problem as MUI, large bundle, and a distinctive visual identity that white-labelling would have to fight. Rejected.

### D. Tailwind only, custom component library

- **For:** Total control, lightest output, tokens by construction.
- **Against:** Every accessible primitive — dialog, combobox, tabs, tooltip, popover, date picker — built from scratch before any feature code. Weeks of work reimplementing what Radix already provides correctly. Rejected on schedule.

## Decision

**shadcn/ui components over Radix primitives, styled with Tailwind, with every themable value expressed as a runtime CSS custom property.**

### The token contract

Three layers, and feature code may only touch the third:

```
1. primitives    --shj3-green-600: #1F6F5C;        raw values. never used in features.
2. semantic      --primary: var(--shj3-green-600);  role-based. what a theme overrides.
                 --destructive, --success, --warning, --muted, --border, --ring …
3. component     --button-radius: var(--radius);    consumed by components.
```

- Feature code uses **semantic and component tokens only**. Referencing a primitive directly, or writing a literal value, fails review.
- Tailwind's theme is configured to emit `var(--token)` rather than static values, so `bg-primary` compiles to `background-color: var(--primary)`. This is what makes an entire Tailwind-styled app repaintable at runtime.
- **Arbitrary values are lint-banned.** `bg-[#1F6F5C]`, `p-[13px]`, `rounded-[7px]` fail. This is the mechanical form of Phase E's enforcement rule, and without it that rule is unenforceable in practice.
- Spacing, typography, radius, shadow, z-index and breakpoints are tokens too — not only colour. Phase E's *spacing density* and *corner radius* controls require it.

### Theme resolution

Resolved server-side on first paint, in Phase E's mandated order:

```
user preference  →  tenant theme  →  system default
```

The resolved token set is inlined into the document `<head>` as a `<style>` block on the server. Two reasons this is not negotiable: it eliminates a flash of default theme, and it means per-tenant branding is *never* fetched client-side, so a tenant's brand cannot leak into another tenant's page through a cache. Tenant theme rows live in the tenant's own SQL schema (ADR-0002), so isolation is inherited from the tenancy model rather than re-implemented.

### Skins

A skin is a JSON document of semantic token values plus asset references, versioned by a schema. Default and dark skins ship; users may duplicate, edit, export and import. Import is validated against the schema **and** the contrast rules before it is allowed to apply — an imported skin is untrusted input.

### Accessibility gate

Contrast is computed for every foreground/background token pair at save time and blocks the save if a pair falls below WCAG 2.1 AA. Phase E says to warn; this decision makes it **block** for text pairs and warn for non-text, because a government service that ships an unreadable tenant theme has a legal exposure, not a cosmetic one. One-click restore to default is always available.

### RTL and i18n

Logical CSS properties throughout — `padding-inline-start`, never `padding-left`; `margin-inline`, never `margin-left`. `dir` is set from the locale, tied to language selection per Phase E. Physical direction properties are lint-banned alongside arbitrary values, because RTL retrofits are what happen when they are not.

## Consequences

### Positive

- Phase E's hardest requirement — runtime repaint with no rebuild — is native to the mechanism rather than worked around.
- Per-tenant white-labelling is a set of CSS variable values, so it costs one server-rendered style block and no client fetch.
- "No hardcoded colours" is enforced by a linter, not by reviewer attention, which is the only way a rule like that survives contact with a 17-screen build.
- Radix gives correct keyboard, focus and ARIA behaviour and RTL support in the primitives, so WCAG 2.1 AA starts from a working baseline.
- Component code lives in the repo, so the wireframe's specific patterns — the sub-tab bar, badge vocabulary, summary strip, mono sub-line — can be first-class components rather than approximations of someone else's library.

### Negative

- Component maintenance is now the team's, with no upstream upgrade path.
- No data grid out of the box; TanStack Table must be wrapped once, well, and reused across all 14 screens rather than assembled per screen.
- Three token layers is real discipline, and the temptation to reach for a primitive or a literal will recur. The linter is the answer; if it is weakened, this ADR is void in practice.
- Server-rendered theme injection couples the theming module to the rendering path, so a theming bug can affect first paint on every page.

### Follow-up

- `design-system.md` documents the full token list, the two shipped skins, and the JSON skin schema.
- The Tailwind config, the arbitrary-value lint rule and the logical-property lint rule land in the **first** commit. Retrofitting them after feature code exists means fixing hundreds of violations.
