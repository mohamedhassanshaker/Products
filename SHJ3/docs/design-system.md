# SHJ3 — Design System & Runtime Theming Specification

| | |
|---|---|
| **Status** | Normative. Binding on all frontend code in `shj3-web`. |
| **Governs** | Design tokens, component library, theming module, skin format, accessibility, RTL |
| **Derives from** | [ADR-0007](./adr/0007-design-system-and-runtime-theming.md), [`architecture.md` §9](./architecture.md), [ADR-0002](./adr/0002-schema-per-tenant-isolation.md) |
| **Source of component vocabulary** | `SHJ3-wireframes-guide.md` §3.1, §7.2, §7.3, §7.4 |
| **Stack** | shadcn/ui over Radix, Tailwind, Next.js App Router, `next-intl` |

---

# 1. Purpose & scope

## 1.1 What this document governs

This is the contract between the design system and every screen in SHJ3 — the 3 assistant screens (A1–A3) and the 14 backoffice screens (B1–B14). It defines:

- the three-layer token architecture and the complete token catalogue (§3, §4)
- the component library — atoms, molecules, organisms — with variants, states, tokens consumed, a11y and RTL behaviour (§5)
- the status vocabulary and its colour-independent encoding (§6)
- the skin JSON schema and the two shipped skins (§7, §8)
- the in-product **Settings → Appearance** module required by Phase E (§9)
- the WCAG 2.1 AA baseline and its mechanical gates (§10)
- internationalisation and RTL rules (§11)
- the lint, test and CI checks that make all of the above enforceable (§12)

It does **not** govern: information architecture (that is the wireframe guide), API contracts (`api.md`), or content/copy. Where this document and ADR-0007 could be read as disagreeing, ADR-0007 wins and this document is wrong and must be corrected.

## 1.3 Requirement traceability

Every requirement in `requirements.md` that this document is responsible for satisfying, and where it is satisfied. Per Phase D, a requirement with no passing test is an incomplete requirement — the test column names the check in §12 that proves it.

| Requirement | Satisfied in | Proven by |
|---|---|---|
| `FR-THEME-01` — module at Settings → Appearance, permission-gated | §9.1, §9.3 | E2E: `appearance.spec` |
| `FR-THEME-02` — three token layers, feature code touches 2 and 3 only | §3.1–§3.3, §4 | Lint §12.1, §12.3 |
| `FR-THEME-03` — runtime repaint, no rebuild | §3.4, §3.5 | Token sweep §12.5 |
| `FR-THEME-04` — brand + semantic colours, logos, favicon, app title (11 values) | §9.1 Brand/Semantic, §7.2 `assets` | E2E + §12.4 |
| `FR-THEME-05` — font family, base size, scale, weight | §4.6, §9.1 Typography | E2E; `fontStackRef` enum rejects a stack with no fallback (§7.2) |
| `FR-THEME-06` — radius, density, shadow depth, sidebar style | §4.7, §4.8, §9.1 Layout | §12.5 (compact permutation) |
| `FR-THEME-07` — light / dark / system | §8, §9.4 | §12.4 (both skins), §12.5 (both skins) |
| `FR-THEME-08` — LTR/RTL tied to language, logical properties | §11.1, §11.2, §11.6 | Lint §12.2; §12.5 (both directions) |
| `FR-THEME-09` — named skins, default + dark ship, duplicate/edit | §7.1, §8 | E2E: `skins.spec` |
| `FR-THEME-10` — export as versioned JSON, exact round-trip | §7.2 | Round-trip property test §12.4 |
| `FR-THEME-11` — import validated against schema **and** contrast; untrusted | §7.4 | Hostile-fixture suite §12.4 |
| `FR-THEME-12` — live preview, explicit Save/Reset, never half-applied | §2 P7, §9.2 | E2E: interrupt-save case |
| `FR-THEME-13` — user → tenant → system resolution | §9.4 | `resolveTheme` unit tests, per-token merge |
| `FR-THEME-14` — resolved server-side, inlined in `<head>`, no client fetch | §9.4 | E2E: no theme request observable; no FOUT |
| `FR-THEME-15` — tenant schema storage, no cross-tenant bleed | §7.1, §9.3, §9.4 | `tenant-isolation.spec` (architecture.md §5) |
| `FR-THEME-16` — AA contrast per pair at save; block text, warn non-text | §10.2, §7.4 stage 5 | §12.4 both suites |
| `FR-THEME-17` — one-click restore, reachable when unreadable | §9.2 rule 5 | E2E against a deliberately unreadable theme |
| `FR-THEME-18` — authority per scope | §9.3 | Server-side permission tests per scope |
| `FR-THEME-19` — build fails on an arbitrary value or physical property | §12.1, §12.2 | The rules are themselves the check |
| `FR-THEME-20` — widget accent resolves through the same tokens | §4.4, §5.5 #50 | §12.5 widget stories |
| `NFR-A11Y-01` — WCAG 2.1 AA everywhere | §10 | `axe` §12.6 step 4 + manual pass §10.6 |
| `NFR-A11Y-02` — keyboard-operable, visible focus | §10.3, §10.4 | Playwright keyboard-only specs |
| `NFR-A11Y-03` — status never colour alone | §6.1, §6.4 | Lint `badge-requires-label` §12.3; greyscale snapshot |
| `NFR-A11Y-04` — contrast validated at save time | §10.2 | §12.4 |
| `NFR-A11Y-05` — `prefers-reduced-motion` honoured | §4.8, §10.5 | §12.5 (motion forced off), story assertions |
| `NFR-A11Y-06` — live regions for dynamic content | §5.4 `SummaryStrip`, §5.5 `ChatThread`/`DataTable` | `axe` + live-region assertions |
| `NFR-A11Y-07` — empty / loading / error / permission-denied everywhere | §5.2, §5.4 `EmptyState` | Story per state per list surface |
| `NFR-A11Y-08` — non-visual equivalent for visualisations | §5.5 #57 `ChartFrame`, #44/#45 list views | `axe` + E2E on the table fallback |
| `NFR-I18N-01` — EN + AR, no hardcoded user-visible string | §11.2, §11.7 | Lint `no-hardcoded-user-string` §12.3; catalogue parity §12.6 step 6 |
| `NFR-I18N-02` — correct RTL via logical properties | §11.1, §11.6 | Lint §12.2; §12.5 RTL permutation |
| `NFR-I18N-03` — translation completeness measured from the catalogue | §11.7 rule 1 | §12.6 step 6 |
| `NFR-I18N-04` — direction bound to locale, one action | §11.2 | `dir` derived server-side; no client toggle exists |
| `NFR-I18N-05` — locale formatting, UTC storage | §11.5 | Formatter unit tests per locale |
| `NFR-I18N-06` — fallback render + counted miss | §11.7 rule 1 | Catalogue parity + miss counter test |
| `NFR-I18N-07` — Arabic retrieval quality as a first-class dimension | §11.7 (out of scope for the UI layer; recorded for traceability) | B13 regression runs |
| `NFR-I18N-08` — locale-specific TTS voice | §5.4 `MessageMetaRow`, §10.5 Language | E2E: `lang` attribute drives voice selection |

## 1.2 The one rule

> **Any component that hardcodes a colour, radius, spacing value or font instead of consuming a token fails review.**

That sentence is Phase E's, and on its own it is aspirational — every project has that rule and every project accumulates `#1F6F5C` in feature code anyway. What makes it real here is that the rule has a **mechanical form**: Tailwind arbitrary values (`bg-[#1F6F5C]`, `p-[13px]`, `rounded-[7px]`) are lint-banned, physical direction properties (`padding-left`, `text-left`, `margin-right`) are lint-banned, and feature code importing a layer-1 primitive is lint-banned (§12). A reviewer does not have to notice a violation; CI refuses the commit.

Corollary, from ADR-0007's Consequences: *"if the linter is weakened, this ADR is void in practice."* Weakening a rule in §12 is a decision that requires a new ADR, not a config edit.

---

# 2. Principles

**P1 — Every themable value is a runtime CSS custom property.**
There is no JavaScript theme object. Setting `--primary` on `:root` repaints the entire application: no rebuild, no redeploy, no React re-render, no per-component override. If a value cannot be expressed as a CSS custom property, it is not themable and must be justified (§4.9 breakpoints is the one such category).

**P2 — Feature code speaks in roles, never in values.**
`bg-primary`, not `bg-green-600`; `text-muted-foreground`, not `text-[#5B6270]`. A role can be re-pointed by a tenant; a value cannot. Layer-1 primitives are invisible to feature code and enforced as such by an import rule.

**P3 — Meaning is never carried by colour alone.**
Every status badge carries a text label as well as a token (§6). This is already the wireframe's commitment (§7.4) and it is also what makes a tenant re-branding `--primary` safe: if green stopped meaning "healthy" the label still says `Healthy`.

**P4 — One well-built organism, reused, beats fourteen assemblies.**
There is exactly one `DataTable`, one `Wizard`, one `SubTabBar`. B1's conversation explorer, B9's user list, B11's transaction log and B14's audit log are configurations of the same table, not four tables. ADR-0007 names this as the cost of choosing shadcn over Ant Design; paying it once is the whole point.

**P5 — RTL and Arabic are properties of the base components.**
Logical properties only. No component may be "made RTL-ready later". B10 tab 5 makes Arabic a first-class locale and B13 measures Arabic parity as a publish gate; a mirrored layout that arrives after the 17 screens are built is a rewrite.

**P6 — Accessibility is computed, not reviewed.**
Contrast for every foreground/background token pair is computed at theme-save time and **blocks** the save for text pairs (ADR-0007 hardens Phase E's "warn" to "block"). Keyboard and ARIA behaviour comes from Radix primitives, so the baseline is inherited rather than hand-rolled — and the three organisms Radix does not cover (permission matrix, graph canvas, flow canvas) get explicit keyboard models in §10.4.

**P7 — Never a half-applied state.**
The Appearance module previews live and commits atomically. A save either writes a complete, validated token set or writes nothing. Reset to default is one click and is always reachable, including from a theme so broken the UI is unreadable (§9.5).

---

# 3. Token architecture

## 3.1 The three layers

ADR-0007 fixes three layers and permits feature code to touch only the upper two. Precisely:

| Layer | Name | Contains | Who may reference it | Themable at runtime |
|---|---|---|---|---|
| **1** | Primitive | Raw values — `--shj3-green-600: #1F6F5C`, `--shj3-space-unit: 4px` | `tokens/primitives.css` and `tokens/semantic.css` only | No — a skin never ships primitives |
| **2** | Semantic | Roles — `--primary`, `--destructive`, `--muted`, `--border`, `--ring` | Feature code, components, Tailwind theme | **Yes — this is what a skin overrides** |
| **3** | Component | Per-component knobs — `--button-radius`, `--sidebar-width`, `--table-row-height` | The owning component, and feature code that legitimately tunes one instance | Yes, but skins set them rarely |

The critical asymmetry: **a skin document (§7) contains layer-2 values and a small allowlisted subset of layer-3 values. It never contains layer-1.** That is what stops an imported skin from redefining `--shj3-green-600` and silently mutating the meaning of every token derived from it.

## 3.2 Naming convention

```
layer 1   --shj3-<family>-<step>          --shj3-green-600, --shj3-sand-100, --shj3-space-4
layer 2   --<role>[-<modifier>]           --primary, --primary-foreground, --muted-foreground,
                                          --success-subtle, --border-strong
layer 3   --<component>-<property>        --button-radius, --badge-padding-inline,
                                          --chat-bubble-max-inline-size
```

Rules:
1. Layer 1 is the **only** layer with the `shj3-` prefix. Seeing `shj3-` in feature code is therefore a visible violation as well as a lint error.
2. `-foreground` always means "text/icon colour that is legible on the same-named background". `--success-foreground` is what you put *on* `--success`.
3. `-subtle` is a tinted surface for the same role; `-strong` is a darkened text-safe variant of the same role. Both exist because a single hue cannot serve as both a fill and body text on paper — `#B4553F` is 4.87:1 against white (fill, passes) but only 4.46:1 against `#F6F5F1` (text, fails). See §6.3.
4. No numeric suffixes in layer 2. `--primary-500` is banned: it invites feature code to pick a shade, which is a layer-1 decision.

## 3.3 The CSS

`tokens/primitives.css` — raw values, never referenced by features:

```css
/* Layer 1 — primitives. Loaded once. Not present in any skin document. */
:root {
  /* neutral / paper family — from wireframe §7.2 */
  --shj3-paper:      #F6F5F1;
  --shj3-panel:      #FFFFFF;
  --shj3-sand-100:   #EFEDE7;
  --shj3-sand-200:   #E3E1DA;
  --shj3-sand-400:   #8F8B81;
  --shj3-ink-900:    #20242B;
  --shj3-ink-500:    #5B6270;

  /* brand green family */
  --shj3-green-800:  #15584A;
  --shj3-green-600:  #1F6F5C;   /* wireframe accent */
  --shj3-green-300:  #8FD9C2;
  --shj3-green-100:  #DDEDE7;

  /* rust family */
  --shj3-rust-700:   #9E4230;
  --shj3-rust-600:   #B4553F;   /* wireframe warn */
  --shj3-rust-100:   #F5E3DD;

  /* dark-mode neutrals */
  --shj3-slate-950:  #14171C;
  --shj3-slate-900:  #1B1F26;
  --shj3-slate-800:  #232830;
  --shj3-slate-600:  #6A7280;
  --shj3-slate-200:  #A2A9B5;
  --shj3-slate-050:  #EDEEF0;

  /* geometry */
  --shj3-space-unit: 0.25rem;   /* 4px */
  --shj3-radius-unit: 0.5rem;   /* 8px */
}
```

`tokens/semantic.css` — the default (system) theme. **Every value here is overridable by a skin.**

```css
/* Layer 2 — semantic roles. A skin replaces the right-hand sides. */
:root {
  --background:            var(--shj3-paper);
  --foreground:            var(--shj3-ink-900);
  --card:                  var(--shj3-panel);
  --card-foreground:       var(--shj3-ink-900);
  --muted:                 var(--shj3-sand-100);
  --muted-foreground:      var(--shj3-ink-500);
  --border:                var(--shj3-sand-200);
  --border-strong:         var(--shj3-sand-400);
  --primary:               var(--shj3-green-600);
  --primary-foreground:    var(--shj3-panel);
  --destructive:           var(--shj3-rust-600);
  --destructive-strong:    var(--shj3-rust-700);
  --ring:                  var(--shj3-green-600);
  --radius-root:           var(--shj3-radius-unit);
  --density-scale:         1;      /* comfortable */
  --shadow-depth:          1;
}
```

`tokens/components.css` — layer 3, derived, consumed by components:

```css
/* Layer 3 — component tokens. Derived from layer 2; never literals. */
:root {
  --button-radius:         var(--radius-md);
  --button-height-md:      var(--control-height-md);
  --badge-radius:          var(--radius-full);
  --badge-padding-inline:  var(--space-2);
  --card-radius:           var(--radius-lg);
  --card-border:           var(--border);
  --table-row-height:      var(--row-height);
  --table-header-surface:  var(--muted);
  --sidebar-width:         16rem;
  --chat-bubble-radius:    var(--radius-lg);
  --chat-bubble-max-inline-size: 34rem;
  --focus-ring-width:      2px;
  --focus-ring-offset:     2px;
}
```

## 3.4 Tailwind emits `var(--token)`, not values

This is the mechanism that makes a Tailwind-styled application repaintable. Tailwind's theme maps utility names to `var()` references, so `bg-primary` compiles to `background-color: var(--primary)` — the class is a *pointer*, and changing the variable changes every element using the class.

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";

/**
 * Every scale below resolves to a CSS custom property, never a literal.
 * Consequence: no Tailwind class contains a colour, radius, spacing or font
 * value in the compiled output — only a var() reference. This is what makes
 * a runtime token change repaint the whole app (ADR-0007).
 */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    // Replaces (not extends) Tailwind's defaults: the built-in palette and
    // spacing scale are removed so `bg-red-500` and `p-7` do not exist.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      background: "var(--background)",
      foreground: "var(--foreground)",
      card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
      popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
      muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
      primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)", hover: "var(--primary-hover)" },
      secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
      accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
      success: { DEFAULT: "var(--success)", foreground: "var(--success-foreground)", subtle: "var(--success-subtle)", strong: "var(--success-strong)" },
      warning: { DEFAULT: "var(--warning)", foreground: "var(--warning-foreground)", subtle: "var(--warning-subtle)", strong: "var(--warning-strong)" },
      destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)", subtle: "var(--destructive-subtle)", strong: "var(--destructive-strong)" },
      info: { DEFAULT: "var(--info)", foreground: "var(--info-foreground)", subtle: "var(--info-subtle)", strong: "var(--info-strong)" },
      border: { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
      input: "var(--input)",
      ring: "var(--ring)",
      overlay: "var(--overlay)",
      chat: {
        user: "var(--chat-user-bubble)",
        "user-foreground": "var(--chat-user-bubble-foreground)",
        assistant: "var(--chat-assistant-bubble)",
        "assistant-foreground": "var(--chat-assistant-bubble-foreground)",
      },
      sidebar: {
        DEFAULT: "var(--sidebar)",
        foreground: "var(--sidebar-foreground)",
        accent: "var(--sidebar-accent)",
        active: "var(--sidebar-active-surface)",
        border: "var(--sidebar-border)",
      },
      chart: { 1: "var(--chart-1)", 2: "var(--chart-2)", 3: "var(--chart-3)", 4: "var(--chart-4)", 5: "var(--chart-5)", 6: "var(--chart-6)" },
    },
    spacing: {
      0: "var(--space-0)", px: "var(--space-px)", 1: "var(--space-1)", 2: "var(--space-2)",
      3: "var(--space-3)", 4: "var(--space-4)", 5: "var(--space-5)", 6: "var(--space-6)",
      8: "var(--space-8)", 10: "var(--space-10)", 12: "var(--space-12)", 16: "var(--space-16)",
      20: "var(--space-20)", 24: "var(--space-24)",
    },
    borderRadius: {
      none: "0", xs: "var(--radius-xs)", sm: "var(--radius-sm)", md: "var(--radius-md)",
      lg: "var(--radius-lg)", xl: "var(--radius-xl)", "2xl": "var(--radius-2xl)", full: "var(--radius-full)",
    },
    boxShadow: {
      none: "none", xs: "var(--shadow-xs)", sm: "var(--shadow-sm)", md: "var(--shadow-md)",
      lg: "var(--shadow-lg)", xl: "var(--shadow-xl)", inset: "var(--shadow-inset)",
    },
    fontFamily: {
      sans: "var(--font-sans)", mono: "var(--font-mono)", arabic: "var(--font-arabic)",
    },
    fontSize: {
      "2xs": ["var(--text-2xs)", { lineHeight: "var(--leading-snug)" }],
      xs:    ["var(--text-xs)",  { lineHeight: "var(--leading-snug)" }],
      sm:    ["var(--text-sm)",  { lineHeight: "var(--leading-normal)" }],
      base:  ["var(--text-base)",{ lineHeight: "var(--leading-normal)" }],
      md:    ["var(--text-md)",  { lineHeight: "var(--leading-normal)" }],
      lg:    ["var(--text-lg)",  { lineHeight: "var(--leading-snug)" }],
      xl:    ["var(--text-xl)",  { lineHeight: "var(--leading-tight)" }],
      "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-tight)" }],
      "3xl": ["var(--text-3xl)", { lineHeight: "var(--leading-tight)" }],
    },
    fontWeight: {
      regular: "var(--font-weight-regular)", medium: "var(--font-weight-medium)",
      semibold: "var(--font-weight-semibold)", bold: "var(--font-weight-bold)",
    },
    zIndex: {
      base: "var(--z-base)", dropdown: "var(--z-dropdown)", sticky: "var(--z-sticky)",
      overlay: "var(--z-overlay)", modal: "var(--z-modal)", popover: "var(--z-popover)",
      toast: "var(--z-toast)", tooltip: "var(--z-tooltip)",
    },
    transitionDuration: {
      instant: "var(--duration-instant)", fast: "var(--duration-fast)",
      normal: "var(--duration-normal)", slow: "var(--duration-slow)", slower: "var(--duration-slower)",
    },
    transitionTimingFunction: {
      standard: "var(--ease-standard)", out: "var(--ease-out)",
      in: "var(--ease-in)", emphasised: "var(--ease-emphasised)",
    },
    // Breakpoints are the exception — see §4.9. Static, not var().
    screens: { sm: "560px", md: "820px", lg: "1080px", xl: "1400px" },
  },
} satisfies Config;
```

Note `theme:` rather than `theme.extend:`. Tailwind's default palette and spacing scale are **replaced**, not augmented, so `bg-red-500`, `text-gray-700` and `p-7` do not compile at all. That removes an entire class of violation before the linter has to catch it.

## 3.5 How a token change propagates with no rebuild

```
Admin changes --primary in Settings → Appearance
        │
        ▼
POST /api/appearance/tenant-theme        validate schema → compute contrast → persist
        │                                 (skin row in the tenant's own SQL schema, ADR-0002)
        ▼
Next request to any page
        │
        ▼
Server resolves user → tenant → system   (§9.4) and inlines <style id="shj3-theme">
        │                                 :root { --primary: #0F5C8C; … }
        ▼
Browser paints                            every element using .bg-primary, .text-primary,
                                          .border-primary, .ring-primary — and every layer-3
                                          token derived from --primary — is already correct
```

No component re-renders, because no component holds the value. No bundle changes, because the compiled CSS contains `var(--primary)` and always did. The only artefact that changed is one `<style>` block of variable declarations.

**Live preview** uses the identical mechanism client-side: the Appearance module writes candidate values to `document.documentElement.style` (an inline style, higher specificity than the server block). Cancelling preview removes the inline properties and the server-rendered values reappear untouched — which is how §2 P7's "never a half-applied state" is achieved without a page reload.

---

# 4. Token reference

Complete catalogue. **147 emitted layer-2 tokens** across 7 runtime categories, plus 4 build-time breakpoints (§4.9, exported but never emitted as custom properties) and **42 layer-3 component tokens** (§4.10). Light values are the **Sharjah Default** skin; dark values are **Sharjah Dark** (§8). Contrast column gives the measured ratio against the surface named in the Notes column, computed with the WCAG 2.1 relative-luminance formula.

**Counts reconciled against the implementation (2026-09-08).** An earlier draft's category headings and its summary table disagreed by a few tokens in each direction. `@shj3/tokens` is now the authority: the per-category enumerations here were treated as correct, the headings and totals corrected to match, and the package's tests assert the emitted set. Where a heading and a table ever disagree again, count the rows — the package will too.

## 4.1 Colour — surfaces, text and structure (15)

| Token | Light | Dark | Notes / measured contrast |
|---|---|---|---|
| `--background` | `#F6F5F1` | `#14171C` | Page ground. Wireframe "paper" §7.2 |
| `--foreground` | `#20242B` | `#EDEEF0` | Wireframe "ink". **14.27:1** on light bg, **15.47:1** on dark bg |
| `--surface-sunken` | `#EFEDE7` | `#101317` | Recessed wells: table headers, summary strip, code blocks |
| `--card` | `#FFFFFF` | `#1B1F26` | Wireframe "panel". Cards, canvases, dialogs |
| `--card-foreground` | `#20242B` | `#EDEEF0` | **15.57:1** light, **14.24:1** dark |
| `--popover` | `#FFFFFF` | `#20252D` | Dropdowns, tooltips, node inspector overlay |
| `--popover-foreground` | `#20242B` | `#EDEEF0` | **15.57:1** light, **13.26:1** dark |
| `--muted` | `#EFEDE7` | `#232830` | Muted surface: disabled rows, skeleton base, meta strips |
| `--muted-foreground` | `#5B6270` | `#A2A9B5` | Wireframe "ink soft". **5.24:1** on `--muted` light, **6.26:1** dark. Also the placeholder colour |
| `--border` | `#E3E1DA` | `#2E343E` | Decorative dividers and card hairlines. 1.20:1 — **decorative only**, never a control boundary (§10.2) |
| `--border-strong` | `#8F8B81` | `#6A7280` | Control boundaries: inputs, switches, checkboxes, table cell grid. **3.12:1** light / **3.71:1** dark vs background — satisfies WCAG 1.4.11 |
| `--input` | `#FFFFFF` | `#1B1F26` | Field fill |
| `--ring` | `#1F6F5C` | `#5FC7AA` | Focus ring. **5.52:1** light / **8.76:1** dark vs background |
| `--ring-offset` | `#F6F5F1` | `#14171C` | Ring halo; tracks `--background` so the ring reads on any surface |
| `--overlay` | `rgb(32 36 43 / 0.44)` | `rgb(10 12 15 / 0.62)` | Modal scrim |

## 4.2 Colour — brand (7)

| Token | Light | Dark | Notes / measured contrast |
|---|---|---|---|
| `--primary` | `#1F6F5C` | `#4FB79B` | Wireframe accent §7.2. Primary action, active nav, switch-on fill |
| `--primary-foreground` | `#FFFFFF` | `#14171C` | **6.02:1** on light primary, **7.34:1** on dark primary |
| `--primary-hover` | `#1A5D4D` | `#63C6AB` | Hover/active fill for primary surfaces |
| `--secondary` | `#EFEDE7` | `#232830` | Secondary button fill, neutral pill |
| `--secondary-foreground` | `#20242B` | `#EDEEF0` | **13.30:1** light, **12.76:1** dark |
| `--accent` | `#DDEDE7` | `#12332B` | Hover/selected *surface* tinted with brand — sub-tab hover, selected table row, chip hover |
| `--accent-foreground` | `#15584A` | `#8FD9C2` | **6.86:1** light, **8.39:1** dark |

`--secondary` and `--accent` are separate roles deliberately: `--secondary` is hue-neutral (a second-rank button stays neutral when a tenant re-brands), `--accent` is brand-tinted (selection state should follow the brand).

## 4.3 Colour — semantic status (16)

Four roles × four slots. `-subtle` is the badge/banner fill; `-strong` is the text-safe darkened variant used for label text on `--background` or on `-subtle`.

| Role | Slot | Light | Dark | Contrast |
|---|---|---|---|---|
| **success** | `--success` | `#1F6F5C` | `#4FB79B` | fill |
| | `--success-foreground` | `#FFFFFF` | `#14171C` | **6.02:1** / **7.34:1** |
| | `--success-subtle` | `#DDEDE7` | `#12332B` | badge fill |
| | `--success-strong` | `#15584A` | `#8FD9C2` | **6.86:1** on subtle (both modes: 6.86 / 8.39) |
| **warning** | `--warning` | `#8A5A12` | `#E0A33E` | fill |
| | `--warning-foreground` | `#FFFFFF` | `#14171C` | **5.91:1** / **8.11:1** |
| | `--warning-subtle` | `#F7EBD4` | `#38290F` | badge fill |
| | `--warning-strong` | `#6E4709` | `#E0A33E` | **6.93:1** / **6.35:1** on subtle |
| **destructive** | `--destructive` | `#B4553F` | `#E08A70` | Wireframe "warn" §7.2. Fill |
| | `--destructive-foreground` | `#FFFFFF` | `#14171C` | **4.87:1** / **6.88:1** |
| | `--destructive-subtle` | `#F5E3DD` | `#3A211A` | badge fill |
| | `--destructive-strong` | `#9E4230` | `#F0B49F` | **5.16:1** / **8.31:1** on subtle; **5.88:1** on `--background` light |
| **info** | `--info` | `#2A5D9F` | `#76A9E8` | fill |
| | `--info-foreground` | `#FFFFFF` | `#14171C` | **6.64:1** / **7.37:1** |
| | `--info-subtle` | `#DFE9F6` | `#16283D` | badge fill |
| | `--info-strong` | `#1F4C86` | `#76A9E8` | **7.03:1** / **6.13:1** on subtle |

**Why `--success` is a separate token from `--primary` even though both are `#1F6F5C` in the default skin.** The wireframe uses one green for "primary action" and "healthy state" alike (§7.2: *"Active state, success, primary action"*). If they shared a token, SEWA re-branding `--primary` to its corporate blue would silently turn every `Healthy` / `Passed` / `Approved` badge blue — and B14 tab 3's observability panel would lose its meaning. They are decoupled. A tenant may re-brand `--primary` freely; `--success` is defaulted from `--primary` in the Appearance module's "match brand" affordance but is stored independently.

**Why `warning` is a new hue the wireframe does not have.** §3.1 gives two badge families — green and rust. The 14 admin screens need three distinct meanings: healthy (green), *needs attention but not broken* (`Draft`, `Pending review`, `Sandbox`, `Untested` — warning), and *broken* (`Failed`, `Blocked`, `Degraded`, `Open breaker` — destructive). Collapsing the latter two, as the wireframe does, makes B13 tab 2's `Failed` regression indistinguishable from B10 tab 3's `Pending review` template. Amber `#8A5A12` is introduced for the middle band. See §6 for the full mapping. **[ASSUMPTION]** — the wireframe is silent; this is a production requirement.

## 4.4 Colour — assistant surface (9)

Drawn from A1/A2 and the brief's reference screenshots: *"Right-aligned mint user bubbles, left-aligned sand assistant bubbles"* (§2.2).

| Token | Light | Dark | Notes / contrast |
|---|---|---|---|
| `--chat-user-bubble` | `#D7EFE7` | `#1E3A33` | Mint. Inline-end aligned (right in LTR, left in RTL) |
| `--chat-user-bubble-foreground` | `#20242B` | `#EDEEF0` | **12.89:1** / **10.59:1** |
| `--chat-assistant-bubble` | `#F1EDE4` | `#262B33` | Sand. Inline-start aligned |
| `--chat-assistant-bubble-foreground` | `#20242B` | `#EDEEF0` | **13.33:1** / **12.26:1** |
| `--chat-meta-foreground` | `#5B6270` | `#A2A9B5` | Message meta row: TTS, 👍/👎, timestamp. **5.08:1** on user bubble, **5.25:1** on assistant bubble (light); **5.20:1** / **6.02:1** (dark) |
| `--chat-disclaimer` | `#EFEDE7` | `#232830` | A1's grey disclaimer banner |
| `--chat-disclaimer-foreground` | `#5B6270` | `#A2A9B5` | **5.24:1** / **6.26:1** |
| `--chat-composer` | `#FFFFFF` | `#20252D` | Composer field fill |
| `--chat-typing` | `#5B6270` | `#A2A9B5` | A3's "◐ Still thinking…" indicator |

The mint/sand pair is tinted from `--primary` and `--muted` respectively in the default skin but stored as independent tokens, because B10 tab 2's Web widget studio lets an entity pick an accent colour and *"header dot, bubble tint and chip borders all follow the accent colour"* — that studio writes `--chat-user-bubble` directly.

## 4.5 Colour — sidebar, chart and utility (19)

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--sidebar` | `#EFEDE7` | `#141A18` | Sidebar ground. `sidebarStyle: "brand"` sets `#12352D` in both modes |
| `--sidebar-foreground` | `#20242B` | `#EDEEF0` | **13.30:1** light, **15.19:1** dark, **11.50:1** on brand |
| `--sidebar-muted-foreground` | `#5B6270` | `#A2A9B5` | Group headers ("Assistant window", "Admin / configurator"). **6.77:1** on brand |
| `--sidebar-accent` | `#1F6F5C` | `#6FCDB0` | Active item marker. **7.02:1** on brand |
| `--sidebar-active-surface` | `#DDEDE7` | `#1E2B27` | Active item fill |
| `--sidebar-border` | `#E3E1DA` | `#232B28` | Divider |
| `--chart-1` | `#1F6F5C` | `#4FB79B` | Categorical series 1. **6.02:1** / **6.75:1** on card |
| `--chart-2` | `#2A5D9F` | `#76A9E8` | **6.64:1** / **6.78:1** |
| `--chart-3` | `#8A5A12` | `#E0A33E` | **5.91:1** / **7.46:1** |
| `--chart-4` | `#B4553F` | `#E08A70` | **4.87:1** / **6.33:1** |
| `--chart-5` | `#5B6270` | `#A2A9B5` | **6.13:1** / **6.99:1** |
| `--chart-6` | `#6E4B8F` | `#B48FD6` | **6.85:1** / **6.17:1** |
| `--selection` | `#DDEDE7` | `#12332B` | Text selection background |
| `--selection-foreground` | `#20242B` | `#EDEEF0` | |
| `--skeleton` | `#EFEDE7` | `#232830` | Loading placeholder base |
| `--code-surface` | `#EFEDE7` | `#101317` | B3's JSON responses, B10's embed snippet, B6's playground output |
| `--code-foreground` | `#20242B` | `#EDEEF0` | Monospace |
| `--disabled-surface` | `#EFEDE7` | `#1B1F26` | |
| `--disabled-foreground` | `#8A8F99` | `#6E7684` | **2.98:1 against `--paper`, 2.77:1 against `--disabled-surface`** (dark: 3.61:1 / 3.28:1). Below 4.5:1 **by design** — WCAG 1.4.3 exempts disabled controls, and a disabled control that looks enabled is the worse failure. The gate (§10.2) skips this pair explicitly rather than silently. *Both backgrounds are stated because an earlier draft gave one figure without saying which surface it was measured against, and the implementation tests the `--disabled-surface` pairing.* |

Chart palette ordering is by hue separation, not brand priority, and every series is above 4.5:1 on `--card` so a value label can sit on the mark. Series are additionally distinguished by pattern (solid / 45° hatch / dotted / cross-hatch / vertical / horizontal) — B1's 7-bar channel-split chart must be readable in monochrome print (§6.1).

## 4.6 Typography (26)

The wireframe loads IBM Plex Sans and IBM Plex Mono (§7.1). Both are retained; the mono face is not decorative — it is the **mono sub-line** component (§3.1: *"Metadata: IDs, endpoints, timestamps, owners"*) and it carries real information design work across B3 (`mcp://sharjah-services.internal`), B11 (`TXN-88213`), B14 (audit timestamps) and A2 (the trace rail).

| Token | Value | Notes |
|---|---|---|
| `--font-sans` | `"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif` | Latin UI |
| `--font-mono` | `"IBM Plex Mono", "Cascadia Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace` | IDs, endpoints, timestamps, owners, JSON, trace lines |
| `--font-arabic` | `"IBM Plex Sans Arabic", "Noto Sans Arabic", "Dubai", "Geeza Pro", Tahoma, sans-serif` | Applied at `:root:dir(rtl)` and to any `lang="ar"` subtree. Tahoma is the last-resort fallback because it ships on every Windows install used across Sharjah government desktops **[ASSUMPTION]** |
| `--font-size-base` | `0.875rem` (14px) | Root of the scale. The Appearance module's "base size" control writes this token; every step below is `calc()`-derived, so one change rescales the app |
| `--font-scale-ratio` | `1.2` | Appearance module's "scale" control |

Type scale — 9 steps, all derived from `--font-size-base` × `--font-scale-ratio`ⁿ and then rounded to a static rem value for stability. Both are published: the `calc()` chain is the live one, the px column is the value at defaults.

| Token | Default | Derivation | Used for |
|---|---|---|---|
| `--text-2xs` | `0.6875rem` / 11px | `calc(var(--font-size-base) / pow(ratio, 2))` | Badge text, table micro-labels, mono sub-line at density=compact |
| `--text-xs` | `0.75rem` / 12px | `/ ratio^1.5` | Mono sub-line, meta row, timestamps, helper text |
| `--text-sm` | `0.8125rem` / 13px | `/ ratio^0.8` | Table cells at compact density, badge label, sub-tab label |
| `--text-base` | `0.875rem` / 14px | `× 1` | Body, table cells, form inputs, chat bubbles |
| `--text-md` | `1rem` / 16px | `× ratio^0.75` | Card titles, chat bubble at expanded widget width |
| `--text-lg` | `1.125rem` / 18px | `× ratio^1.3` | Pane headings, sub-tab bar section title |
| `--text-xl` | `1.375rem` / 22px | `× ratio^2.4` | Screen title (B1 "Command centre") |
| `--text-2xl` | `1.75rem` / 28px | `× ratio^3.8` | KPI tile value |
| `--text-3xl` | `2.125rem` / 34px | `× ratio^4.8` | Assistant greeting in expanded widget; empty-state headline |

| Line heights | Value | Applies to |
|---|---|---|
| `--leading-tight` | `1.2` | `--text-xl` and above |
| `--leading-snug` | `1.35` | Badges, table cells, meta rows |
| `--leading-normal` | `1.5` | Body, forms, chat |
| `--leading-relaxed` | `1.65` | Long-form prose — B12 policy descriptions, Phase F guide pages |
| `--leading-arabic` | `1.75` | Arabic body text. Arabic ascenders/descenders and diacritics need more leading than Latin at the same size; see §11.4 |

| Weights | Value | | Tracking | Value |
|---|---|---|---|---|
| `--font-weight-regular` | `400` | | `--tracking-tight` | `-0.011em` |
| `--font-weight-medium` | `500` | | `--tracking-normal` | `0` |
| `--font-weight-semibold` | `600` | | `--tracking-wide` | `0.04em` |
| `--font-weight-bold` | `700` | | | |

`--tracking-wide` is for uppercase micro-labels only (table column groups, sidebar group headers). `--tracking-*` is **never** applied to Arabic — letter-spacing breaks Arabic joining (§11.4).

## 4.7 Spacing and density (21)

One 4px unit, a 14-step scale, and a single multiplier that implements Phase E's density control.

```css
:root {
  --space-unit:    0.25rem;               /* 4px, from --shj3-space-unit */
  --density-scale: 1;                     /* comfortable */
  --space-0:  0;
  --space-px: 1px;                        /* hairlines — never scaled */
  --space-1:  calc(var(--space-unit) * 1  * var(--density-scale));
  --space-2:  calc(var(--space-unit) * 2  * var(--density-scale));
  --space-3:  calc(var(--space-unit) * 3  * var(--density-scale));
  --space-4:  calc(var(--space-unit) * 4  * var(--density-scale));
  --space-5:  calc(var(--space-unit) * 5  * var(--density-scale));
  --space-6:  calc(var(--space-unit) * 6  * var(--density-scale));
  --space-8:  calc(var(--space-unit) * 8  * var(--density-scale));
  --space-10: calc(var(--space-unit) * 10 * var(--density-scale));
  --space-12: calc(var(--space-unit) * 12 * var(--density-scale));
  --space-16: calc(var(--space-unit) * 16 * var(--density-scale));
  --space-20: calc(var(--space-unit) * 20 * var(--density-scale));
  --space-24: calc(var(--space-unit) * 24 * var(--density-scale));

  --control-height-sm: calc(1.5rem  + var(--space-2));
  --control-height-md: calc(1.75rem + var(--space-3));
  --control-height-lg: calc(2rem    + var(--space-4));
  --row-height:        calc(2rem    + var(--space-4));
  --page-gutter:       var(--space-6);
}

/* Phase E density control — two declarations, not per-component overrides. */
[data-density="compact"]     { --density-scale: 0.75; }
[data-density="comfortable"] { --density-scale: 1; }
```

| Token | Comfortable | Compact (×0.75) |
|---|---|---|
| `--space-1` … `--space-24` | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px | 3, 6, 9, 12, 15, 18, 24, 30, 36, 48, 60, 72 px |
| `--control-height-md` | 40px | 40 → 34px |
| `--row-height` | 48px | 48 → 42px |
| `--page-gutter` | 24px | 18px |

This is the whole density implementation. Because every component's padding, gap and height is expressed in scale tokens, switching `--density-scale` recompacts B1's conversation explorer, B9's permission matrix and B14's audit log simultaneously with no component knowing density exists. `--space-px` is excluded from scaling so hairline borders never render at 0.75px.

**Touch-target floor.** `--control-height-md` at compact density is 34px, below the 44px WCAG 2.5.5 (AAA) / 24px 2.5.8 (AA) target. Compact density is therefore disabled — the control is present but switched off with an explanatory note — when the viewport matches `(pointer: coarse)`. See §10.5.

## 4.8 Radius, shadow, z-index, motion (34)

### Radius (8) — one root token drives the whole system

```css
:root {
  --radius-root: 0.5rem;                              /* Phase E "corner radius" control */
  --radius-xs:   calc(var(--radius-root) * 0.25);     /* 2px  — checkbox, tag */
  --radius-sm:   calc(var(--radius-root) * 0.5);      /* 4px  — input, badge on square variant */
  --radius-md:   calc(var(--radius-root) * 0.75);     /* 6px  — button, select */
  --radius-lg:   var(--radius-root);                  /* 8px  — card, chat bubble, dialog */
  --radius-xl:   calc(var(--radius-root) * 1.5);      /* 12px — widget shell, KPI tile */
  --radius-2xl:  calc(var(--radius-root) * 2);        /* 16px — expanded widget, modal */
  --radius-full: 9999px;                              /* pill, switch, avatar — never scaled */
}
```

The Appearance module's radius control is a slider over `--radius-root` with four stops: `0rem` (square), `0.25rem` (subtle), `0.5rem` (default), `0.875rem` (round). Everything else follows. `--radius-full` is fixed because a pill that stops being a pill is a different component — the wireframe's selectable pill and switch (§3.1) depend on it.

### Shadow (8) — depth as a multiplier

```css
:root {
  --shadow-depth: 1;                                  /* Phase E "shadow depth" control */
  --shadow-color: 32 36 43;                           /* --shj3-ink-900 as an rgb triplet */
  --shadow-xs:    0 1px 1px rgb(var(--shadow-color) / calc(0.05 * var(--shadow-depth)));
  --shadow-sm:    0 1px 2px rgb(var(--shadow-color) / calc(0.07 * var(--shadow-depth))),
                  0 1px 1px rgb(var(--shadow-color) / calc(0.04 * var(--shadow-depth)));
  --shadow-md:    0 2px 6px rgb(var(--shadow-color) / calc(0.08 * var(--shadow-depth))),
                  0 1px 2px rgb(var(--shadow-color) / calc(0.05 * var(--shadow-depth)));
  --shadow-lg:    0 8px 20px rgb(var(--shadow-color) / calc(0.10 * var(--shadow-depth))),
                  0 2px 6px  rgb(var(--shadow-color) / calc(0.06 * var(--shadow-depth)));
  --shadow-xl:    0 18px 44px rgb(var(--shadow-color) / calc(0.14 * var(--shadow-depth))),
                  0 4px 12px  rgb(var(--shadow-color) / calc(0.08 * var(--shadow-depth)));
  --shadow-inset: inset 0 1px 2px rgb(var(--shadow-color) / calc(0.06 * var(--shadow-depth)));
}
:root:not([data-theme="light"]) { --shadow-color: 4 6 9; }   /* deeper in dark mode */
```

Depth stops: `0` (flat — surfaces separated by `--border` only), `0.5` (subtle), `1` (default), `1.6` (pronounced). At depth `0` the system must remain legible from borders alone, which is why `--border-strong` exists as a separate token: a flat theme still needs 3:1 control boundaries.

Elevation assignment: `xs` table header sticky row · `sm` card, KPI tile · `md` dropdown, tooltip, node inspector · `lg` docked widget shell, sheet · `xl` modal, expanded widget · `inset` pressed toggle, active pill.

### Z-index (8) — named, never numeric

| Token | Value | Layer |
|---|---|---|
| `--z-base` | `0` | Document flow |
| `--z-dropdown` | `1000` | Select, combobox, dropdown menu, sub-tab overflow |
| `--z-sticky` | `1100` | Sticky table header, sticky wizard step strip, sticky sub-tab bar |
| `--z-overlay` | `1200` | Modal scrim, sheet scrim |
| `--z-modal` | `1300` | Dialog, sheet, node inspector on ≤820px |
| `--z-popover` | `1400` | Popover anchored above a modal (a select inside a dialog) |
| `--z-toast` | `1500` | Toast region |
| `--z-tooltip` | `1600` | Tooltip — always topmost, since it may explain a toast |

A numeric `z-index` in feature code fails lint. Radix portals mount at `--z-modal` and above by default.

### Motion (10)

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | `50ms` | Pressed state, switch thumb |
| `--duration-fast` | `120ms` | Hover, focus ring, badge change |
| `--duration-normal` | `200ms` | Dropdown, tooltip, sub-tab underline slide, accordion |
| `--duration-slow` | `320ms` | Dialog, sheet, widget dock → expand transition |
| `--duration-slower` | `480ms` | Graph canvas re-layout, flow canvas orientation flip |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Entering |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exiting |
| `--ease-emphasised` | `cubic-bezier(0.3, 0, 0, 1)` | Widget expand, wizard step change |
| `--motion-scale` | `1` | Global multiplier; `0` disables |

The wireframe already honours `prefers-reduced-motion` (§7.4). The token form of that:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-scale: 0;
    --duration-instant: 1ms; --duration-fast: 1ms; --duration-normal: 1ms;
    --duration-slow: 1ms;    --duration-slower: 1ms;
  }
}
```

Durations collapse rather than transitions being removed, so state changes still *complete* — a switch still lands on, a dialog still opens. Non-transitional motion (the A3 "Still thinking…" spinner, `--chat-typing`) must additionally check `--motion-scale` and render a static glyph when it is `0`; a perpetual animation is the case a duration override does not fix.

## 4.9 Breakpoints (4) — the one non-runtime category

CSS custom properties **cannot** be used in media query conditions: `@media (max-width: var(--bp-md))` does not work in any browser. Breakpoints are therefore build-time values in the Tailwind config (§3.4) and are the single token category that is *not* runtime-themable. This is stated plainly rather than fudged, because pretending otherwise produces a theming module with a control that does nothing.

Values are taken from the wireframe's measured behaviour (§7.3), not from a generic device list:

| Token | Value | Behaviour at and below |
|---|---|---|
| `--bp-sm` | `560px` | KPI grid → 1 column. Sub-tab bars scroll horizontally with an inline-start/end fade mask. Data table switches to stacked card rows. Widget shell goes full-bleed |
| `--bp-md` | `820px` | Sidebar → horizontal nav (scrollable, grouped by the two wireframe groups). Two-column forms stack. B4 orchestrator diagram flips vertical. Node inspector (B7) becomes a bottom sheet at `--z-modal`. Permission matrix (B9) switches to role-per-card |
| `--bp-lg` | `1080px` | KPI grid → 2 columns. Three-column layouts collapse to one — this is A2's thread + diagnostics rail, and B6's sources + graph + detail |
| `--bp-xl` | `1400px` | Content max-inline-size caps; A2's diagnostics rail widens rather than the thread |

Container queries are preferred over these breakpoints wherever a component's layout depends on *its own* width rather than the viewport's — the assistant widget is the case that forces this, since A1's docked (400px) and expanded (560px) states must render differently while the viewport is unchanged. `AssistantWidgetShell` declares `container-type: inline-size` and its children use `@container` queries at `400px` and `560px`.

## 4.10 Layer-3 component tokens (42)

Derived from layer 2. The 6 marked ▲ are the ones the Appearance module surfaces.

**Correction (2026-09-08).** An earlier draft implied a skin sets those six *directly*. It does not, and the distinction matters because it is the token architecture working as designed:

| Marked token | How a skin changes it |
|---|---|
| `--card-radius` | indirectly — a skin sets `geometry.radiusRoot` (layer 2) and this follows |
| `--card-shadow` | indirectly — a skin sets `geometry.shadowDepth` and this follows |
| `--sidebar-width` | **directly** — `geometry.sidebarWidth` |
| `--sidebar-style` | **directly** — `geometry.sidebarStyle` |
| `--focus-ring-width` | not skin-settable; changing it per skin would let a tenant weaken a focus indicator, which is an accessibility floor rather than a brand choice (§10) |
| `--focus-ring-offset` | as above |

Phase E's *corner radius* and *shadow depth* controls are therefore satisfied through the layer-2 roots, which is the correct mechanism — a skin that wrote layer-3 tokens directly would bypass the cascade and reintroduce exactly the per-component overrides ADR-0007 forbids. The skin schema in §7.2 is complete as written; only this table's wording was wrong.

| Token | Default | Token | Default |
|---|---|---|---|
| `--button-radius` | `var(--radius-md)` | `--table-row-height` | `var(--row-height)` |
| `--button-height-sm` | `var(--control-height-sm)` | `--table-header-surface` | `var(--muted)` |
| `--button-height-md` | `var(--control-height-md)` | `--table-cell-padding-inline` | `var(--space-3)` |
| `--button-height-lg` | `var(--control-height-lg)` | `--table-border` | `var(--border)` |
| `--button-padding-inline` | `var(--space-4)` | `--table-sticky-shadow` | `var(--shadow-xs)` |
| `--input-radius` | `var(--radius-sm)` | `--matrix-cell-size` | `calc(var(--row-height) * 0.9)` |
| `--input-border` | `var(--border-strong)` | `--matrix-header-inline-size` | `14rem` |
| `--input-height` | `var(--control-height-md)` | `--graph-node-radius` | `var(--radius-sm)` |
| `--badge-radius` | `var(--radius-full)` | `--graph-edge-stroke` | `var(--border-strong)` |
| `--badge-padding-inline` | `var(--space-2)` | `--graph-canvas-surface` | `var(--card)` |
| `--badge-font-size` | `var(--text-2xs)` | `--graph-grid-line` | `var(--border)` |
| `--card-radius` ▲ | `var(--radius-lg)` | `--flow-node-inline-size` | `13rem` |
| `--card-border` | `var(--border)` | `--wizard-step-indicator-size` | `1.5rem` |
| `--card-padding` | `var(--space-4)` | `--subtab-underline-thickness` | `2px` |
| `--card-shadow` ▲ | `var(--shadow-sm)` | `--subtab-gap` | `var(--space-5)` |
| `--sidebar-width` ▲ | `16rem` | `--summary-strip-surface` | `var(--surface-sunken)` |
| `--sidebar-width-collapsed` | `3.5rem` | `--summary-strip-border-inline-start` | `3px solid var(--border-strong)` |
| `--sidebar-item-radius` | `var(--radius-md)` | `--progress-track-height` | `6px` |
| `--sidebar-style` ▲ | `"neutral"` | `--focus-ring-width` ▲ | `2px` |
| `--chat-bubble-radius` | `var(--radius-lg)` | `--focus-ring-offset` ▲ | `2px` |
| `--flow-canvas-edge-stroke` | `var(--border-strong)` | | |

---

# 5. Component library

## 5.1 Inventory

**57 components** in three tiers. Every one lives in `components/ui/` (atoms, molecules) or `components/patterns/` (organisms), is owned by the team per ADR-0007, and is exercised by a Storybook story per variant and a visual-regression snapshot in both skins and both directions (§12.5).

| Tier | Count | Definition |
|---|---|---|
| **Atoms** | 20 | No composition. Renders one control or one piece of text/graphic |
| **Molecules** | 20 | Composes atoms into a reusable unit with its own behaviour |
| **Organisms** | 17 | Owns a region of a screen, holds state, coordinates molecules |

The eight components named in the wireframe's §3.1 shared-component table are **first-class named components, not approximations** — that is precisely the benefit ADR-0007 cites for owning the component code. They appear below as `SubTabBar`, `ToggleRow`, `Card`, `Badge`, `Switch`, `SelectablePill`, `ProgressBar`, `MonoSubLine`, `SummaryStrip`.

## 5.2 The state model

Every interactive component implements the same eight states. A component that cannot express one must say why in its doc comment.

| State | Encoding | Token |
|---|---|---|
| **default** | — | role tokens |
| **hover** | surface shifts one step toward `--accent`; pointer devices only (`@media (hover: hover)`) | `--accent`, `--primary-hover` |
| **focus-visible** | 2px ring, 2px offset. Applied via `:focus-visible`, never `:focus` — clicking a button must not leave a ring | `--ring`, `--ring-offset`, `--focus-ring-width`, `--focus-ring-offset` |
| **active** (pressed) | `--shadow-inset`, no transform (transform breaks under `--motion-scale: 0`) | `--shadow-inset` |
| **selected / on** | `--primary` fill or `--accent` surface **plus** a non-colour marker (underline, check glyph, thumb position) | `--primary`, `--accent` |
| **disabled** | `--disabled-surface` / `--disabled-foreground`, `cursor: not-allowed`, `aria-disabled="true"`. Focusable but inert for anything carrying an explanation (B12's locked policies) | `--disabled-*` |
| **loading** | inline spinner replaces the leading icon slot; label retained; `aria-busy="true"`; dimensions frozen so nothing reflows | `--muted-foreground` |
| **error** | `--destructive-strong` label + `--destructive` border + text message wired by `aria-describedby`. Never border-colour alone | `--destructive*` |
| **empty** | `EmptyState` molecule with headline, one-line explanation, and the primary action that resolves it | `--muted-foreground` |

Two rules that follow from the wireframe:

- **B12's locked policies** (*"Attempting to toggle them does nothing — the platform floor is not negotiable"*) use `disabled` + `aria-disabled` + a `Locked` badge + a tooltip giving the reason. A control that silently ignores clicks is an accessibility failure; a control that says why it is locked is a feature.
- **Empty and error states are listed as a known gap in the wireframe (§8)**. They are not optional here: `DataTable`, `GraphCanvas`, `FlowCanvas`, the escalation queue, all four B6 tabs and all five B11 tabs ship an `EmptyState` and an error state, and a screen without both fails review.

## 5.3 Atoms (20)

| # | Component | Purpose | Variants | Key tokens | a11y / RTL |
|---|---|---|---|---|---|
| 1 | `Button` | Primary control | `primary`, `secondary`, `outline`, `ghost`, `destructive`, `link` × `sm`/`md`/`lg` | `--primary*`, `--secondary*`, `--destructive*`, `--button-*` | `<button>` always; `type` explicit. Leading/trailing icon slots are `-inline-start`/`-inline-end`, so they swap under RTL automatically |
| 2 | `IconButton` | Icon-only control | same variants, `sm`/`md` | `--button-radius`, `--control-height-*` | `aria-label` **required** — enforced by a lint rule. Min target 24×24 CSS px (§10.5). Directional icons (chevron, arrow) mirror under RTL; non-directional (sparkle, mic, speaker) do not |
| 3 | `Input` | Single-line text | `default`, `mono` (for endpoints/IDs), with `-inline-start`/`-inline-end` adornments | `--input-*`, `--border-strong`, `--muted-foreground` (placeholder) | Label always present, never placeholder-as-label. `dir="ltr"` forced on `mono` inputs even in RTL pages — an `mcp://` URL must not reorder (§11.3) |
| 4 | `Textarea` | Multi-line | `default`, auto-grow | as `Input` | B3 step 2's system prompt and B2's change summary. `dir="auto"` so an Arabic prompt renders RTL inside an EN page |
| 5 | `Select` | Single choice from a short list | `default`, `mono` | `--popover*`, `--input-*`, `--z-dropdown` | Radix Select. Typeahead, Home/End, Escape close, focus return |
| 6 | `Checkbox` | Boolean in a list | `default`, `indeterminate` | `--primary`, `--border-strong`, `--radius-xs` | Radix Checkbox. Check glyph is the non-colour marker |
| 7 | `RadioGroup` | One of several | `default`, `card` (bordered options) | `--primary`, `--border-strong` | Radix RadioGroup. Arrow keys move *and* select; single tab stop |
| 8 | `Switch` | **Wireframe §3.1** — pill toggle, green when on | `md`, `sm` | `--primary`, `--border-strong`, `--radius-full` | Radix Switch. `role="switch"` + `aria-checked`. Thumb travel is the non-colour marker. **Thumb starts at inline-start and travels to inline-end** — mirrors under RTL |
| 9 | `SelectablePill` | **Wireframe §3.1** — rounded outline, green fill when selected | `single` (radio semantics), `multi` (checkbox semantics) | `--accent`, `--primary`, `--radius-full` | Backed by real radio/checkbox inputs, visually hidden. Used for B3's tone pills, team/role pills (B9), and MCP tool binding pills (B3 sub-tab B) |
| 10 | `Badge` | **Wireframe §3.1** — status | `success`, `warning`, `destructive`, `info`, `neutral`, `outline`; sizes `sm`/`md` | `--*-subtle`, `--*-strong`, `--badge-*` | Text label mandatory (§6). Optional leading glyph as a second non-colour channel |
| 11 | `MonoSubLine` | **Wireframe §3.1** — small monospace grey metadata | `default`, `truncate`, `copyable` | `--font-mono`, `--text-xs`, `--muted-foreground` | `copyable` variant renders a real `IconButton` with `aria-label` and a polite live-region confirmation. Always `dir="ltr"`, `unicode-bidi: isolate` (§11.3) |
| 12 | `ProgressBar` | **Wireframe §3.1** — thin track, green fill, completeness % | `determinate`, `indeterminate`, `segmented` (wizard) | `--primary`, `--muted`, `--progress-track-height` | `role="progressbar"` with `aria-valuenow/min/max` and a visible numeric label — B6's "70% indexed" must be readable, not inferred from bar length. **Fills from inline-start**, so it mirrors |
| 13 | `Avatar` | User / entity mark | `image`, `initials`, `entity` | `--muted`, `--radius-full` | `alt` from the person's name; decorative when a name is adjacent |
| 14 | `Icon` | Lucide wrapper | `size` 14/16/20/24 | `currentColor` only | `aria-hidden="true"` unless it is the sole content. Maintains the `mirrorInRtl` allowlist (§11.5) |
| 15 | `Label` | Field label | `default`, `required`, `optional` | `--foreground`, `--text-sm` | `htmlFor` required. Required marker is the word "Required", not only an asterisk |
| 16 | `Separator` | Divider | `horizontal`, `vertical` | `--border` | Radix Separator; `decorative` unless it separates groups semantically |
| 17 | `Skeleton` | Loading placeholder | `text`, `block`, `row`, `circle` | `--skeleton` | Wrapped in `aria-busy` region. Shimmer suppressed at `--motion-scale: 0` |
| 18 | `Spinner` | Indeterminate work | `xs`/`sm`/`md` | `currentColor` | Static glyph under reduced motion. A3's "◐ Still thinking…" uses this |
| 19 | `Kbd` | Keyboard hint | `default` | `--font-mono`, `--surface-sunken` | Used by the Phase F guide and the graph/flow canvas help overlays |
| 20 | `Tooltip` | Short explanation on hover/focus | `default`, `rich` | `--popover*`, `--z-tooltip`, `--shadow-md` | Radix Tooltip. Opens on **focus as well as hover**. Never the only carrier of essential information (B12's lock reason is also in the DOM). The component's own public API takes a logical `side` (`inline-start`/`inline-end`) and translates it to Radix's physical `side` prop itself — Radix's own `side` is physical geometry, not RTL-aware (see §10.1's corrected row) |

## 5.4 Molecules (20) — the wireframe vocabulary first

### `SubTabBar` — wireframe §3.1: *text tabs with green underline on active*

Used by 11 of the 14 admin screens (B1, B5, B6, B9, B10, B11, B12, B13, B14 and B3's step-4 sub-tabs).

- **Anatomy** — horizontal list of text tabs; a 2px underline (`--subtab-underline-thickness`) beneath the active tab; `--subtab-gap` between tabs; optional trailing count badge per tab; horizontal scroll with a fade mask at ≤560px (§7.3).
- **Variants** — `primary` (screen sections), `nested` (B3 step 4's three sub-tabs inside a wizard step — smaller type, `--text-sm`), `with-counts` (B8 queue counts).
- **States** — default / hover (`--accent` surface behind the label) / focus-visible (ring on the tab, not the underline) / active (underline + `--font-weight-semibold`) / disabled (a tab whose data the role cannot view — hidden, not disabled, since RBAC hiding beats disabling here).
- **Tokens** — `--foreground`, `--muted-foreground`, `--primary`, `--accent`, `--subtab-*`, `--space-5`.
- **a11y** — Radix Tabs: `role="tablist"`, arrow-key navigation, one tab stop, `aria-controls`/`aria-labelledby` pairing, and **automatic activation** (arrow moves and activates) because every panel is cheap to render. Panels are `tabindex="-1"` and receive focus on programmatic activation only. Tab state is written to the URL (`?tab=publish-gate`) so B13 tab 3 is deep-linkable — required by Phase F.
- **RTL** — the tab row reverses; the underline slide animation reverses; the scroll fade masks swap; `ArrowRight` moves to the *previous* tab under `dir="rtl"`. **Corrected 2026-09-08:** this is *not* automatic — Radix's roving-focus group only resolves direction from an explicit `dir` prop or a `DirectionProvider` (§10.1), neither of which this app supplies for free, so `SubTabBar` itself must (and does) pass the resolved direction through explicitly. See §10.1's "Supplied by Radix" table note for the full mechanism; `sub-tab-bar.test.tsx` is the test asserting the real, resolved focus target under both directions.

### `ToggleRow` — wireframe §3.1: *pill buttons, dark fill when active, mutually exclusive*

A1's Docked/Expanded/WhatsApp, A3's AI-thinking/Escalated, B1's date range, B1 tab 2's filter, B4's execution modes, B8's agent status.

- **Anatomy** — a bordered track containing 2–5 pill segments; the active segment takes `--foreground` fill with `--background` text (the wireframe's "dark fill"), giving 14.27:1.
- **Variants** — `segmented` (default, shared track), `standalone` (separate pills, B1's filter row), `with-dot` (B8's `● Available / ● Busy / ● Offline` — the dot is `--success` / `--warning` / `--muted-foreground`, **and** the word is present).
- **States** — default / hover / focus-visible / active / disabled (a mode unavailable for the current agent) / loading (B4 recomputing a trace — the segment shows a spinner and the row is `aria-busy`).
- **Tokens** — `--foreground`, `--background`, `--border-strong`, `--muted`, `--radius-full`, `--space-1`.
- **a11y** — implemented as a Radix ToggleGroup with `type="single"`, `role="radiogroup"`. Arrow keys move and select; the group is one tab stop. **Not** a set of buttons: these are mutually exclusive states of one view, and radio semantics announce "2 of 3".
- **RTL** — segment order reverses; arrow-key direction reverses. **Corrected 2026-09-08:** the arrow-key reversal is not automatic — same root cause and same fix as `SubTabBar`'s identical note above (§10.1); `ToggleRow` passes the resolved direction to `ToggleGroup` explicitly, verified by `toggle-row.test.tsx` under both directions.

### `Card` — wireframe §3.1: *white, thin border, title + mono sub-line; one record*

The single most-repeated unit in the system — agents (B2), sources (B6 tab 1), MCP servers and connectors (B3/B5), rules (B8), users (B9), campaigns (B10), policies (B12), golden sets (B13), environments (B14).

- **Anatomy** — `--card` surface, `--card-border` hairline, `--card-radius`, `--card-padding`; header row of *title* (`--text-md`, `--font-weight-semibold`) + `Badge` at inline-end; a `MonoSubLine` beneath the title carrying the record's identity (`v1.4 · SEWA · 412/day`, `mcp://customs.shj.ae`, `TXN-88213`); optional body; optional footer action row; optional expandable region (B2's inline version history).
- **Variants** — `default`, `interactive` (whole card is a link/button — then the card itself is the focusable element and inner actions are excluded from the hit area), `selected` (`--accent` surface + `--primary` inline-start rail, used for B8's selected ticket), `nested` (inside a pane, `--shadow-none` + `--border` only), `metric` (see `KpiTile`).
- **States** — default / hover (`--shadow-md`, `interactive` only) / focus-visible / selected / disabled / loading (skeleton keeps the card's height) / error (`--destructive` inline-start rail + message).
- **Tokens** — `--card*`, `--border`, `--muted-foreground`, `--shadow-sm`.
- **a11y** — heading level is a prop, never hardcoded, so a card inside a tab panel produces a correct outline. `interactive` cards are `<a>` or `<button>`, never a `div` with `onClick`. Expandable regions use `aria-expanded` + `aria-controls`.
- **RTL** — the badge moves to inline-start of the header row; the selected rail moves to the inline-start edge, which is the right edge under RTL.

### `SummaryStrip` — wireframe §3.1: *grey box at the bottom of a pane stating the business rule or live consequence*

This is the wireframe's most distinctive component and it carries load-bearing meaning, most sharply in **B13 tab 3**, where it reports the live consequence of the publish gate: *"Gate is active. **General FAQ Agent v3.0** is currently blocked — Arabic parity at 71% is below the 85% floor."* Switching the gate off rewrites it to *"Any agent can be published regardless of test results."* It is not a static help note; it is a computed statement about the system's current state, and it must recompute whenever its inputs change.

- **Anatomy** — `--summary-strip-surface` (`--surface-sunken`) block at the block-end of a pane, 3px `--border-strong` rail on the **inline-start** edge, `--text-sm`, `--leading-relaxed`, optional leading `Icon`, inline `<strong>` emphasis on the named entity and the number.
- **Variants**
  - `rule` — a static business rule that explains the pane (B3 step 4's tool-permission boundary; B11 tab 2's "step-up happens *before* the tool call").
  - `consequence` — computed and reactive. Recomputes from the same state the controls above it write. B13 tab 3, B3 step 4's live count of attached skills / bound MCP tools / API connectors, B5 tab 4's degraded-mode statement.
  - `blocking` — a `consequence` that currently prevents an action. `--warning-subtle` surface, `--warning-strong` rail, and for **every** failing condition it must name all four of: what is blocked, the measured value, the threshold missed, and the screen the figure comes from. B13's rule (*"the gate explains why something is blocked rather than only that it is"*) is encoded as a required prop shape — a non-empty array of `{ blocked, measured, threshold, source }`, so a `blocking` strip cannot be constructed without them, and cannot be constructed carrying only the first of several failures. That array, rather than a single condition, is the mitigation for RISK-007; see §11.7.
  - `pointer` — states where a condition is handled elsewhere and links there. B14 tab 3's *"SEWA bill API is degraded — its circuit breaker is configured under Tools → Resilience & fallbacks"* renders as a `pointer` strip with a real in-app link.
- **States** — default / recomputing (`aria-busy`, previous text retained rather than blanked — a strip that flashes empty loses the reader's place) / blocking / error (the strip could not be computed — say so; never render a stale consequence as if current).
- **Tokens** — `--surface-sunken`, `--border-strong`, `--muted-foreground`, `--foreground`, `--warning-subtle`, `--warning-strong`, `--space-4`, `--radius-md`.
- **a11y** — `role="status"` with `aria-live="polite"` for `consequence` and `blocking` variants, so a screen-reader user hears the gate change when they toggle it. `rule` variants are plain prose with no live region. The blocking strip is additionally referenced by `aria-describedby` from the disabled Publish button, so the reason is announced at the control that is blocked.
- **RTL** — the rail moves to the inline-start (right) edge. Numbers inside remain LTR-isolated (§11.3): *"71%"* must not reorder next to Arabic text.

### `KpiTile` — a single-range dashboard tile (originally scoped to B1 tab 1's four metrics)

**Not actually consumed by B1 tab 1 — confirmed as a deliberate divergence, not a gap (2026-09-10).** `docs/SHJ3-wireframes-guide.md`'s real B1 tab 1 section is a literal 4-row × 3-column table (`Today`/`Last 7 days`/`Last 30 days` as three *permanent* columns shown at once, not three states of one toggled view), which this tile's anatomy — one value, one delta, one sparkline, all for a single range — cannot represent without losing the simultaneous 3-way comparison. `command-centre/overview-tab.tsx` correctly renders that KPI grid as a `DataTable<KpiTableRow>` instead (§5.5 #41). This entry's prose below was written generically for "a dashboard KPI tile" before that reconciliation; the component is real, built, and unit-tested, and remains the right choice for any future single-range dashboard tile this codebase adds (one selected range at a time, with a trend/delta against a prior period) — just not this specific screen.

- **Anatomy** — label (`--text-xs`, `--muted-foreground`, `--tracking-wide`, uppercase), value (`--text-2xl`, `--font-weight-semibold`, `--font-mono` tabular figures so a re-render does not jitter the digits), delta with direction glyph + word (`▲ up 3 pts`), optional sparkline.
- **Variants** — `default`, `with-delta`, `with-sparkline`, `inverted-good` (a metric where *down* is good — B1's tool error rate at 3.1%; the delta colour inverts, and the accompanying word changes from "up/down" to "worse/better" so the meaning survives without colour).
- **States** — default / loading (skeleton at fixed height) / error / empty (`—`, with `aria-label="no data for this range"`).
- **Tokens** — `--card*`, `--muted-foreground`, `--success-strong`, `--destructive-strong`, `--chart-1`, `--radius-xl`.
- **a11y** — the tile is a `<figure>` with a `<figcaption>`; the delta's meaning is in text, never only in colour or arrow direction. Grid is 4 → 2 (≤1080px) → 1 (≤560px) per §7.3.
- **RTL** — the grid reverses; the sparkline's time axis does **not** mirror (§11.5); tabular numerals stay LTR.

### The remaining 14 molecules

| # | Component | Purpose / where | Variants | States beyond the standard eight | a11y / RTL notes |
|---|---|---|---|---|---|
| 26 | `FormField` | Label + control + help + error, one wiring point | `stacked`, `inline`, `horizontal` | — | Generates `id`/`htmlFor`/`aria-describedby`/`aria-invalid`. The only sanctioned way to render a labelled control; a bare `Input` in feature code fails review |
| 27 | `SearchField` | B6 tab 2's live entity search, B1's transcript search | `default`, `with-scope` | `searching`, `no-results` | Debounced; results count announced in a polite live region. `Escape` clears |
| 28 | `Slider` | B6 tab 3's 60/40 hybrid weighting, radius & shadow controls in §9 | `single`, `range`, `stepped` | — | Radix Slider. Live numeric label is mandatory, not a tooltip-only value. Arrow/PageUp/Home/End. **Reverses under RTL — not automatically: verified false as originally stated (2026-09-08), see §10.1. `Slider` resolves and passes `dir` explicitly itself, so callers still get correct reversal for free** |
| 29 | `FilterBar` | B1 tab 2, B8, B11 tab 4, B14 tab 2 | `chips`, `dropdowns`, `mixed` | `active-filters`, `cleared` | Active filters render as removable chips with `aria-label="remove filter: Escalated"`; result count in a live region |
| 30 | `DropdownMenu` | Row actions (B2's Clone/Publish/Archive, B9's Suspend/Remove) | `default`, `with-destructive-group` | — | Radix DropdownMenu. Destructive items are grouped last behind a separator and require a confirm dialog. `side`/`align` are logical |
| 31 | `Combobox` | Long lists — agent picker, entity picker, node parent (B6 "+ Add node") | `single`, `multi`, `async` | `loading`, `no-results`, `creating` | Radix Popover + `cmdk`. `aria-autocomplete="list"`, active option via `aria-activedescendant` |
| 32 | `ChipInput` | B10 tab 2's allowed domains, tags | `default`, `validated` | `invalid-entry`, `duplicate` | Each chip's remove button is separately focusable and labelled. `Backspace` on empty input removes the last chip |
| 33 | `Pagination` | `DataTable` footer | `numbered`, `cursor`, `load-more` | — | `<nav aria-label="pagination">`; current page has `aria-current="page"`. Chevrons mirror under RTL |
| 34 | `CodeBlock` | B10's embed snippet, B3's sample JSON, B6's playground output | `snippet`, `json`, `trace` | `copied` | Always `dir="ltr"`. Copy button labelled, confirmation in a live region, and the confirmation text is real ("Copied to clipboard") — B10 requires *"a Copy button with confirmation feedback"* |
| 35 | `EmptyState` | Every list, every canvas | `first-run`, `no-results`, `no-permission`, `error` | — | Headline + one-line cause + the single action that resolves it. `no-permission` names the role required (B9's matrix is the source of truth) |
| 36 | `InlineAlert` | Non-blocking notice inside a pane | `info`, `warning`, `destructive`, `success` | `dismissible` | `role="status"` (info/success) or `role="alert"` (warning/destructive). Icon **and** a text prefix word |
| 37 | `ToastItem` | Async outcome — "Re-index started", "Promotion approved" | `info`, `success`, `destructive`, `with-action` | `paused-on-hover` | Radix Toast at `--z-toast`. Min 6s, extended under reduced motion; never the only record of a destructive outcome |
| 38 | `MessageMetaRow` | A1/A2/A3 — *"per-message speaker (TTS), thumbs up, thumbs down, timestamps"* (§2.2) | `assistant` (full), `user` (timestamp only), `system` (note) | `rated-up`, `rated-down`, `speaking` | Three real `IconButton`s with labels "Read aloud", "Good response", "Poor response". Rating is a two-state toggle group with `aria-pressed`. `speaking` state announces politely and offers "Stop". Timestamp is a `<time datetime>` |
| 39 | `StatusCell` | The table-cell form of `Badge` + `MonoSubLine` | `badge`, `badge-with-detail`, `dot-with-label` | — | Sortable by status *rank*, not alphabetically — B13's `Failed` must sort to the top |
| 40 | `DateRangeToggle` | B1's `Today / Last 7 days / Last 30 days` | `segmented` | `loading` | A `ToggleRow` with URL state, so a range is shareable. Range change re-renders all three B1 panels and announces "Showing last 7 days, 8,940 conversations" |

## 5.5 Organisms (17)

### 41 · `DataTable` — one TanStack Table wrapper, reused everywhere

ADR-0007 is explicit: *"TanStack Table must be wrapped once, well, and reused across all 14 screens rather than assembled per screen."* This component is that wrapper. Screens it serves: B1 tab 2 (conversation explorer), B1 tab 3 (both queues), B2 (agent registry), B3 sub-tabs B and C, B5 tabs 1–4, B6 tab 1 and tab 4, B8 (escalation queue, routing rules), B9 tabs 1–2, B10 tabs 1, 3, 4, 5, B11 tab 3 and tab 4, B13 tabs 1–2, B14 tabs 1–3. **A screen that assembles its own table fails review.**

- **Anatomy** — optional `FilterBar`; column header row (sticky, `--table-header-surface`, `--z-sticky`, `--shadow-xs` when scrolled); body rows at `--table-row-height`; per-row action slot (inline `Button`s or a `DropdownMenu`); optional expandable row region; footer with `Pagination` and a selection summary.
- **Variants** — `default`, `expandable` (B1's inline transcript, B2's version history), `selectable` (checkbox column; the wireframe lists bulk operations as a gap in §8 — the wrapper supports it and screens opt in), `reorderable` (B8's routing rules: Move up / Move down), `editable-cell` (B12 tab 2's override values), `grouped` (B9 tab 2's team membership), `virtualised` (auto-enabled above 200 rows).
- **States** — default / loading (row skeletons at the real row height, so the page does not jump) / empty (`EmptyState`, variant chosen from *why* the table is empty) / error (retry action, and the error text says which query failed) / filtered-empty (`no-results` with a "clear filters" action) / row-hover / row-selected / row-focused / saving (optimistic row with `aria-busy`).
- **Tokens** — `--table-*`, `--card`, `--border`, `--muted`, `--accent` (row hover/selected), `--ring`, `--row-height`, `--space-3`.
- **a11y**
  - A real `<table>` with `<caption>` (visually hidden when a heading already names it), `<thead>`, `<th scope="col">`, and `<th scope="row">` on the identifying column.
  - Sortable headers are `<button>` inside `<th>` with `aria-sort="ascending|descending|none"`; sorting announces the new order politely.
  - **Cell-level keyboard navigation is not used.** Rows are the navigable unit: `Tab` reaches the row's interactive elements in DOM order; `ArrowUp`/`ArrowDown` move between rows when the table is `selectable` or `reorderable` (with `aria-activedescendant`). Full 2D grid navigation is reserved for `PermissionMatrix`, which needs it; imposing it on 20 tables costs more than it gives.
  - Reorder controls are real buttons ("Move rule 2 up"), and the new position is announced ("Priority = High is now rule 1 of 4"). Drag-and-drop, if added, is an *additional* affordance, never the only one.
  - Row density follows `--density-scale`; the horizontal scroll container is focusable (`tabindex="0"`) with an `aria-label` so keyboard users can scroll it.
- **RTL** — column order reverses; the sticky column (if any) sticks to inline-start; sort glyphs and pagination chevrons mirror; **numeric and mono columns keep `dir="ltr"`** so `AED 412.00` and `TXN-88213` do not reorder (§11.3). Column resize handles move to the inline-end edge of each header.
- **≤560px** — collapses to stacked cards: each row becomes a `Card` with the identifying column as the title, a `MonoSubLine` of secondary fields, and the action slot in the footer.

### 42 · `Wizard` — B3's 10 steps

The brief's core authoring tool (R7). Requirements from the wireframe: *"A progress bar plus a 10-step tab strip. Any step is directly clickable — the wizard does not force linear progress. Back and Save & continue navigate; the final step's button reads Publish agent. All state persists when moving between steps."*

- **Anatomy** — `ProgressBar` (`segmented` variant, 10 segments, plus a numeric "Step 4 of 10 · 40% complete"); a sticky step strip (`--z-sticky`) of 10 step chips, each showing index, short name and a completion glyph; the step pane; a footer action bar with `Back`, `Save & continue` / `Publish agent`, and a "Save draft" affordance.
- **Variants** — `linear` (unused here, retained for future flows), `free-navigation` (B3's actual behaviour), `nested-subtabs` (step 4 hosts a `SubTabBar`).
- **States per step** — `untouched`, `in-progress`, `complete`, `invalid` (visited and failed validation — `--destructive-strong` glyph **and** the word "Needs attention" in the chip's accessible name), `blocked` (step 10 when the B13 publish gate is closed — the step is reachable and *shows the reason* via a `blocking` `SummaryStrip`; only the Publish button is disabled).
- **Tokens** — `--primary`, `--accent`, `--muted-foreground`, `--destructive-strong`, `--wizard-step-indicator-size`, `--z-sticky`, `--card*`.
- **State persistence** — the wizard's draft is a server-side draft record keyed by agent id, written on step change and on a 5s debounce within a step (React Hook Form + Zod per §9 of `architecture.md`; the same Zod schema validates in the route handler). Navigating away and returning restores the draft. Cross-field validation runs per step; the Publish step re-validates *all* steps and lists every failure with a link to the offending step.
- **a11y** — the step strip is `role="tablist"` with `aria-label="Agent designer steps"`; each chip's accessible name is `"Step 4 of 10: Skills & tools — in progress"`, so state is never glyph-only. Changing step moves focus to the step pane's heading. `Ctrl+Enter` submits the current step. Progress is a `progressbar` with a real numeric value. An unsaved-changes guard intercepts navigation.
- **RTL** — the step strip reverses and the progress bar fills from the inline-start (right) edge; `Back` sits at inline-start, primary action at inline-end, in both directions.
- **≤820px** — the step strip becomes a `Select` ("Step 4 of 10: Skills & tools") plus prev/next arrows; the progress bar remains.

### 43 · `PermissionMatrix` — B9 tab 3's 7 roles × 8 permissions

56 toggles in a grid, and the screen that *"determines what every other screen permits"*. This is the hardest keyboard problem in the product and it gets an explicit model.

- **Anatomy** — a `<table>`; row headers are the 8 permissions (`--matrix-header-inline-size`, sticky inline-start); column headers are the 7 roles (sticky block-start, rotated only above `--bp-lg`, never rotated below — rotated text is unreadable at small sizes); each cell is a `Checkbox` at `--matrix-cell-size`; a trailing "+ Add custom role" column action.
- **Variants** — `default`, `read-only` (a role without `Manage users & teams` sees the matrix but cannot edit — cells render as check/dash glyphs, not disabled checkboxes, because 56 disabled controls is 56 pointless tab stops), `with-locked-cells` (a permission a role structurally cannot hold).
- **States** — cell: unchecked / checked / focused / disabled-locked / saving (optimistic, `aria-busy` on the cell) / failed (reverts with an `InlineAlert` naming the cell). Grid: loading / error / dirty (unsaved) / saved.
- **Tokens** — `--card`, `--border-strong` (cell grid — must be 3:1, this is where `--border` alone would fail 1.4.11), `--primary`, `--accent` (row/column crosshair highlight), `--matrix-*`, `--surface-sunken` (header).
- **Keyboard model** — `role="grid"`, one tab stop for the whole grid, `aria-activedescendant` tracking the focused cell:

  | Key | Action |
  |---|---|
  | `Tab` / `Shift+Tab` | Enter / leave the grid entirely |
  | `Arrow` keys | Move one cell (reversed horizontally under RTL) |
  | `Home` / `End` | First / last cell in the row |
  | `Ctrl+Home` / `Ctrl+End` | First / last cell in the grid |
  | `PageUp` / `PageDown` | Move 5 rows |
  | `Space` | Toggle the focused cell |
  | `Shift+Space` | Toggle the entire row (all roles for this permission) |
  | `Ctrl+Space` | Toggle the entire column (all permissions for this role) |
  | `Ctrl+Z` | Undo the last toggle, including a row/column bulk toggle |

- **a11y** — each cell's accessible name is composed from both headers plus state: `"Publish agents, Agent Designer, not granted"`. On toggle, a polite live region announces the new value and the running total (`"Agent Designer now has 2 of 8 permissions"`). A crosshair highlight (`--accent` on the focused cell's row and column) is present for sighted keyboard users and is **not** the only indicator — the focus ring is. B9's rule — *"Agent Designer can build but not publish"* — is surfaced as a `rule` `SummaryStrip` beneath the matrix, and any edit that would grant `Publish agents` to a non-admin role raises a confirmation naming the separation-of-duties rule it breaks.
- **RTL** — column order reverses; the sticky permission column sticks to the inline-start (right) edge; horizontal arrow semantics reverse.
- **≤820px** — one `Card` per role containing 8 `Switch` rows. The grid semantics are dropped rather than compressed; a 7-column grid on a phone is unusable either way.

### 44 · `GraphCanvas` — B6 tab 2's entity graph

*"The graph is generated from data, not static markup, so additions appear immediately."* Entities: Service, Provider, Fee, Document, Channel. Rendered as inline SVG from a node/edge model (§7.1).

- **Anatomy** — SVG canvas on `--graph-canvas-surface` with a `--graph-grid-line` grid; nodes as rounded rects (`--graph-node-radius`) with a type glyph, a label and a type-coloured inline-start rail from `--chart-1…5` (one per entity type); edges as paths with `--graph-edge-stroke` and a relationship label; a `SearchField` that dims non-matching nodes; a zoom/fit control cluster; a detail panel for the selected node; a duplicate-detection list (`SEWA ↔ Sharjah Electricity & Water Authority`) with Merge / Ignore.
- **Variants** — `explore` (default), `focus` (one node's neighbourhood), `readonly`.
- **States** — loading / empty (`EmptyState` with "+ Add source" — a graph with no sources is a knowledge-configuration problem, and the empty state says so) / error / node-hover / node-selected / node-dimmed (search miss) / edge-highlighted / merging.
- **Tokens** — `--graph-*`, `--chart-1…6`, `--card`, `--border-strong`, `--ring`, `--popover*`.
- **a11y** — the canvas is **not** the only representation. It ships with a mandatory, always-present **list view** toggle rendering the same model as a `DataTable` of entities with a relationships column; this is the conformant path for screen readers and the only path for keyboard users who cannot pan. The SVG itself is `role="application"` with `aria-label` and an internal roving-tabindex model: `Tab` enters the graph at the selected or first node, `Arrow` keys move to the nearest neighbour node in that direction, `Enter` opens the node's detail panel, `Escape` returns focus to the canvas, `+`/`-` zoom, `0` fits. Every node has an accessible name of the form `"Provider: SEWA, 3 relationships"`. Node type is encoded by glyph **and** label prefix as well as colour. Duplicate-detection merges require a confirmation dialog naming both entities, because a merge is destructive.
- **RTL** — the *layout* (toolbar, search, detail panel) mirrors; the **graph itself does not mirror** — an edge direction is data, and flipping the canvas would reverse the meaning of `Service → Provider`. Node labels render RTL when the label is Arabic (`dir="auto"` on the SVG text). Arrow-key semantics still reverse.

### 45 · `FlowCanvas` (`FlowCanvasGraph`) + 46 · `NodeInspector` — B7's flow designer

Nodes: Message, Question, Tool call, Handover, Condition. *"Clicking any node loads its inspector panel."*

Ships on `@xyflow/react` (`apps/web/src/components/patterns/flow-canvas-graph/`) — a real, freeform, draggable/zoomable/pannable interactive canvas, replacing an earlier static CSS-Grid + plain-SVG-line renderer (`components/patterns/flow-canvas/flow-canvas.tsx`, retired). Node position (`canvasX`/`canvasY`, real non-null `FlowNodes` columns) is committed on drag-release via `updateFlowNodeAction`'s existing partial update; dragging one connection handle to another opens the real, schema-accurate edge dialog pre-filled with both endpoints, in place of the generic `NodeInspector` form for that step.

- **Anatomy** — a freeform `@xyflow/react` canvas; typed nodes at `--flow-node-inline-size` with a header (type badge + title), a body summary and inline-start/inline-end connection ports (xyflow `Handle`s, side flipped per resolved direction — see RTL below); curved connectors with arrowheads and branch labels; a floating node-creation palette (`<Panel>`); pan/zoom `Controls`; the real per-type node-authoring dialog (`NodeFormDialog`/`EdgeFormDialog`, `flows-step.tsx`) opens on node/connect activation in place of the generic `NodeInspector` for both real screens — `NodeInspector` itself remains a real, available fallback for any caller that does not supply its own activation handler.
- **Node type tokens** — Message `--chart-5` · Question `--chart-2` · Tool call `--chart-1` · Handover `--warning` · Condition `--chart-6`. Each node also carries its type as a text badge, so the five types are distinguishable without colour.
- **Variants** — canvas: `edit`, `readonly` (drag/connect/palette all disabled), `trace-overlay` (a golden-set case's path highlighted over the flow — this is how B13 and B7 connect). Inspector: per node type, five distinct forms.
- **States** — node: default / hover / selected / invalid (unreachable, or a required field missing) / breakpoint / executing (in `trace-overlay`). Canvas: loading / empty / error. Inspector: clean / dirty / invalid / saving.
- **Tokens** — `--flow-*` (including `--flow-canvas-graph-block-size`, the canvas's own required explicit block-size), `--card*`, `--border-strong`, `--warning`, `--chart-*`, `--ring`, `--z-modal` (inspector as a sheet ≤820px). xyflow's own `--xy-*` theming variables are remapped to these same real tokens in `globals.css` (ADR-0007's "replace, not extend" pattern applied to a vendor stylesheet) — never xyflow's own literal defaults.
- **Validation surfaced at publish, not continuously on the canvas** — the flow's own rule from B7 (*the condition node "exits the flow at any point and returns control to the router"*, R3) used to render as an always-visible `blocking` `SummaryStrip` on the canvas; the product owner asked for the canvas decluttered instead. R3, alongside the two DB-enforced completeness rules (an entry node must be set, `CK_FlowVersions_publishedHasEntry`; an escape node must be set, `CK_FlowVersions_publishedHasEscape`), is now checked only when the author clicks **Publish** (`flows-step.tsx`'s header row, `publishFlowVersionAction` in `agents/actions.ts`) — a failed check is reported as a field/reason-specific blocking message at that point, not a persistent canvas banner. Publishing transitions the `FlowVersion` from `Draft` to `Published` (a real, previously-unbuilt transition — `FlowVersion.status` stayed `Draft` forever before this), then immediately re-opens a fresh, editable Draft so authoring continues without disruption.
- **a11y** — same dual-representation rule as `GraphCanvas`: a mandatory list/outline view of nodes and their connections, keyboard-complete. On the canvas, roving tabindex across nodes in topological order re-implemented over xyflow's own rendered node elements (xyflow's native keyboard handling moves a focused node's position on arrow keys, which is not this contract, so this canvas supplies its own topological handler instead); `Arrow` moves along connections (`ArrowDown` = next node in flow, `ArrowUp` = previous, left/right = sibling branches); `Enter` opens the inspector/dialog and moves focus into it; `Escape` returns focus to the originating node — focus return is mandatory. Connections are announced (`"Tool call: Fetch bill by account #, 1 input from Question, 2 outputs to Handover and Condition"`).
- **RTL** — toolbar, palette and inspector mirror (the palette's `<Panel>` position and each node's connection-handle sides are computed from the resolved direction, since xyflow's own `Position`/`PanelPosition` values are physical, not logical, and do not auto-mirror). **Flow direction does not mirror**: the canvas keeps top-to-bottom / inline-start-to-inline-end flow, and arrowheads keep their data-defined direction — this is xyflow's real default (it is coordinate-system-agnostic), not a special case coded for this app. At ≤820px the canvas flips to a vertical stack (matching §7.3's orchestrator behaviour) and the inspector becomes a bottom sheet.

### 47 · `DiffTraceViewer` — B4 and A2's agent trace, B2's version diff

One component serving three jobs: A2's diagnostics rail (*"Routing decision with confidence, tools invoked with arguments, secondary agents consulted, pending slot"*), B4's three execution-mode traces, and B2's version history diff.

- **Anatomy** — an ordered list of trace steps; each step has a type glyph, a mono primary line (`router → billing_agent (confidence 0.94)`), an optional expandable payload (`CodeBlock`, `json` variant), a duration, and a status. Diff mode renders paired added/removed lines with `--success-subtle` / `--destructive-subtle` fills **and** `+`/`−` gutter markers.
- **Variants** — `trace` (A2's rail), `orchestration` (B4 — additionally shows fan-out/fan-in structure for parallel and supervisor–worker modes), `diff` (B2), `grounding` (A2's Sources panel: source document, freshness, entity path `Service(Pay utilities bill) → Provider(SEWA) → Fee`).
- **States** — collapsed / expanded / streaming (steps append live; the list is a polite live region that announces only the *latest* step, not the whole list) / empty (*"No grounding needed — static template"*, A2 step 1 — a real, meaningful empty state) / error.
- **Tokens** — `--font-mono`, `--text-xs`, `--surface-sunken`, `--muted-foreground`, `--success-subtle`, `--destructive-subtle`, `--border`, `--chart-1…4` (step type).
- **a11y** — an `<ol>`, so step order is conveyed structurally. Diff added/removed use `<ins>`/`<del>` plus the gutter marker — never fill colour alone. Confidence values are text (`confidence 0.94`), not a bar. Each expandable step is a `<button aria-expanded>`.
- **RTL** — the rail moves to the inline-start edge; **every trace line stays `dir="ltr"`** because it is code (§11.3). Fan-out diagrams keep their direction.

### 48 · `ChatThread` — A1, A2, A3, B1 tab 2's inline transcript, B8's ticket transcript

- **Anatomy** — a scroll region of turns; each turn is a bubble plus a `MessageMetaRow`; system notes render as centred `--muted-foreground` rules (*"Escalated to human agent — full context transferred"*); suggestion chips attach beneath an assistant turn; a dismissible disclaimer banner pins at the block-start.
- **Bubble geometry** — user: `--chat-user-bubble`, aligned inline-end, `--chat-bubble-radius` with the inline-end block-end corner squared. Assistant: `--chat-assistant-bubble`, aligned inline-start, inline-start block-end corner squared. `max-inline-size: var(--chat-bubble-max-inline-size)`.
- **Variants** — `live` (A1/A2/A3), `transcript` (read-only, with a redaction footer — B1's *"outcome/rating/PII-redaction footer"*), `whatsapp` (see `AssistantWidgetShell`), `handover` (B8, with the escalation-reason header pinned above the thread).
- **States** — idle / streaming (assistant turn appends token-wise) / thinking (A3's `"◐ Still thinking…"` banner + `--chat-typing`) / escalated (A3's `--success-subtle` banner: *"Escalated · queue position 2 · agent context transferred"*; composer paused) / error (a turn failed — retry on the turn, not the thread) / empty (greeting only).
- **Tokens** — `--chat-*`, `--radius-lg`, `--space-3`, `--muted-foreground`.
- **a11y** — the thread is `role="log"` with `aria-live="polite"` and `aria-relevant="additions"`, so a new assistant turn is announced without re-reading the transcript. Streaming turns are announced **once on completion**, not per token — the interim text is in the DOM but inside `aria-live="off"` until the turn finalises. Speaker/thumbs controls are labelled per `MessageMetaRow`. New turns move the scroll position but **never** move focus away from the composer. Turn author is conveyed by a visually hidden `"SHJ3 Assistant said:"` / `"You said:"` prefix, since alignment and tint are visual-only signals.
- **RTL** — the alignment inverts by construction (`inline-end` for the user), so Arabic threads read correctly with no extra code. Squared corners follow. `dir="auto"` per bubble, so a user's Arabic reply in an English session renders RTL inside an LTR thread (§11.3).

### 49 · `Composer` — the assistant's input

- **Anatomy** — auto-growing `Textarea` (placeholder *"Ask SHJ3 Assistant"*), mic `IconButton`, send `IconButton`, optional attachment slot, and a status line beneath for A3's live transcription (*Listening — "my account number is…"* with a recording dot).
- **Variants** — `web`, `whatsapp` (rounded field, WhatsApp mic placement), `paused` (A3's *"Composer paused — a live agent has joined"* — the field is disabled with the reason as visible text, not a tooltip), `voice-active`.
- **States** — empty / typing / sending / paused / listening (recording dot, interim transcript, `aria-live="polite"` on the interim text so a blind user hears what was heard before committing) / mic-denied (permission refused — an `InlineAlert` explaining how to re-grant, not a silent dead mic) / error.
- **Tokens** — `--chat-composer`, `--border-strong`, `--input-radius`, `--primary`, `--destructive` (recording dot), `--ring`.
- **a11y** — `Enter` sends, `Shift+Enter` newlines, and this is stated in a visually hidden hint associated with the field. The mic button is a toggle with `aria-pressed` and labels "Start voice input" / "Stop voice input". The recording indicator is a dot **and** the word "Recording". Send is never the only submit path.
- **RTL** — mic at inline-start, send at inline-end in both directions; the field is `dir="auto"`.

### 50 · `AssistantWidgetShell` — A1's three renderings

*"One assistant renders correctly across surfaces."* Docked (400px), Expanded (560px), WhatsApp. The toggle between them is a `ToggleRow` in the wireframe's demo harness; in production, `defaultState` comes from B10 tab 2 and the user's own expand/minimise action.

- **Anatomy** — a container query root (`container-type: inline-size`); header (sparkle mark, "SHJ3 Assistant", minimise `–`, expand `⧉`); disclaimer banner with `×`; `ChatThread`; `Composer`; and a floating launcher FAB outside the shell.
- **Renderings**

  | Rendering | Inline size | Differences |
  |---|---|---|
  | `docked` | 400px | `--shadow-lg`, `--radius-xl`, suggestions render as wrapped `SelectablePill` chips, bubble type at `--text-base` |
  | `expanded` | 560px | `--shadow-xl`, `--radius-2xl`, chips in a 2-column grid, bubble type at `--text-md`, greeting at `--text-3xl`. **Thread and scroll position are retained across the transition** — the shell must not remount, so the transition is CSS on the container, not a conditional render |
  | `whatsapp` | full frame | Structural, not cosmetic (A1's `[rule]`). No chip component exists: suggestions render as a **list message** of stacked rows. Adds a business-account header, an opt-in notice, a session marker (*"24-hour session window open"*), and a WhatsApp-style composer. Colours come from a fixed, non-themable `whatsapp` token block — a tenant may not re-brand WhatsApp's chrome, and the skin schema rejects attempts to |
  | `fullscreen` | ≤560px viewport | Docked goes full-bleed; the FAB is replaced by a close button in the header |

- **States** — closed (FAB only) / opening / open / minimised / expanded / offline (channel disabled in B10 tab 1 — *"Disabling a channel stops new conversations immediately; open conversations are allowed to finish"*, so an in-flight thread stays usable while a new one is refused with an explanation) / degraded (B5 tab 4's message: *"Some services are slow right now…"*).
- **Tokens** — `--chat-*`, `--card`, `--shadow-lg`/`xl`, `--radius-xl`/`2xl`, `--z-modal`, `--primary` (header mark, FAB).
- **Tenant theming caveat** — the widget is embedded in `sharjah.ae` (`architecture.md` §9). Its tokens are injected into a shadow root, so the host page's CSS cannot bleed in and the widget's tokens cannot leak out. The embed snippet from B10 tab 2 carries the tenant id, and the theme is resolved server-side for that tenant — the widget never fetches a theme client-side (§9.4).
- **a11y** — the FAB is a labelled toggle with `aria-expanded`. Opening moves focus to the shell's heading; the shell is a `<dialog>`-like region with `aria-modal="false"` (the portal behind it stays usable — A1's docked state *"overlays portal content without navigation loss"*). `Escape` minimises. Focus returns to the FAB on close. Minimise/expand controls are labelled with words, not glyphs alone.
- **RTL** — the whole shell mirrors, including the FAB corner (B10 tab 2's "Bottom right / Bottom left" is stored as a *logical* preference, `inline-end` / `inline-start`, so an Arabic page places it correctly without a second setting).

### The remaining 7 organisms

| # | Component | Purpose / where | Notes |
|---|---|---|---|
| 51 | `AppShell` | Sidebar (grouped "Assistant window" / "Admin / configurator"), header with breadcrumb, locale switch, theme mode switch, and the persistent **Help icon** Phase F mandates | Skip link to main; `<nav aria-label>` per group; `aria-current="page"`; collapses to horizontal nav at ≤820px (§7.3). `--sidebar-style` variants: `neutral`, `brand`, `contrast` |
| 52 | `DiagnosticsRail` | A2's right-hand rail: `DiffTraceViewer` (`trace`) + (`grounding`) | Collapses below the thread at ≤1080px (§7.3) — it is context, not content, so it goes second in DOM order and needs no reorder |
| 53 | `Dialog` / `Sheet` | Confirmations, `NodeInspector` on small screens, "+ Add" forms | Radix Dialog. Focus trap, `Escape`, focus return, `aria-labelledby`/`aria-describedby`. Destructive confirmations restate the object by name and require the primary action, never a bare "OK" |
| 54 | `RuleListEditor` | B8's routing rules + rule tester; B12's policy list | Order is meaning (*"top to bottom; first active match wins"*), so precedence is shown as an explicit numbered column and every reorder announces the new order. The tester evaluates the **live** list including unsaved reorders, and says which rule fired |
| 55 | `SkinEditor` | Settings → Appearance (§9) | The only screen permitted to write raw colour values, and it does so into token slots via a validated form — not into class names |
| 56 | `HelpGuideShell` | Phase F: side menu mirroring app navigation, one entry per page, search, deep links | Built from the same nav model as `AppShell`, so a new route with no guide entry is detectable in CI (§12.6) |
| 57 | `ChartFrame` | B1's channel-split bars, top-intents list, KPI sparklines | Wraps the chart library once. Mandatory: accessible title + description, a data-table fallback behind a "View as table" toggle, `--chart-1…6` plus pattern fills, direct labels in preference to a legend. Time axes do **not** mirror under RTL (§11.5) |

---

# 6. Status & meaning

## 6.1 The rule

> **Status is never carried by colour alone.** Every badge carries a text label. Every chart series carries a pattern as well as a hue. Every delta carries a word as well as an arrow. Every toggle carries a position as well as a fill.

The wireframe already commits to this (§7.4: *"Status never carried by colour alone — every badge also carries a text label"*). Three reasons it is hardened into a token contract here rather than left as a convention:

1. **WCAG 1.4.1** (Use of Colour) requires it.
2. **Tenant re-branding breaks colour semantics.** A tenant may set `--primary`; if `Healthy` were "the green one", a tenant with a red brand would ship a red `Healthy` badge. The label is what survives.
3. **B14 tab 3 and B5 tab 4 describe the same incident in two places.** `Degraded` in observability and `Open — fallback active` in the breaker table must be recognisably the same event to an operator who cannot distinguish rust from green.

Mechanically: `Badge` has no children-less form. `<Badge variant="success" />` does not type-check — `label` is a required prop.

## 6.2 The status vocabulary

Every status string in the 17 screens, mapped to a token family and a label. Three families, plus neutral.

| Status label | Family | Token pair | Where it appears |
|---|---|---|---|
| `Active` | success | `--success-subtle` / `--success-strong` | B9 tab 1 user status, B2 |
| `Live` | success | ″ | B10 tab 1 channels, B11 tab 3 gateway, B14 tab 1 production |
| `Published` | success | ″ | B2 agent status |
| `Approved` | success | ″ | B10 tab 3 templates |
| `Passed` | success | ″ | B13 tab 2 regression result |
| `Healthy` | success | ″ | B14 tab 3 observability |
| `Closed — healthy` | success | ″ | B5 tab 4 circuit breaker |
| `Connected` | success | ″ | B3/B5 MCP servers |
| `Tested` | success | ″ | B3/B5 API connectors |
| `Settled` | success | ″ | B11 tab 4 transactions |
| `Refunded` | success | ″ | B11 tab 4 |
| `Resolved` | success | ″ | B1 tab 2 conversation outcome |
| `Verified` | success | ″ | B8 customer context, B11 |
| `Complete` | success | ″ | B3 wizard step state |
| `On` | success | ″ | B10 tab 4 campaigns, all switches |
| `Draft` | warning | `--warning-subtle` / `--warning-strong` | B2, B3 step 6 flows, B10 |
| `Pending review` | warning | ″ | B10 tab 3 templates |
| `Awaiting approval` | warning | ″ | B14 tab 1 promotions |
| `Invited` | warning | ″ | B9 tab 1 |
| `Untested` | warning | ″ | B3/B5 connectors |
| `Not connected` | warning | ″ | B3/B5 MCP servers |
| `Sandbox` | warning | ″ | B11 tab 3 SEWA direct debit |
| `Refund requested` | warning | ″ | B11 tab 4 |
| `Running` | warning | ″ | B6 tab 3 re-index jobs |
| `In progress` | warning | ″ | B3 wizard step state |
| `Not verified` | warning | ″ | B8 Fatima S. context |
| `Escalated` | warning | ″ | B1 tab 2, A3 |
| `Failed` | destructive | `--destructive-subtle` / `--destructive-strong` | B13 tab 2, B11 tab 4, B6 tab 3 |
| `Degraded` | destructive | ″ | B14 tab 3 |
| `Blocked` | destructive | ″ | B10 tab 4, B13 tab 3, B3 step 10 |
| `Open — fallback active` | destructive | ″ | B5 tab 4 |
| `Suspended` | destructive | ″ | B9 tab 1 |
| `Abandoned` | destructive | ″ | B1 tab 2 |
| `High` (priority) | destructive | ″ | B8 escalation queue |
| `Disabled` | neutral | `--muted` / `--muted-foreground` | B10 tab 1 channels |
| `Unpublished` | neutral | ″ | B2 |
| `Archived` | neutral | ″ | B2 |
| `Off` | neutral | ″ | switches, B10 tab 4 |
| `Offline` | neutral | ″ | B8 agent status |
| `Normal` (priority) | neutral | ″ | B8 |
| `Untouched` | neutral | ″ | B3 wizard step state |
| `Locked` | info | `--info-subtle` / `--info-strong` | B12 tab 1 locked policies |
| `Override` | info | ″ | B12 tab 2 |
| `Anonymous allowed` | info | ″ | B11 tab 2 step-up rules |
| `Rolled back` | info | ″ | B2 version history |
| `Cloned` | info | ″ | B2 version history |

`info` is reserved for *"this is a stated fact about configuration"* — it never means good or bad. That is what makes B12's `Locked` correct as info: a locked policy is neither healthy nor a problem, it is a platform floor.

## 6.3 Why a status needs two tokens, not one

The wireframe's rust `#B4553F` measures **4.46:1** against paper `#F6F5F1` — it fails WCAG AA for normal-size text by a hair, while passing at 4.87:1 as a fill with white text on it. So a single `--destructive` token cannot serve both "the fill of a Failed badge" and "the colour of the word Failed on the page background". Hence `--destructive` (fill, white text on it) and `--destructive-strong` `#9E4230` (**5.88:1** on `--background`, **5.16:1** on `--destructive-subtle`). The same split applies to all four semantic families. This is the sharpest single case where the wireframe's palette, taken literally, would not pass the gate in §10.

## 6.4 Second channels

| Signal | Colour channel | Second channel (mandatory) |
|---|---|---|
| Badge status | family tokens | The text label (§6.2) |
| Switch / toggle | `--primary` fill | Thumb position |
| Selectable pill | `--primary` fill | Check glyph + `aria-checked` |
| Sub-tab active | `--primary` underline | 2px underline geometry + `--font-weight-semibold` + `aria-selected` |
| Chart series | `--chart-1…6` | Pattern fill and a direct label |
| KPI delta | `--success-strong` / `--destructive-strong` | Arrow glyph **and** a word ("up 3 pts" / "worse by 0.7 pts") |
| Diff added/removed | `--success-subtle` / `--destructive-subtle` | `+`/`−` gutter marker and `<ins>`/`<del>` |
| Graph node type | `--chart-1…5` rail | Type glyph and a `"Provider:"` label prefix |
| Flow node type | node type tokens | A type badge in the node header |
| Required field | — | The word "Required", not only an asterisk |
| Recording | `--destructive` dot | The word "Recording" |
| Form error | `--destructive` border | Message text + `aria-invalid` + `aria-describedby` |

---

# 7. Skin JSON schema

## 7.1 What a skin is

A skin is a named, saveable preset: a JSON document of **layer-2 semantic token values plus an allowlisted subset of layer-3 tokens**, asset references, and direction/mode defaults. It never contains layer-1 primitives (§3.1) and never contains CSS.

Skins can be duplicated, edited, exported and imported. **Import is untrusted input** — an exported skin is a file a user can hand-edit or receive by email, so the import path treats it exactly as it would a request body from an anonymous caller (§7.4).

Storage: one row per skin in the tenant's own SQL schema (`sewa.AppearanceSkins`, `customs.AppearanceSkins`), so cross-tenant isolation is inherited from ADR-0002 rather than re-implemented. The two shipped skins live in `platform` and are read-only.

## 7.2 Schema (JSON Schema 2020-12)

`schemas/skin.v1.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://shj3.shj.ae/schemas/skin.v1.schema.json",
  "title": "SHJ3 Skin",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "metadata", "mode", "direction", "tokens"],
  "properties": {
    "schemaVersion": {
      "const": 1,
      "description": "Integer. Bumped only for a breaking change. A skin with an unknown version is rejected, never coerced."
    },
    "metadata": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "createdAt"],
      "properties": {
        "id":          { "type": "string", "format": "uuid" },
        "name":        { "type": "string", "minLength": 1, "maxLength": 60 },
        "description": { "type": "string", "maxLength": 280 },
        "author":      { "type": "string", "maxLength": 120 },
        "tenant":      { "type": "string", "maxLength": 60,
                         "description": "Informational only. On import this field is IGNORED and replaced with the importing principal's tenant. It can never be used to target another tenant." },
        "createdAt":   { "type": "string", "format": "date-time" },
        "updatedAt":   { "type": "string", "format": "date-time" },
        "basedOn":     { "type": "string", "maxLength": 60,
                         "description": "Name of the skin this was duplicated from." },
        "readOnly":    { "type": "boolean", "default": false,
                         "description": "Set by the platform for shipped skins. Ignored on import." }
      }
    },
    "mode":      { "enum": ["light", "dark", "system"] },
    "direction": { "enum": ["ltr", "rtl", "locale"],
                   "description": "'locale' means direction follows the active locale (the default and the recommended value). An explicit value overrides it." },
    "assets": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "appTitle":    { "type": "string", "minLength": 1, "maxLength": 60 },
        "logoLight":   { "$ref": "#/$defs/assetRef" },
        "logoDark":    { "$ref": "#/$defs/assetRef" },
        "logoMark":    { "$ref": "#/$defs/assetRef", "description": "Square mark for the collapsed sidebar and the widget header." },
        "favicon":     { "$ref": "#/$defs/assetRef" }
      }
    },
    "typography": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "fontSans":   { "$ref": "#/$defs/fontStackRef" },
        "fontMono":   { "$ref": "#/$defs/fontStackRef" },
        "fontArabic": { "$ref": "#/$defs/fontStackRef" },
        "baseSize":   { "type": "string", "pattern": "^(0\\.8125|0\\.875|0\\.9375|1)rem$",
                        "description": "13, 14, 15 or 16px. Enumerated rather than free, so a skin cannot ship 9px body text." },
        "scaleRatio": { "type": "number", "minimum": 1.1, "maximum": 1.333 },
        "baseWeight": { "enum": [400, 500] }
      }
    },
    "geometry": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "radiusRoot":  { "type": "string", "enum": ["0rem", "0.25rem", "0.5rem", "0.875rem"] },
        "density":     { "enum": ["compact", "comfortable"] },
        "shadowDepth": { "type": "number", "enum": [0, 0.5, 1, 1.6] },
        "sidebarStyle":{ "enum": ["neutral", "brand", "contrast"] },
        "sidebarWidth":{ "type": "string", "enum": ["14rem", "16rem", "18rem"] }
      }
    },
    "tokens": {
      "type": "object",
      "additionalProperties": false,
      "description": "Layer-2 semantic tokens only. Any key not listed here is rejected — this is the guard that stops an imported skin redefining a layer-1 primitive or injecting an unknown property.",
      "required": ["background", "foreground", "card", "cardForeground", "primary", "primaryForeground", "border", "ring"],
      "properties": {
        "background":                  { "$ref": "#/$defs/color" },
        "foreground":                  { "$ref": "#/$defs/color" },
        "surfaceSunken":               { "$ref": "#/$defs/color" },
        "card":                        { "$ref": "#/$defs/color" },
        "cardForeground":              { "$ref": "#/$defs/color" },
        "popover":                     { "$ref": "#/$defs/color" },
        "popoverForeground":           { "$ref": "#/$defs/color" },
        "muted":                       { "$ref": "#/$defs/color" },
        "mutedForeground":             { "$ref": "#/$defs/color" },
        "border":                      { "$ref": "#/$defs/color" },
        "borderStrong":                { "$ref": "#/$defs/color" },
        "input":                       { "$ref": "#/$defs/color" },
        "ring":                        { "$ref": "#/$defs/color" },
        "ringOffset":                  { "$ref": "#/$defs/color" },
        "overlay":                     { "$ref": "#/$defs/colorWithAlpha" },
        "primary":                     { "$ref": "#/$defs/color" },
        "primaryForeground":           { "$ref": "#/$defs/color" },
        "primaryHover":                { "$ref": "#/$defs/color" },
        "secondary":                   { "$ref": "#/$defs/color" },
        "secondaryForeground":         { "$ref": "#/$defs/color" },
        "accent":                      { "$ref": "#/$defs/color" },
        "accentForeground":            { "$ref": "#/$defs/color" },
        "success":                     { "$ref": "#/$defs/color" },
        "successForeground":           { "$ref": "#/$defs/color" },
        "successSubtle":               { "$ref": "#/$defs/color" },
        "successStrong":               { "$ref": "#/$defs/color" },
        "warning":                     { "$ref": "#/$defs/color" },
        "warningForeground":           { "$ref": "#/$defs/color" },
        "warningSubtle":               { "$ref": "#/$defs/color" },
        "warningStrong":               { "$ref": "#/$defs/color" },
        "destructive":                 { "$ref": "#/$defs/color" },
        "destructiveForeground":       { "$ref": "#/$defs/color" },
        "destructiveSubtle":           { "$ref": "#/$defs/color" },
        "destructiveStrong":           { "$ref": "#/$defs/color" },
        "info":                        { "$ref": "#/$defs/color" },
        "infoForeground":              { "$ref": "#/$defs/color" },
        "infoSubtle":                  { "$ref": "#/$defs/color" },
        "infoStrong":                  { "$ref": "#/$defs/color" },
        "chatUserBubble":              { "$ref": "#/$defs/color" },
        "chatUserBubbleForeground":    { "$ref": "#/$defs/color" },
        "chatAssistantBubble":         { "$ref": "#/$defs/color" },
        "chatAssistantBubbleForeground":{ "$ref": "#/$defs/color" },
        "chatMetaForeground":          { "$ref": "#/$defs/color" },
        "chatDisclaimer":              { "$ref": "#/$defs/color" },
        "chatDisclaimerForeground":    { "$ref": "#/$defs/color" },
        "chatComposer":                { "$ref": "#/$defs/color" },
        "chatTyping":                  { "$ref": "#/$defs/color" },
        "sidebar":                     { "$ref": "#/$defs/color" },
        "sidebarForeground":           { "$ref": "#/$defs/color" },
        "sidebarMutedForeground":      { "$ref": "#/$defs/color" },
        "sidebarAccent":               { "$ref": "#/$defs/color" },
        "sidebarActiveSurface":        { "$ref": "#/$defs/color" },
        "sidebarBorder":               { "$ref": "#/$defs/color" },
        "chart1":                      { "$ref": "#/$defs/color" },
        "chart2":                      { "$ref": "#/$defs/color" },
        "chart3":                      { "$ref": "#/$defs/color" },
        "chart4":                      { "$ref": "#/$defs/color" },
        "chart5":                      { "$ref": "#/$defs/color" },
        "chart6":                      { "$ref": "#/$defs/color" },
        "selection":                   { "$ref": "#/$defs/color" },
        "selectionForeground":         { "$ref": "#/$defs/color" },
        "skeleton":                    { "$ref": "#/$defs/color" },
        "codeSurface":                 { "$ref": "#/$defs/color" },
        "codeForeground":              { "$ref": "#/$defs/color" },
        "disabledSurface":             { "$ref": "#/$defs/color" },
        "disabledForeground":          { "$ref": "#/$defs/color" }
      }
    }
  },
  "$defs": {
    "color": {
      "type": "string",
      "pattern": "^#(?:[0-9a-fA-F]{6})$",
      "description": "6-digit hex only. No named colours, no rgb(), no hsl(), no var(), no url(), no gradients. Narrow by construction: the value is interpolated into a CSS custom property, so anything that can carry a function call is a CSS-injection vector."
    },
    "colorWithAlpha": {
      "type": "string",
      "pattern": "^rgb\\((?:25[0-5]|2[0-4]\\d|1?\\d?\\d) (?:25[0-5]|2[0-4]\\d|1?\\d?\\d) (?:25[0-5]|2[0-4]\\d|1?\\d?\\d) \\/ 0?\\.\\d{1,2}\\)$"
    },
    "assetRef": {
      "type": "object",
      "additionalProperties": false,
      "required": ["assetId"],
      "properties": {
        "assetId": { "type": "string", "format": "uuid",
                     "description": "Reference to a row in the tenant's Assets table. NOT a URL and NOT a data URI — a skin cannot make the app fetch an arbitrary origin, and cannot embed an SVG payload." },
        "alt":     { "type": "string", "maxLength": 120 }
      }
    },
    "fontStackRef": {
      "type": "string",
      "enum": [
        "ibm-plex-sans", "ibm-plex-mono", "ibm-plex-sans-arabic",
        "noto-sans", "noto-sans-arabic", "system-ui", "dubai"
      ],
      "description": "An allowlisted stack id, resolved server-side to a full family list with fallbacks. NOT a raw font-family string: a free string is both a CSS-injection vector and a way to reference an unlicensed or unavailable face."
    }
  }
}
```

Three deliberate narrowings, each closing a specific hole:

| Field shape | Rejected alternative | Why |
|---|---|---|
| `color` as 6-digit hex only | any CSS colour string | The value is interpolated into `--primary: <value>;`. A string permitting `url(...)`, `attr(...)` or a closing `;` is CSS injection with a stylesheet-shaped payload |
| `assetRef` as a UUID | a URL or data URI | A URL makes the app fetch an attacker's origin on every page load (an exfiltration channel and a tracking beacon); a data URI lets an SVG logo carry script |
| `fontStackRef` as an enum | a free `font-family` string | Same injection surface, plus font licensing |

## 7.3 A complete example skin

`skins/sewa-corporate.json` — a tenant white-label. Every pair below passes the §10.2 gate.

```json
{
  "schemaVersion": 1,
  "metadata": {
    "id": "5e3d3a90-2c4b-4a1f-9f5e-71b0a6d3c111",
    "name": "SEWA Corporate",
    "description": "SEWA entity branding for the billing assistant and its backoffice.",
    "author": "sara.almazrouei@shj.ae",
    "tenant": "sewa",
    "createdAt": "2026-09-08T07:12:44Z",
    "updatedAt": "2026-09-08T07:12:44Z",
    "basedOn": "Sharjah Default",
    "readOnly": false
  },
  "mode": "light",
  "direction": "locale",
  "assets": {
    "appTitle": "SEWA Assistant",
    "logoLight": { "assetId": "9c1f0f2e-77aa-4c3b-8d21-2f0b6a4c8e01", "alt": "SEWA" },
    "logoDark":  { "assetId": "b4a2e6d1-1c88-4f0a-9b77-0e5d3a2f7c44", "alt": "SEWA" },
    "logoMark":  { "assetId": "3d77c210-59ab-4e6d-8c14-6a2b9e1f5d33", "alt": "SEWA" },
    "favicon":   { "assetId": "72c9b481-3e0d-4a55-bb92-19f7c6d0a8e2" }
  },
  "typography": {
    "fontSans": "ibm-plex-sans",
    "fontMono": "ibm-plex-mono",
    "fontArabic": "ibm-plex-sans-arabic",
    "baseSize": "0.875rem",
    "scaleRatio": 1.2,
    "baseWeight": 400
  },
  "geometry": {
    "radiusRoot": "0.25rem",
    "density": "compact",
    "shadowDepth": 0.5,
    "sidebarStyle": "brand",
    "sidebarWidth": "16rem"
  },
  "tokens": {
    "background": "#F6F5F1",
    "foreground": "#20242B",
    "surfaceSunken": "#EFEDE7",
    "card": "#FFFFFF",
    "cardForeground": "#20242B",
    "popover": "#FFFFFF",
    "popoverForeground": "#20242B",
    "muted": "#EFEDE7",
    "mutedForeground": "#5B6270",
    "border": "#E3E1DA",
    "borderStrong": "#8F8B81",
    "input": "#FFFFFF",
    "ring": "#2A5D9F",
    "ringOffset": "#F6F5F1",
    "overlay": "rgb(32 36 43 / 0.44)",
    "primary": "#2A5D9F",
    "primaryForeground": "#FFFFFF",
    "primaryHover": "#1F4C86",
    "secondary": "#EFEDE7",
    "secondaryForeground": "#20242B",
    "accent": "#DFE9F6",
    "accentForeground": "#1F4C86",
    "success": "#1F6F5C",
    "successForeground": "#FFFFFF",
    "successSubtle": "#DDEDE7",
    "successStrong": "#15584A",
    "warning": "#8A5A12",
    "warningForeground": "#FFFFFF",
    "warningSubtle": "#F7EBD4",
    "warningStrong": "#6E4709",
    "destructive": "#B4553F",
    "destructiveForeground": "#FFFFFF",
    "destructiveSubtle": "#F5E3DD",
    "destructiveStrong": "#9E4230",
    "info": "#2A5D9F",
    "infoForeground": "#FFFFFF",
    "infoSubtle": "#DFE9F6",
    "infoStrong": "#1F4C86",
    "chatUserBubble": "#DFE9F6",
    "chatUserBubbleForeground": "#20242B",
    "chatAssistantBubble": "#F1EDE4",
    "chatAssistantBubbleForeground": "#20242B",
    "chatMetaForeground": "#5B6270",
    "chatDisclaimer": "#EFEDE7",
    "chatDisclaimerForeground": "#5B6270",
    "chatComposer": "#FFFFFF",
    "chatTyping": "#5B6270",
    "sidebar": "#12352D",
    "sidebarForeground": "#EDEEF0",
    "sidebarMutedForeground": "#A9BDB6",
    "sidebarAccent": "#6FCDB0",
    "sidebarActiveSurface": "#1E2B27",
    "sidebarBorder": "#232B28",
    "chart1": "#1F6F5C",
    "chart2": "#2A5D9F",
    "chart3": "#8A5A12",
    "chart4": "#B4553F",
    "chart5": "#5B6270",
    "chart6": "#6E4B8F",
    "selection": "#DFE9F6",
    "selectionForeground": "#20242B",
    "skeleton": "#EFEDE7",
    "codeSurface": "#EFEDE7",
    "codeForeground": "#20242B",
    "disabledSurface": "#EFEDE7",
    "disabledForeground": "#8A8F99"
  }
}
```

Note what this skin demonstrates: SEWA re-brands `--primary`, `--ring`, `--accent` and the **user bubble** to its corporate blue, while `--success` stays green. `Healthy` badges are unaffected, and B14's observability panel keeps its meaning — the decoupling argued in §4.3 doing its job.

## 7.4 Validation pipeline

Import, and every save from the Appearance module, runs the same five stages in order. Failure at any stage aborts the whole operation — nothing is partially applied (§2 P7).

| Stage | Check | On failure |
|---|---|---|
| **1 · Size & parse** | ≤ 64 KB, valid UTF-8 JSON, nesting depth ≤ 8 | `400`, "This file is not a valid skin." No parse of a hostile-size payload |
| **2 · Schema** | JSON Schema 2020-12, `additionalProperties: false` at every level, `schemaVersion` must equal a version this build knows | Report **every** violation with its JSON Pointer path and the expected shape. Never coerce, never drop unknown keys silently — a silently dropped key is a token that stays at its old value, which is a half-applied theme |
| **3 · Reference resolution** | Every `assetId` must resolve to an asset **in the importing principal's tenant**. `metadata.tenant` is discarded and replaced. Every `fontStackRef` must be in the allowlist | `422`, naming each unresolvable asset. This is the cross-tenant guard: an exported SEWA skin imported into Customs cannot pull SEWA's logo |
| **4 · Completeness** | Missing optional tokens are filled from the **system default** for the declared `mode`, never from the tenant's current theme | — (this is a merge, not a failure). Filling from the current theme would make an import's result depend on hidden state |
| **5 · Contrast gate** | Every pair in §10.2's matrix computed. Text pairs below 4.5:1 (or 3:1 for ≥`--text-lg` bold) **block**. Non-text pairs below 3:1 **warn** | `422` with a per-pair report: token names, computed ratio, required ratio, and a suggested nearest-passing value. The skin is stored as a **rejected draft** the user can fix, not discarded |

Additional import rules:

- The import endpoint requires the `Manage appearance` permission for a tenant skin, or a session for a personal skin. An unauthenticated import path does not exist.
- Import is rate-limited (10/hour/principal) and audited — B14 tab 2 gains a `Imported skin "SEWA Corporate"` entry, since a branding change is a configuration change.
- An imported skin is **never auto-applied**. It lands as a saved, unapplied skin. Applying it is a second, explicit action with its own preview. An import that both validated and applied itself would let a mailed file silently repaint a government service.
- `readOnly` and `metadata.id` from the file are discarded; a new id is minted. Otherwise an import could overwrite a shipped skin.

---

# 8. The two shipped skins

Both are `readOnly: true`, live in the `platform` schema, and are the fallback at the end of the resolution chain (§9.4). Together they are also the fixtures for the contrast test in §12.4 — the test asserts these exact numbers, so a value cannot drift unnoticed.

## 8.1 Sharjah Default (light)

Takes the wireframe's §7.2 palette as its base and extends it with the semantic families the admin screens need (§4.3).

```json
{
  "schemaVersion": 1,
  "metadata": { "name": "Sharjah Default", "author": "Platform",
                "createdAt": "2026-09-08T00:00:00Z", "readOnly": true },
  "mode": "light",
  "direction": "locale",
  "assets": { "appTitle": "SHJ3 Assistant" },
  "typography": { "fontSans": "ibm-plex-sans", "fontMono": "ibm-plex-mono",
                  "fontArabic": "ibm-plex-sans-arabic",
                  "baseSize": "0.875rem", "scaleRatio": 1.2, "baseWeight": 400 },
  "geometry": { "radiusRoot": "0.5rem", "density": "comfortable",
                "shadowDepth": 1, "sidebarStyle": "neutral", "sidebarWidth": "16rem" },
  "tokens": {
    "background": "#F6F5F1", "foreground": "#20242B", "surfaceSunken": "#EFEDE7",
    "card": "#FFFFFF", "cardForeground": "#20242B",
    "popover": "#FFFFFF", "popoverForeground": "#20242B",
    "muted": "#EFEDE7", "mutedForeground": "#5B6270",
    "border": "#E3E1DA", "borderStrong": "#8F8B81", "input": "#FFFFFF",
    "ring": "#1F6F5C", "ringOffset": "#F6F5F1", "overlay": "rgb(32 36 43 / 0.44)",
    "primary": "#1F6F5C", "primaryForeground": "#FFFFFF", "primaryHover": "#1A5D4D",
    "secondary": "#EFEDE7", "secondaryForeground": "#20242B",
    "accent": "#DDEDE7", "accentForeground": "#15584A",
    "success": "#1F6F5C", "successForeground": "#FFFFFF",
    "successSubtle": "#DDEDE7", "successStrong": "#15584A",
    "warning": "#8A5A12", "warningForeground": "#FFFFFF",
    "warningSubtle": "#F7EBD4", "warningStrong": "#6E4709",
    "destructive": "#B4553F", "destructiveForeground": "#FFFFFF",
    "destructiveSubtle": "#F5E3DD", "destructiveStrong": "#9E4230",
    "info": "#2A5D9F", "infoForeground": "#FFFFFF",
    "infoSubtle": "#DFE9F6", "infoStrong": "#1F4C86",
    "chatUserBubble": "#D7EFE7", "chatUserBubbleForeground": "#20242B",
    "chatAssistantBubble": "#F1EDE4", "chatAssistantBubbleForeground": "#20242B",
    "chatMetaForeground": "#5B6270",
    "chatDisclaimer": "#EFEDE7", "chatDisclaimerForeground": "#5B6270",
    "chatComposer": "#FFFFFF", "chatTyping": "#5B6270",
    "sidebar": "#EFEDE7", "sidebarForeground": "#20242B",
    "sidebarMutedForeground": "#5B6270", "sidebarAccent": "#1F6F5C",
    "sidebarActiveSurface": "#DDEDE7", "sidebarBorder": "#E3E1DA",
    "chart1": "#1F6F5C", "chart2": "#2A5D9F", "chart3": "#8A5A12",
    "chart4": "#B4553F", "chart5": "#5B6270", "chart6": "#6E4B8F",
    "selection": "#DDEDE7", "selectionForeground": "#20242B",
    "skeleton": "#EFEDE7", "codeSurface": "#EFEDE7", "codeForeground": "#20242B",
    "disabledSurface": "#EFEDE7", "disabledForeground": "#8A8F99"
  }
}
```

### Contrast results — Sharjah Default

Text pairs (require ≥ 4.5:1; **blocking**):

| Foreground | Background | Ratio | Result |
|---|---|---|---|
| `foreground` #20242B | `background` #F6F5F1 | **14.27:1** | Pass |
| `cardForeground` #20242B | `card` #FFFFFF | **15.57:1** | Pass |
| `popoverForeground` #20242B | `popover` #FFFFFF | **15.57:1** | Pass |
| `mutedForeground` #5B6270 | `background` #F6F5F1 | **5.62:1** | Pass |
| `mutedForeground` #5B6270 | `card` #FFFFFF | **6.13:1** | Pass |
| `mutedForeground` #5B6270 | `muted` #EFEDE7 | **5.24:1** | Pass |
| `primary` #1F6F5C | `background` #F6F5F1 | **5.52:1** | Pass |
| `primary` #1F6F5C | `card` #FFFFFF | **6.02:1** | Pass |
| `primaryForeground` #FFFFFF | `primary` #1F6F5C | **6.02:1** | Pass |
| `secondaryForeground` #20242B | `secondary` #EFEDE7 | **13.30:1** | Pass |
| `accentForeground` #15584A | `accent` #DDEDE7 | **6.86:1** | Pass |
| `successForeground` #FFFFFF | `success` #1F6F5C | **6.02:1** | Pass |
| `successStrong` #15584A | `successSubtle` #DDEDE7 | **6.86:1** | Pass |
| `warningForeground` #FFFFFF | `warning` #8A5A12 | **5.91:1** | Pass |
| `warningStrong` #6E4709 | `warningSubtle` #F7EBD4 | **6.93:1** | Pass |
| `destructiveForeground` #FFFFFF | `destructive` #B4553F | **4.87:1** | Pass |
| `destructiveStrong` #9E4230 | `destructiveSubtle` #F5E3DD | **5.16:1** | Pass |
| `destructiveStrong` #9E4230 | `background` #F6F5F1 | **5.88:1** | Pass |
| `infoForeground` #FFFFFF | `info` #2A5D9F | **6.64:1** | Pass |
| `infoStrong` #1F4C86 | `infoSubtle` #DFE9F6 | **7.03:1** | Pass |
| `chatUserBubbleForeground` #20242B | `chatUserBubble` #D7EFE7 | **12.89:1** | Pass |
| `chatAssistantBubbleForeground` #20242B | `chatAssistantBubble` #F1EDE4 | **13.33:1** | Pass |
| `chatMetaForeground` #5B6270 | `chatUserBubble` #D7EFE7 | **5.08:1** | Pass |
| `chatMetaForeground` #5B6270 | `chatAssistantBubble` #F1EDE4 | **5.25:1** | Pass |
| `chatDisclaimerForeground` #5B6270 | `chatDisclaimer` #EFEDE7 | **5.24:1** | Pass |
| `sidebarForeground` #20242B | `sidebar` #EFEDE7 | **13.30:1** | Pass |
| `sidebarMutedForeground` #5B6270 | `sidebar` #EFEDE7 | **5.24:1** | Pass |
| `sidebarForeground` #20242B | `sidebarActiveSurface` #DDEDE7 | **12.86:1** | Pass |
| `codeForeground` #20242B | `codeSurface` #EFEDE7 | **13.30:1** | Pass |
| `selectionForeground` #20242B | `selection` #DDEDE7 | **12.86:1** | Pass |
| `chart1` #1F6F5C | `card` #FFFFFF | **6.02:1** | Pass |
| `chart2` #2A5D9F | `card` #FFFFFF | **6.64:1** | Pass |
| `chart3` #8A5A12 | `card` #FFFFFF | **5.91:1** | Pass |
| `chart4` #B4553F | `card` #FFFFFF | **4.87:1** | Pass |
| `chart5` #5B6270 | `card` #FFFFFF | **6.13:1** | Pass |
| `chart6` #6E4B8F | `card` #FFFFFF | **6.85:1** | Pass |

Non-text pairs (require ≥ 3:1; **warn only**):

| Pair | Ratio | Result |
|---|---|---|
| `borderStrong` #8F8B81 vs `background` #F6F5F1 | **3.12:1** | Pass |
| `borderStrong` #8F8B81 vs `card` #FFFFFF | **3.40:1** | Pass |
| `ring` #1F6F5C vs `background` #F6F5F1 | **5.52:1** | Pass |
| `ring` #1F6F5C vs `card` #FFFFFF | **6.02:1** | Pass |
| `primary` #1F6F5C vs `background` #F6F5F1 (switch-on fill) | **5.52:1** | Pass |
| `border` #E3E1DA vs `background` #F6F5F1 | 1.20:1 | **Exempt** — decorative divider, excluded from the matrix by name (§10.2) |
| `border` #E3E1DA vs `card` #FFFFFF | 1.31:1 | **Exempt** — same |
| `disabledForeground` #8A8F99 vs `disabledSurface` #EFEDE7 | 2.86:1 | **Exempt** — WCAG 1.4.3 excludes disabled controls (§4.5) |

## 8.2 Sharjah Dark

Not an inversion. Surfaces are desaturated blue-slate rather than pure black (pure black plus a 14px UI produces halation), the brand green lifts to `#4FB79B` so it survives on a dark ground, and shadow colour deepens (§4.8).

```json
{
  "schemaVersion": 1,
  "metadata": { "name": "Sharjah Dark", "author": "Platform",
                "createdAt": "2026-09-08T00:00:00Z", "readOnly": true },
  "mode": "dark",
  "direction": "locale",
  "assets": { "appTitle": "SHJ3 Assistant" },
  "typography": { "fontSans": "ibm-plex-sans", "fontMono": "ibm-plex-mono",
                  "fontArabic": "ibm-plex-sans-arabic",
                  "baseSize": "0.875rem", "scaleRatio": 1.2, "baseWeight": 400 },
  "geometry": { "radiusRoot": "0.5rem", "density": "comfortable",
                "shadowDepth": 1, "sidebarStyle": "neutral", "sidebarWidth": "16rem" },
  "tokens": {
    "background": "#14171C", "foreground": "#EDEEF0", "surfaceSunken": "#101317",
    "card": "#1B1F26", "cardForeground": "#EDEEF0",
    "popover": "#20252D", "popoverForeground": "#EDEEF0",
    "muted": "#232830", "mutedForeground": "#A2A9B5",
    "border": "#2E343E", "borderStrong": "#6A7280", "input": "#1B1F26",
    "ring": "#5FC7AA", "ringOffset": "#14171C", "overlay": "rgb(10 12 15 / 0.62)",
    "primary": "#4FB79B", "primaryForeground": "#14171C", "primaryHover": "#63C6AB",
    "secondary": "#232830", "secondaryForeground": "#EDEEF0",
    "accent": "#12332B", "accentForeground": "#8FD9C2",
    "success": "#4FB79B", "successForeground": "#14171C",
    "successSubtle": "#12332B", "successStrong": "#8FD9C2",
    "warning": "#E0A33E", "warningForeground": "#14171C",
    "warningSubtle": "#38290F", "warningStrong": "#E0A33E",
    "destructive": "#E08A70", "destructiveForeground": "#14171C",
    "destructiveSubtle": "#3A211A", "destructiveStrong": "#F0B49F",
    "info": "#76A9E8", "infoForeground": "#14171C",
    "infoSubtle": "#16283D", "infoStrong": "#76A9E8",
    "chatUserBubble": "#1E3A33", "chatUserBubbleForeground": "#EDEEF0",
    "chatAssistantBubble": "#262B33", "chatAssistantBubbleForeground": "#EDEEF0",
    "chatMetaForeground": "#A2A9B5",
    "chatDisclaimer": "#232830", "chatDisclaimerForeground": "#A2A9B5",
    "chatComposer": "#20252D", "chatTyping": "#A2A9B5",
    "sidebar": "#141A18", "sidebarForeground": "#EDEEF0",
    "sidebarMutedForeground": "#A2A9B5", "sidebarAccent": "#6FCDB0",
    "sidebarActiveSurface": "#1E2B27", "sidebarBorder": "#232B28",
    "chart1": "#4FB79B", "chart2": "#76A9E8", "chart3": "#E0A33E",
    "chart4": "#E08A70", "chart5": "#A2A9B5", "chart6": "#B48FD6",
    "selection": "#12332B", "selectionForeground": "#EDEEF0",
    "skeleton": "#232830", "codeSurface": "#101317", "codeForeground": "#EDEEF0",
    "disabledSurface": "#1B1F26", "disabledForeground": "#6E7684"
  }
}
```

### Contrast results — Sharjah Dark

Text pairs (require ≥ 4.5:1; **blocking**):

| Foreground | Background | Ratio | Result |
|---|---|---|---|
| `foreground` #EDEEF0 | `background` #14171C | **15.47:1** | Pass |
| `cardForeground` #EDEEF0 | `card` #1B1F26 | **14.24:1** | Pass |
| `popoverForeground` #EDEEF0 | `popover` #20252D | **13.26:1** | Pass |
| `mutedForeground` #A2A9B5 | `background` #14171C | **7.59:1** | Pass |
| `mutedForeground` #A2A9B5 | `card` #1B1F26 | **6.99:1** | Pass |
| `mutedForeground` #A2A9B5 | `muted` #232830 | **6.26:1** | Pass |
| `primary` #4FB79B | `background` #14171C | **7.34:1** | Pass |
| `primary` #4FB79B | `card` #1B1F26 | **6.75:1** | Pass |
| `primaryForeground` #14171C | `primary` #4FB79B | **7.34:1** | Pass |
| `secondaryForeground` #EDEEF0 | `secondary` #232830 | **12.76:1** | Pass |
| `accentForeground` #8FD9C2 | `accent` #12332B | **8.39:1** | Pass |
| `successForeground` #14171C | `success` #4FB79B | **7.34:1** | Pass |
| `successStrong` #8FD9C2 | `successSubtle` #12332B | **8.39:1** | Pass |
| `warningForeground` #14171C | `warning` #E0A33E | **8.11:1** | Pass |
| `warningStrong` #E0A33E | `warningSubtle` #38290F | **6.35:1** | Pass |
| `destructiveForeground` #14171C | `destructive` #E08A70 | **6.88:1** | Pass |
| `destructiveStrong` #F0B49F | `destructiveSubtle` #3A211A | **8.31:1** | Pass |
| `infoForeground` #14171C | `info` #76A9E8 | **7.37:1** | Pass |
| `infoStrong` #76A9E8 | `infoSubtle` #16283D | **6.13:1** | Pass |
| `chatUserBubbleForeground` #EDEEF0 | `chatUserBubble` #1E3A33 | **10.59:1** | Pass |
| `chatAssistantBubbleForeground` #EDEEF0 | `chatAssistantBubble` #262B33 | **12.26:1** | Pass |
| `chatMetaForeground` #A2A9B5 | `chatUserBubble` #1E3A33 | **5.20:1** | Pass |
| `chatMetaForeground` #A2A9B5 | `chatAssistantBubble` #262B33 | **6.02:1** | Pass |
| `chatDisclaimerForeground` #A2A9B5 | `chatDisclaimer` #232830 | **6.26:1** | Pass |
| `sidebarForeground` #EDEEF0 | `sidebar` #141A18 | **15.19:1** | Pass |
| `codeForeground` #EDEEF0 | `codeSurface` #101317 | **16.04:1** | Pass |
| `sidebarMutedForeground` #A2A9B5 | `sidebar` #141A18 | **7.46:1** | Pass |
| `sidebarForeground` #EDEEF0 | `sidebarActiveSurface` #1E2B27 | **12.65:1** | Pass |
| `chart1` #4FB79B | `card` #1B1F26 | **6.75:1** | Pass |
| `chart2` #76A9E8 | `card` #1B1F26 | **6.78:1** | Pass |
| `chart3` #E0A33E | `card` #1B1F26 | **7.46:1** | Pass |
| `chart4` #E08A70 | `card` #1B1F26 | **6.33:1** | Pass |
| `chart5` #A2A9B5 | `card` #1B1F26 | **6.99:1** | Pass |
| `chart6` #B48FD6 | `card` #1B1F26 | **6.17:1** | Pass |

Non-text pairs (require ≥ 3:1; **warn only**):

| Pair | Ratio | Result |
|---|---|---|
| `borderStrong` #6A7280 vs `background` #14171C | **3.71:1** | Pass |
| `borderStrong` #6A7280 vs `card` #1B1F26 | **3.41:1** | Pass |
| `ring` #5FC7AA vs `background` #14171C | **8.76:1** | Pass |
| `primary` #4FB79B vs `card` #1B1F26 (switch-on fill) | **6.75:1** | Pass |
| `border` #2E343E vs `background` #14171C | 1.43:1 | **Exempt** — decorative divider |
| `card` #1B1F26 vs `background` #14171C | 1.09:1 | **Exempt** — surface separation is carried by `border`/`shadow`, not contrast |
| `disabledForeground` #6E7684 vs `disabledSurface` #1B1F26 | 3.61:1 | Pass |

Note `warningStrong` and `infoStrong` equal `warning` and `info` in the dark skin: on a dark ground the *fill* hue is already light enough to serve as text, so the `-strong` split (§6.3) collapses. The tokens remain distinct so component code is mode-agnostic.

---

# 9. Theming module UX — Settings → Appearance

Route: `app/(backoffice)/settings/appearance/` (`architecture.md` §9). Reachable from the `AppShell` header user menu and from the settings nav. This is a real product module, not a config file — Phase E's requirement and the reason ADR-0007 exists.

## 9.1 Layout

Two panes. Controls at inline-start (`SubTabBar` with five sections), a live preview at inline-end that is **the real components, not screenshots** — a `Card` with a `Badge` of each family, a `Button` row, a `DataTable` of three rows, a `SubTabBar`, a `Switch`, a `ProgressBar`, a `SummaryStrip`, and a two-turn `ChatThread` showing both bubble tints. The preview renders inside a container with the candidate tokens scoped to it, so a broken candidate theme cannot make the Appearance screen itself unusable.

| Section | Controls |
|---|---|
| **Brand** | Primary, primary hover, secondary, accent + accent foreground. Logo light, logo dark, logo mark, favicon (upload → `assetId`). App title. Sidebar style: neutral / brand / contrast. Sidebar width: 14 / 16 / 18rem |
| **Semantic** | Success, warning, destructive, info — each with fill, foreground, subtle, strong. A "Match brand" action seeds `--success` from `--primary`, with an explicit warning that it will change the appearance of every `Healthy`/`Passed`/`Approved` badge (§4.3) |
| **Typography** | Font family (sans / mono / Arabic, from the allowlisted stacks), base size (13/14/15/16px), scale ratio (1.1–1.333 slider), base weight (400/500) |
| **Layout** | Corner radius (4-stop slider: square / subtle / default / round). Density (compact / comfortable). Shadow depth (4-stop: flat / subtle / default / pronounced). Focus ring width and offset |
| **Mode & direction** | Light / Dark / System. Direction: follow locale (default) / force LTR / force RTL. Skin manager: list, apply, duplicate, rename, delete, export, import |

Every control writes a token. There is no control in this module that does not map to a token in §4 — a control with no token behind it is a control that lies.

**Reconciliation with what actually shipped (brand-asset-upload wave, 2026-09-10):** the Brand row's "logo light, logo dark, logo mark, favicon" names four assets; three are real, built controls (`BrandAsset.kind` = `LogoLight` | `LogoDark` | `Favicon`, real upload, real storage, real `<AppShell>`/favicon effect — see `tasks/todo.md`'s review entry for the live proof). "Logo mark" is not built — no `TenantBranding` column exists for it (only `logoLightAssetId`/`logoDarkAssetId`/`faviconAssetId`), the same "no token/column behind it" rule this section states applies to a fourth, narrower asset slot, and it is out of scope rather than silently dropped. Upload is restricted to PNG/WebP/ICO — `CK_BrandAssets_mimeAllowed` (§7.2/`001_constraints.sql`) also permits `image/svg+xml`, a deliberate, still-open schema allowance for a future wave that adds a real, audited SVG sanitiser; this wave's own server-side validator rejects SVG outright as a stored-XSS vector (an uploaded SVG can carry `<script>`/inline handlers), reasoned in full in `modules/theming/domain/brand-asset.ts`'s own doc comment. Sidebar width remains an honest, non-interactive note (§9.1's own "no lying control" rule) — still no backing column.

## 9.2 Live preview and the never-half-applied rule

```ts
/**
 * Live preview writes candidate tokens as inline custom properties on a scoped
 * root. Inline style beats the server-rendered <style> block on specificity, so
 * the preview wins while it is active and vanishes completely when discarded —
 * the server-resolved values were never mutated.
 *
 * `scope` is the preview container in "preview" mode and documentElement in
 * "whole app" mode, which the module offers as an explicit toggle so an admin
 * can see the theme against a real screen before committing.
 */
export function applyCandidate(scope: HTMLElement, tokens: SemanticTokens): () => void {
  const previous = new Map<string, string>();
  for (const [key, value] of Object.entries(tokens)) {
    const prop = `--${kebab(key)}`;
    previous.set(prop, scope.style.getPropertyValue(prop));
    scope.style.setProperty(prop, value);
  }
  // Revert closure. Discard, navigation-away and validation failure all call it.
  return () => {
    for (const [prop, value] of previous) {
      if (value) scope.style.setProperty(prop, value);
      else scope.style.removeProperty(prop);
    }
  };
}
```

Rules that make "never half-applied" true rather than claimed:

1. **Save is atomic.** The whole token set is validated (§7.4 stages 1–5) and written in one transaction, or nothing is written. There is no per-control save.
2. **Save is blocked, not warned, on a text-pair contrast failure** (§10.2). The failing pairs are listed with computed and required ratios and a suggested nearest-passing value; the Save button is disabled with the failure list wired via `aria-describedby`.
3. **Discard reverts by closure**, not by re-fetching. Reverting by refetch would leave a window in which the candidate is applied and the server disagrees.
4. **Navigating away with unsaved changes** raises a confirmation naming what would be lost.
5. **Reset to default** is always present, always one click, and does not require the current theme to be readable — it is also exposed at `/settings/appearance/reset` as a plain, unthemed HTML page styled from the shipped default with **inline** critical CSS. That is the escape hatch for the case a tenant saved a theme that somehow renders the app unusable; the route ignores the tenant theme entirely.
6. **Mode switching does not lose work.** Light and dark token sets are edited separately and saved together; switching the preview mode does not discard the other mode's edits.

## 9.3 Who may change what (`FR-THEME-18`)

| Scope | Stored in | Who may change | Applies to |
|---|---|---|---|
| **User preference** | `<tenant>.UserAppearance`, one row per user | The user, for themselves. Any authenticated user | Only that user's sessions |
| **Tenant branding** | `<tenant>.AppearanceSkins` + `<tenant>.TenantAppearance` (the applied skin) | `Super Admin`, `Entity Admin`, or any role granted `Manage appearance` in B9 tab 3 | Every user of that tenant who has no overriding preference |
| **System default** | `platform.AppearanceSkins` (the two shipped skins, `readOnly`) | `Super Admin` only, and only to choose *which* shipped skin is the default — the shipped skins themselves are immutable | Every tenant with no tenant branding |

A **new permission row** is required in B9 tab 3: `Manage appearance`, taking the matrix from 8 permissions to 9. It defaults to on for `Super Admin` and `Entity Admin` and off for the other five roles, matching B9's separation-of-duties rule (authoring ≠ release ≠ branding). **[ASSUMPTION]** — the wireframe's matrix predates the Appearance module; this is the minimal, consistent extension. `PermissionMatrix` (§5.5) reads its rows and columns from data, so a 9th permission is a data change, not a component change.

What a user may change vs what only an admin may change:

| Control | User preference | Tenant branding |
|---|---|---|
| Light / dark / system mode | ✓ | ✓ (sets the tenant's default) |
| Density (compact / comfortable) | ✓ | ✓ |
| Base font size | ✓ | ✓ |
| Direction override | ✓ | ✓ |
| Reduced-motion override | ✓ | — |
| Brand colours, semantic colours | — | ✓ |
| Logos, favicon, app title | — | ✓ |
| Font family, radius, shadow depth, sidebar style | — | ✓ |
| Import / export skins | Personal skins only | ✓ |

The split is deliberate: a user controls *legibility and comfort* (mode, size, density, motion, direction); an admin controls *identity* (brand, logos, geometry). A user cannot re-brand a government service for themselves, and an admin cannot force a user into a density that hurts them.

**Cross-tenant guarantee.** A tenant must never see another tenant's branding. Three mechanisms, none of which relies on a query filter being remembered:

1. Theme rows live in the tenant's own SQL schema (ADR-0002). The data-access layer produces only tenant-scoped handles (`architecture.md` §5) — there is no unscoped handle to fetch another tenant's skin with.
2. The tenant id is resolved from the authenticated principal, never from a header, query parameter or body.
3. The resolved theme is **inlined server-side into `<head>`** and never fetched client-side, so there is no cacheable theme endpoint to poison and no CDN entry keyed on anything but the tenant-scoped page (§9.4). `Cache-Control: private` on every page carrying an inlined theme; `Vary` on the tenant-bearing session cookie.

## 9.4 Resolution, server-side, on first paint (`FR-THEME-13`, `FR-THEME-14`, `FR-THEME-15`)

Order is Phase E's and ADR-0007's, and it is a **per-token** merge, not a whole-object pick — a user who has only set `mode: dark` still gets their tenant's brand colours.

```ts
/**
 * Resolves the effective token set for a request. Runs on the server in the
 * root layout, before any markup is streamed.
 *
 * Merge order (last wins, per token):
 *   1. system default skin for the effective mode  (platform, read-only)
 *   2. tenant applied skin                          (tenant schema)
 *   3. user preference                              (tenant schema, this user)
 *
 * Why server-side and inlined: it removes the flash of default theme, and it
 * means per-tenant branding is never fetched by the client, so a tenant's brand
 * cannot leak into another tenant's page through any cache. (ADR-0007)
 */
export async function resolveTheme(principal: Principal): Promise<ResolvedTheme> {
  const db = getTenantDb();                       // already tenant-scoped; no unscoped client exists
  const [tenant, user] = await Promise.all([
    db.tenantAppearance.findFirst({ include: { skin: true } }),
    db.userAppearance.findUnique({ where: { userId: principal.userId } }),
  ]);

  const mode = user?.mode ?? tenant?.mode ?? "system";
  const effective = mode === "system" ? principal.prefersDark ? "dark" : "light" : mode;

  return mergeTokens(
    systemSkin(effective),                        // 1
    tenant?.skin?.tokens ?? {},                   // 2
    pick(user ?? {}, USER_OVERRIDABLE_TOKENS),    // 3 — allowlisted; a user cannot set brand tokens
  );
}
```

Rendered in the root layout:

```tsx
// app/layout.tsx
const theme = await resolveTheme(principal);

return (
  <html lang={locale} dir={dir} data-theme={theme.mode} data-density={theme.density}>
    <head>
      {/* Inlined on first paint. No FOUT of the default theme, no client fetch of
          tenant branding. serializeTokens() emits only `--token: <validated hex>;`
          pairs from the allowlist, so nothing user-supplied reaches CSS unescaped. */}
      <style id="shj3-theme" dangerouslySetInnerHTML={{ __html: serializeTokens(theme) }} />
    </head>
    <body>{children}</body>
  </html>
);
```

`serializeTokens` re-validates against the same `$defs/color` pattern as the schema (§7.2) at emit time, not only at save time. Defence in depth: a row written by an older build, a migration, or a direct database edit still cannot inject CSS.

`data-theme` carries `light` or `dark` explicitly — never absent — so `prefers-color-scheme` is consulted only when the *user* chose "system", and the server already knows which that resolved to. `data-density` drives §4.7's multiplier. Both attributes sit on `<html>` so a single attribute change repaints everything.

---

# 10. Accessibility

Target: **WCAG 2.1 Level AA**, in both skins, both directions, both locales. Not a stretch goal — a Sharjah government service has a legal exposure here, which is why ADR-0007 hardens Phase E's contrast *warning* into a *block*.

## 10.1 What Radix supplies, and what it does not

ADR-0007's rationale for shadcn over a hand-rolled Tailwind library is that *"Radix gives correct keyboard, focus and ARIA behaviour and RTL support in the primitives, so WCAG 2.1 AA starts from a working baseline."* Concretely:

| Supplied by Radix | Covers |
|---|---|
| Focus trap, focus return, `Escape`, scroll lock, `aria-modal` | `Dialog`, `Sheet`, `AlertDialog` |
| Roving tabindex, arrow keys, `aria-selected`, `aria-controls` — **only once `dir` is passed explicitly, see below** | `Tabs` → `SubTabBar`, `ToggleGroup` → `ToggleRow` |
| `role="switch"`, `aria-checked`, label association | `Switch` |
| Typeahead, `aria-activedescendant`, collision-aware positioning, RTL-aware `align` | `Select`, `DropdownMenu`, `Popover`, `Combobox` |
| Hover **and focus** open, `aria-describedby` wiring, dismissal | `Tooltip` |
| Value announcements, keyboard stepping — **RTL reversal only once `dir` is passed explicitly, see below** | `Slider`, `Progress` |
| Portal + `z-index` layering | everything overlaid |

**Not supplied — built here, with the models in §10.4:** `PermissionMatrix` (`role="grid"`, 2D navigation, bulk toggles), `GraphCanvas` and `FlowCanvas` (spatial navigation plus a mandatory non-visual equivalent), `DataTable` (composed from TanStack + native table semantics), `ChatThread` (`role="log"` with streaming announcement discipline), `Wizard` (tablist plus cross-step validation reporting). **Also not supplied, corrected here 2026-09-08 after building `Tooltip` (§5.3 #20) found the row above overstated it:** Radix's Popper-based positioning (shared by `Select`/`DropdownMenu`/`Popover`/`Combobox`/`Tooltip`) makes `align="start"/"end"` genuinely logical — floating-ui resolves it against the element's computed `direction` — but `side="left"/"right"` is physical screen geometry with no direction-based translation anywhere in that path (confirmed by reading `@radix-ui/react-popper`'s compiled source, not assumed). Any component whose own API needs a logical `side` (`inline-start`/`inline-end`, mirroring under RTL per §11.6) has to translate it to Radix's physical prop itself, the way `Tooltip`'s `resolvePhysicalSide` now does — Radix does not do this for you.

**A second, broader instance of the same mistake, corrected here 2026-09-08 while building `SubTabBar`, `ToggleRow` and `Slider` (§5.4 #1, #2, #28):** the two rows above claiming automatic RTL behaviour for `Tabs`/`ToggleGroup`'s arrow keys and for `Slider` are **also wrong as shipped**, for a reason one layer deeper than `side`'s. Confirmed by reading the actually-installed packages rather than trusted on the strength of the `side` fix already having been made once: `@radix-ui/react-roving-focus` (which backs both `Tabs` and `ToggleGroup`) and `@radix-ui/react-slider` both resolve direction via the *same* call, `useDirection(dir)` from `@radix-ui/react-direction` — and that hook's entire implementation is `localDir || globalDir || "ltr"`. `globalDir` comes from a `DirectionProvider` this app never renders anywhere (§11.2: direction is a server-set `<html dir>` attribute, not a React context), so with no explicit `dir` prop, all three primitives silently behave as `"ltr"` forever, regardless of the page's real direction — arrow keys never reverse, and `Slider`'s fill/thumb never mirrors. This is a *narrower* mechanism than `Tooltip`'s popper-positioning gap but the *same root cause class*: a Radix capability advertised as automatic that actually requires this app to supply one more piece of context it doesn't otherwise wire. `sub-tab-bar.tsx`, `toggle-row.tsx` and `slider.tsx` all fix it identically — a shared `useResolvedDir()` hook reads `document.documentElement.dir` (client-only, corrected post-mount so SSR/hydration never mismatches) and passes it as each primitive's `dir` prop — and each component's own test asserts the real, resolved behavior (which tab/segment actually receives focus on `ArrowRight`; which physical CSS property actually carries `Slider`'s fill offset) under both directions, not merely that a prop was forwarded. Any future Radix primitive with its own `dir`/`orientation` prop should be assumed to have this same gap until checked, not assumed fixed by precedent.

## 10.2 Contrast and the save-time gate

**Requirements** — WCAG 1.4.3: 4.5:1 for text below 24px (or below 18.66px bold); 3:1 for larger. WCAG 1.4.11: 3:1 for UI component boundaries and states, and for meaningful graphics.

**The gate** (`FR-THEME-16`, `NFR-A11Y-04`), run at every theme save and every skin import (§7.4 stage 5):

| Pair class | Threshold | Behaviour |
|---|---|---|
| Text foreground on its surface (`*Foreground` on its `*`, `mutedForeground` on `background`/`card`/`muted`, `*Strong` on `*Subtle` and `background`, chart series on `card`) | 4.5:1 | **Blocks the save** |
| Large-text-only pairs (KPI value, screen title — computed at their actual token size) | 3:1 | **Blocks the save** |
| Control boundaries and state indicators (`borderStrong`, `ring`, `primary` as a switch fill) vs their surfaces | 3:1 | **Warns** |
| Explicitly exempt, by name | — | Skipped, and the report says they were skipped and why: `border` (decorative divider only), `card` vs `background` (surface separation carried by border/shadow), `disabledSurface`/`disabledForeground` (WCAG 1.4.3 excludes disabled controls), `skeleton` (no text), `overlay` (scrim) |

The pair matrix is **data, not code** — `tokens/contrast-pairs.ts` lists every pair with its class and threshold. Adding a semantic token without adding its pairs fails the test in §12.4, so the gate cannot silently fall behind the token set.

The failure report names the token pair, the computed ratio, the required ratio, and a **suggested nearest-passing value** computed by walking the foreground's lightness in OKLCH until the ratio clears, so the admin is given a fix rather than a refusal. One-click restore to the shipped default is always available (§9.2 rule 5).

## 10.3 Focus management

- `:focus-visible` only, never `:focus`. The wireframe already does this (§7.4) and it is a one-line rule with a large payoff: clicking a button leaves no ring, tabbing to it does.
- A single ring recipe, from tokens: `outline: var(--focus-ring-width) solid var(--ring); outline-offset: var(--focus-ring-offset);`. `outline` rather than `box-shadow` so the ring survives `overflow: hidden` ancestors — a real problem in the sticky table header and the widget shell.
- `--ring-offset` tracks `--background`, so the ring reads on `card`, `muted` and `sidebar` alike.
- Focus is **never** removed. `outline: none` without a replacement fails lint (§12.2).
- Focus order follows DOM order. No positive `tabindex` anywhere; that also fails lint.
- Focus return is mandatory after any overlay closes, after `NodeInspector` closes back to its node, after a `Dialog`, and after a `DropdownMenu`.
- Skip link to `<main>` as the first focusable element in `AppShell`.
- Route change moves focus to the page `<h1>` and announces the new page name politely — the backoffice is client-rendered (`architecture.md` §9) so this does not happen for free.
- Sticky elements (`--z-sticky` table headers, the wizard step strip, the sub-tab bar) declare `scroll-margin-block-start` so a focused element below them is not scrolled under them.

## 10.4 Keyboard patterns per organism

| Organism | Model | Keys |
|---|---|---|
| `SubTabBar` | Radix Tabs, automatic activation | `Arrow` (reversed in RTL), `Home`/`End`, one tab stop |
| `ToggleRow` | Radix ToggleGroup, radio semantics | `Arrow`, `Home`/`End` |
| `DataTable` | Row-level, not cell-level | `Tab` through row controls; `Arrow` between rows when selectable/reorderable; `Space` selects; sort via `<th><button>` |
| `Wizard` | Tablist + panel | `Arrow` across steps, `Enter` opens, `Ctrl+Enter` saves the step, focus to panel heading on change |
| `PermissionMatrix` | `role="grid"`, `aria-activedescendant`, one tab stop | Full model in §5.5 #43: arrows, `Home`/`End`, `Ctrl+Home`/`Ctrl+End`, `PageUp`/`PageDown`, `Space`, `Shift+Space` (row), `Ctrl+Space` (column), `Ctrl+Z` |
| `GraphCanvas` | `role="application"`, roving tabindex over nodes | `Tab` enters at the selected node; `Arrow` to nearest neighbour in that direction; `Enter` opens detail; `Escape` back to canvas; `+`/`-` zoom; `0` fit; `/` focuses search. **Plus a mandatory list view** — the conformant path |
| `FlowCanvas` | roving tabindex in topological order | `ArrowDown`/`ArrowUp` along the flow; `ArrowLeft`/`ArrowRight` across sibling branches (reversed in RTL); `Enter` opens `NodeInspector` **and moves focus into it**; `Escape` returns focus to the originating node; `Delete` removes with confirmation. **Plus a mandatory outline view** |
| `ChatThread` | `role="log"`, `aria-live="polite"`, `aria-relevant="additions"` | Focus stays in the `Composer`; `Enter` sends, `Shift+Enter` newline. Turn actions reachable by `Tab`. Streaming turns announced once on completion, not per token |
| `RuleListEditor` | List with reorder buttons | `Alt+ArrowUp`/`Alt+ArrowDown` reorder the focused rule; the new order is announced |
| `Dialog`/`Sheet` | Radix | `Escape`, trap, return |

**Why the canvases get a mandatory second representation rather than a cleverer keyboard model.** A node-link diagram's meaning is topological, and a screen reader traversing it linearly loses the topology no matter how good the ARIA is. The honest answer is to render the same model twice — a canvas for spatial reasoning and a list/outline for sequential reasoning — and keep them in sync from one data source. This is a real conformance path (WCAG 1.1.1 and 2.1.1), not a fallback, and the list view is not hidden behind a "accessibility mode" flag: it is a normal toggle any user can use, which is also how it stays maintained.

## 10.5 Target sizes, motion, forms

- **Targets** — minimum 24×24 CSS px (WCAG 2.5.8 AA); 44×44 preferred. `--control-height-md` is 40px at comfortable density and 34px at compact — both clear 24px. Icon-only buttons pad to at least 24×24 regardless of glyph size. Adjacent targets keep ≥ 4px clearance. **Compact density is disabled under `(pointer: coarse)`** with a visible note; the smallest target in the system is `PermissionMatrix`'s cell at `--matrix-cell-size` (`--row-height × 0.9`), which is 43px comfortable / 38px compact and therefore safe.
- **Motion** — §4.8's token collapse under `prefers-reduced-motion`. Additionally: nothing auto-plays, nothing flashes more than three times per second (WCAG 2.3.1), the A3 "Still thinking…" indicator renders a static glyph at `--motion-scale: 0`, and a user-level reduced-motion override exists in Appearance for users whose OS setting is not what they want in this app.
- **Forms** — every control labelled via `FormField`; placeholders are never labels; errors are text plus `aria-invalid` plus `aria-describedby`; a submit failure moves focus to a summary listing every error with a link to its field (this is what makes B3's 10-step Publish validation usable); required is the word "Required".
- **Zoom and reflow** — usable at 400% zoom / 320px equivalent width (WCAG 1.4.10). Everything is in `rem`, so the base-size control and browser zoom compose. Text spacing overrides (WCAG 1.4.12) must not clip: no fixed heights on text containers.
- **Timeouts** — the WhatsApp 24-hour session window and B14's retention settings are data lifetimes, not interaction timeouts, so WCAG 2.2.1 does not bite. Any future interaction timeout must be extendable.
- **Language** — `<html lang>` is set from the locale; a mixed-language passage carries its own `lang` (an Arabic quote in an English audit entry), so a screen reader switches voice — which matters directly for B10 tab 5's Aria (EN) / Layla (AR) voices.

## 10.6 Testing

`axe-core` runs in the component test suite over every Storybook story, in **both skins and both directions** — 4 permutations per story. Keyboard-only walkthroughs for the five hard organisms are Playwright specs with no mouse events available. Screen-reader verification is manual per release against NVDA + Firefox and VoiceOver + Safari, with the checklist in `docs/testing.md`. An `axe` violation fails CI; there is no severity threshold below which it is accepted.

---

# 11. Internationalisation & RTL

EN + AR, `dir` from locale, `next-intl` (`architecture.md` §9). B10 tab 5 is the locale model; B13 tab 1 measures Arabic parity at **71%** for the Arabic-language-parity golden set, and B13 tab 3's gate blocks publishing a bound Arabic agent below the floor. Arabic is therefore a *measured quality gate*, not a translation backlog — which is exactly why the UI cannot be built LTR-first.

## 11.1 Logical properties only

Physical direction properties are lint-banned (ADR-0007, §12.2). The mapping:

| Banned | Use |
|---|---|
| `padding-left` / `padding-right` | `padding-inline-start` / `padding-inline-end`, `padding-inline` |
| `margin-left` / `margin-right` | `margin-inline-start` / `-end` |
| `left` / `right` | `inset-inline-start` / `-end` |
| `text-align: left` / `right` | `text-align: start` / `end` |
| `border-left` / `border-right` | `border-inline-start` / `-end` |
| `border-radius` corner longhands | `border-start-start-radius` etc. |
| `float: left` / `right` | `float: inline-start` / `inline-end` |
| Tailwind `pl-4`, `mr-2`, `left-0`, `text-left` | `ps-4`, `me-2`, `start-0`, `text-start` |

Tailwind's logical utilities (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s`, `border-e`) are the only permitted forms. The physical ones are removed from the config where possible and caught by lint where not.

## 11.2 `dir` from locale

```tsx
// app/[locale]/layout.tsx
const dir = locale === "ar" ? "rtl" : "ltr";   // extended via a locale→dir map, not a ternary chain
<html lang={locale} dir={dir} data-theme={theme.mode} data-density={theme.density}>
```

`dir` is on `<html>`, set server-side, and is never toggled by client JavaScript on a live page — a mid-session direction flip is a full navigation, so no component has to handle a direction change at runtime. A skin's `direction: "locale"` (the default) means the locale decides; `"ltr"`/`"rtl"` force it, which exists only for preview and for the rare tenant that wants a fixed direction.

`--font-arabic` is applied at `:root:dir(rtl)` and to any `[lang="ar"]` subtree, so an Arabic string inside an English page still gets the Arabic face.

## 11.3 Bidirectional text

The backoffice is full of LTR-only strings living inside potentially-Arabic prose: `mcp://sharjah-services.internal`, `TXN-88213`, `+971 800 7342`, `text-embedding-3-large`, `get_bill_status(provider="SEWA")`, `v1.4`, `sara.almazrouei@shj.ae`. Placed naïvely in RTL text these reorder and become wrong — `mcp://customs.shj.ae` can render with its segments transposed.

Rules:

1. **`MonoSubLine`, `CodeBlock`, `Input variant="mono"` and every trace line are `dir="ltr"` with `unicode-bidi: isolate`.** Unconditionally, in both locales. This covers IDs, endpoints, versions, emails, phone numbers, model names, tool signatures and timestamps — which is most of what the mono face carries.
2. **User-authored content is `dir="auto"`** — chat bubbles, textareas, the system prompt (B3 step 2), rule values, source names, node labels. So an Arabic reply in an English session renders RTL, and an English quote in an Arabic transcript renders LTR, per turn.
3. **Interpolated values in translated strings are isolated.** `next-intl` messages wrap every placeholder in `⁨…⁩` (FSI/PDI) so `"{count} حالة"` cannot reorder around the number. This is enforced by the message-lint step in §12.
4. **Never build a sentence by concatenation.** A translated string is one message with named placeholders; string addition across a `dir` boundary is where bidi bugs come from. `SummaryStrip`'s `blocking` variant is the sharpest case — it interpolates an agent name, a percentage and a threshold into one sentence — so its props are structured and the message template owns the ordering.

## 11.4 Arabic typography

| Concern | Rule |
|---|---|
| Line height | `--leading-arabic: 1.75` on Arabic text, against 1.5 for Latin. Arabic diacritics and deep descenders collide at Latin leading |
| Optical size | Arabic renders optically smaller than Latin at the same `font-size`. The Arabic locale applies `--font-size-base: 0.9375rem` (15px) rather than 14px — a locale-level default, still overridable by the user's base-size control **[ASSUMPTION]** |
| Letter-spacing | **Never applied to Arabic.** `--tracking-*` breaks cursive joining and produces disconnected letterforms. Enforced by scoping every `tracking-*` utility away from `[lang="ar"]` in the base layer |
| Uppercase | Arabic has no case. `text-transform: uppercase` on micro-labels applies only under `:not(:lang(ar))` |
| Font stack | `--font-arabic` (§4.6). IBM Plex Sans Arabic pairs metrically with the Latin face, so mixed lines sit on one baseline |
| Truncation | Ellipsis on Arabic must respect joining; use `text-overflow: ellipsis` with the container `dir="rtl"`, never a JS character-count truncation |
| Numerals | Western Arabic digits (0–9), not Eastern Arabic-Indic (٠–٩) — `ar-AE-u-nu-latn`. UAE government digital services conventionally use Latin digits, and every ID, amount and version in this system is Latin-digit **[ASSUMPTION]** |

## 11.5 Formatting

All formatting goes through `Intl`, never a hand-rolled formatter, and the locale comes from `next-intl` rather than the browser.

| Value | Approach | EN example | AR example |
|---|---|---|---|
| Currency | `Intl.NumberFormat(locale, { style: "currency", currency: "AED" })` | `AED 412.00` | `‏412.00 د.إ.‏` |
| Number | `Intl.NumberFormat` with `numberingSystem: "latn"` | `36,410` | `36,410` |
| Percent | `Intl.NumberFormat(locale, { style: "percent" })` | `71%` | `71%` |
| Absolute date/time | `Intl.DateTimeFormat` in `Asia/Dubai`, always with the timezone available on hover | `8 Sep 2026, 11:42` | `٨ سبتمبر ٢٠٢٦، ١١:٤٢` → forced Latin digits per §11.4 |
| Relative time | `Intl.RelativeTimeFormat` for the wireframe's "12 min ago", "2 days ago" | `12 min ago` | `قبل ١٢ دقيقة` → Latin digits |
| Duration / latency | `Intl.NumberFormat` with `unit`; B14's `240 ms`, `1,840 ms` | `240 ms` | `240 مللي ثانية` |
| Sorting | `Intl.Collator(locale)`; never `Array.sort()` on strings | | Arabic collation differs from code-point order |
| Audit timestamps | ISO 8601 in the mono face, `dir="ltr"`, plus a localised relative form | `2026-09-08T07:42:11Z` | same — an immutable log entry is not localised (B14 tab 2) |

## 11.6 Mirroring rules

| Mirrors under RTL | Does not mirror |
|---|---|
| Page layout, sidebar side, rail side, table column order | **Logos and brand marks** (both `logoLight`/`logoDark` are direction-neutral assets) |
| Text alignment, list bullets, indentation | **Chart time axes** — time still runs left→right, because a mirrored time axis reads as reversed causality. B1's 7-bar channel split and every sparkline keep LTR axes |
| Directional icons: chevrons, arrows, back/forward, indent/outdent, undo/redo, send, list-order | **Graph and flow topology** — an edge's direction is data (§5.5 #44, #45) |
| `ProgressBar` fill origin, `Slider` direction, `Switch` thumb travel | **Phone numbers, IDs, endpoints, code, version strings, mono content** (§11.3) |
| Chat bubble alignment (user at inline-end) | **Media playback controls** — play still points right, by universal convention |
| Dropdown/popover `side` and `align`, tooltip placement | **Numeric and mono table columns** — cell content stays `dir="ltr"` even though the column order reverses |
| Pagination chevrons, breadcrumb separators | **The clock/spinner rotation direction** |
| Keyboard `ArrowLeft`/`ArrowRight` semantics in tabs, toggles, sliders, grids and canvases | **Checkbox/radio glyphs, the sparkle mark, mic and speaker icons** |

The `Icon` atom holds a `mirrorInRtl` allowlist; an icon not on the list does not mirror. Defaulting to "mirror everything" is how a mirrored mic icon ships.

## 11.7 The Arabic parity gate

B10 tab 5 records English at 100% translated and Arabic at 82%; B13 tab 1's Arabic-language-parity golden set scores 71%; B13 tab 3's gate blocks publishing an agent bound to a locale below 100% translated.

**RISK-007 — "Arabic readiness" is two numbers, and both can block the same publish.** 82% is *translation completeness* of the message catalogue (B10 tab 5, `NFR-I18N-03`, consumed by `FR-EVAL-09`'s locale gate). 71% is *test accuracy* on the Arabic-language-parity golden set (B13 tab 2, consumed by `FR-EVAL-08`'s accuracy gate against the 85% floor). They measure different things, they move independently, and the wireframe's `SummaryStrip` in B13 tab 3 cites only the accuracy failure — *"Arabic parity at 71% is below the 85% floor"*.

That is a design-system defect, not only a copy defect, because the strip is the component that carries the explanation. Consequence for `SummaryStrip`'s `blocking` variant (§5.4): its props take an **array** of failing conditions, not one, and it renders every one:

```ts
/** A blocking summary strip enumerates EVERY failing condition, never the first.
 *  RISK-007: an Arabic-bound agent can fail the locale gate and the accuracy
 *  gate simultaneously, for different reasons, from different figures. Surfacing
 *  one produces a user who fixes translation to 100% and is still blocked —
 *  the exact experience the gate exists to prevent (B13 tab 3 `[rule]`). */
type BlockingCondition = { blocked: string; measured: string; threshold: string; source: string };
type BlockingStripProps = { conditions: [BlockingCondition, ...BlockingCondition[]] };
```

Rendered for General FAQ Agent v3.0, both conditions appear:

> Gate is active. **General FAQ Agent v3.0** is blocked by 2 conditions.
> · Accuracy — Arabic language parity scored **71%**, below the **85%** floor. *(B13 tab 2)*
> · Locale — Arabic is **82%** translated, below the required **100%**. *(B10 tab 5)*

The non-negotiable part is the count in the first line: a reader must be able to tell that fixing one thing will not unblock the publish. Two design-system obligations follow for the UI's own Arabic readiness:

1. **The UI's own message catalogue is measured the same way.** A missing `ar` key is a CI failure, not a runtime fallback to English — an Arabic-speaking admin silently seeing English strings is the same defect class the gate exists to prevent. `next-intl` runs in strict mode with no implicit fallback in the backoffice.
2. **Every component's visual-regression snapshot exists in `ar` / `rtl`.** A component that has never been rendered in Arabic is a component whose RTL behaviour is unknown, and 57 unknowns is a retrofit.

---

# 12. Enforcement

> **Every check in this section lands in the first commit, before any feature code.** (`FR-THEME-19`)

ADR-0007's follow-up is explicit: *"The Tailwind config, the arbitrary-value lint rule and the logical-property lint rule land in the first commit. Retrofitting them after feature code exists means fixing hundreds of violations."* Seventeen screens of dense tables, wizards and matrices will produce a four-figure violation count if these rules arrive in month three, and a four-figure violation count gets the rules disabled rather than the code fixed. That is the failure mode this section exists to prevent.

## 12.1 Banned arbitrary values

```js
// eslint.config.js — excerpt
{
  plugins: { tailwindcss, shj3: local },
  rules: {
    // Bans bg-[#1F6F5C], p-[13px], rounded-[7px], text-[14px], w-[420px] …
    // Every arbitrary value is either a token that should exist or a literal
    // that should not. Both are decisions, not conveniences.
    "tailwindcss/no-arbitrary-value": "error",

    // Bans classes not present in the config — catches bg-red-500 after the
    // default palette was removed, and typos that would silently render nothing.
    "tailwindcss/no-custom-classname": ["error", { whitelist: ["shj3-theme"] }],

    // Bans raw colour literals, px lengths and font-family strings anywhere in
    // TS/TSX — style objects, SVG attributes, canvas fill styles, chart configs.
    // This is the rule that catches the places Tailwind never sees.
    "shj3/no-literal-design-values": ["error", {
      patterns: {
        color: "#[0-9a-fA-F]{3,8}\\b|\\b(rgb|rgba|hsl|hsla|oklch)\\(",
        length: "\\b\\d+(px|pt|em)\\b",
        font: "font-family\\s*:",
      },
      // The only sanctioned exceptions, each a file that exists to hold values.
      allow: [
        "tokens/primitives.css",
        "tokens/semantic.css",
        "skins/*.json",
        "components/patterns/skin-editor/**",   // §5.5 #55 — writes validated values into token slots
        "**/*.test.ts", "**/*.stories.tsx",
      ],
    }],
  },
}
```

Note the third rule. Tailwind lint alone leaves a large hole: SVG `fill` attributes (the graph and flow canvases), chart library configs, `style={{}}` props and canvas draw calls never pass through a Tailwind class. `GraphCanvas` and `ChartFrame` are exactly where a hardcoded hex would otherwise survive review, so the pattern check covers TS/TSX as well as CSS.

## 12.2 Banned physical properties

```js
{
  rules: {
    // Tailwind physical utilities: pl-*, pr-*, ml-*, mr-*, left-*, right-*,
    // text-left, text-right, border-l-*, border-r-*, rounded-l-*, float-left …
    "shj3/no-physical-direction-utilities": "error",

    // The same in CSS files.
    "declaration-property-value-disallowed-list": {
      "text-align": ["left", "right"],
    },
    "property-disallowed-list": [
      "padding-left", "padding-right", "margin-left", "margin-right",
      "border-left", "border-right", "border-left-width", "border-right-width",
      "border-left-color", "border-right-color", "left", "right",
      "border-top-left-radius", "border-top-right-radius",
      "border-bottom-left-radius", "border-bottom-right-radius",
    ],

    // Focus must never be removed without replacement.
    "shj3/no-outline-none-without-ring": "error",

    // No numeric z-index — §4.8's named scale only.
    "declaration-property-value-allowed-list": {
      "z-index": ["/^var\\(--z-/"],
    },

    // No positive tabindex (§10.3).
    "jsx-a11y/tabindex-no-positive": "error",
  },
}
```

Exception list for physical properties: exactly two files, both documented — the `whatsapp` rendering block in `AssistantWidgetShell` (WhatsApp's own chrome is LTR-fixed by the platform it imitates) and the print stylesheet.

## 12.3 The token-layer import rule

```js
{
  rules: {
    // Feature code may reference layer 2 (semantic) and layer 3 (component)
    // tokens only. A `--shj3-` prefixed variable in a feature file is a
    // layer-1 primitive reference and fails. (ADR-0007's token contract.)
    "shj3/no-primitive-token-reference": ["error", {
      pattern: "var\\(--shj3-",
      allow: ["tokens/semantic.css", "tokens/components.css"],
    }],

    // The inverse: a semantic token must be defined before it is used, so a
    // typo (`--muted-forground`) fails at lint rather than rendering
    // transparent text. Cross-checked against tokens/semantic.css.
    "shj3/no-undefined-token": "error",
  },
}
```

`no-undefined-token` matters more than it looks. An undefined custom property resolves to nothing, which for a colour means `unset` and for text often means *invisible*. Without this rule a typo produces a blank region that reviewers read as a styling bug rather than a spelling error.

Additional structural rules, each a one-liner with a real payoff:

| Rule | Prevents |
|---|---|
| `shj3/badge-requires-label` | `<Badge variant="success" />` with no text — the mechanical form of §6.1 |
| `shj3/icon-button-requires-label` | An unlabelled icon-only control |
| `shj3/no-bare-input` | An `Input` outside a `FormField` — i.e. an unlabelled field |
| `shj3/no-table-outside-datatable` | A hand-assembled `<table>` in a feature route, which is how 14 divergent tables happen |
| `shj3/message-placeholders-isolated` | An unisolated interpolation in a translated string (§11.3 rule 3) |
| `shj3/no-hardcoded-user-string` | A literal user-facing string not routed through `next-intl` |

## 12.4 Contrast tests

Two suites, both blocking.

```ts
// tokens/__tests__/contrast.spec.ts
import { CONTRAST_PAIRS } from "../contrast-pairs";
import { SHARJAH_DEFAULT, SHARJAH_DARK } from "../../skins";

/**
 * Asserts the shipped skins against the same pair matrix the runtime gate uses.
 * Failing this test means a shipped skin regressed, or a token was added
 * without its pairs — both are release blockers.
 */
describe.each([["Sharjah Default", SHARJAH_DEFAULT], ["Sharjah Dark", SHARJAH_DARK]])(
  "%s meets WCAG 2.1 AA",
  (_name, skin) => {
    it.each(CONTRAST_PAIRS.filter((p) => p.class === "text"))(
      "$fg on $bg >= 4.5:1",
      ({ fg, bg }) => expect(ratio(skin.tokens[fg], skin.tokens[bg])).toBeGreaterThanOrEqual(4.5),
    );

    it.each(CONTRAST_PAIRS.filter((p) => p.class === "non-text"))(
      "$fg on $bg >= 3:1",
      ({ fg, bg }) => expect(ratio(skin.tokens[fg], skin.tokens[bg])).toBeGreaterThanOrEqual(3),
    );

    // Coverage assertion: every semantic colour token appears in at least one
    // pair, or is on the documented exemption list with a stated reason.
    // Without this, adding a token silently escapes the gate.
    it("every colour token is covered by a pair or an exemption", () => {
      for (const token of COLOUR_TOKENS) {
        expect(coveredBy(CONTRAST_PAIRS, token) || EXEMPT.has(token)).toBe(true);
      }
    });
  },
);
```

The second suite is the **gate's own** test: property-based, generating random token sets, asserting that every set the gate accepts genuinely passes AA and every set it rejects genuinely fails — plus a fixture set of hostile skins (a `color` field containing `url(https://evil/x)`, a data-URI logo, a raw `font-family` string, an `assetId` belonging to another tenant, an unknown `schemaVersion`, a 5 MB file, a 40-deep nested object) asserting each is rejected at the correct stage with the correct message (§7.4).

## 12.5 Visual regression

| Aspect | Approach |
|---|---|
| Tool | Playwright screenshots against a Storybook build, one story per component variant |
| Matrix | **4 permutations per story**: `Sharjah Default` × `ltr`, `Sharjah Default` × `rtl`, `Sharjah Dark` × `ltr`, `Sharjah Dark` × `rtl`. Plus a fifth for the 12 layout-sensitive organisms: compact density |
| Breakpoints | Organism stories additionally snapshot at 560 / 820 / 1080 / 1400px (§4.9), because §7.3's collapses are the behaviour most likely to break silently |
| Determinism | Fonts self-hosted and preloaded; `--motion-scale: 0` and `prefers-reduced-motion` forced; all timestamps and IDs from fixtures; animations disabled; `Date` frozen |
| Threshold | 0.1% pixel difference. A diff is a review item, never an auto-accept |
| The theming-specific test | A **token-sweep** spec: render the full component gallery, then apply a generated skin that shifts every semantic token to a deliberately garish distinct hue, and assert **zero pixels** retain a default-skin colour. Any region that does not change is a hardcoded value the linters missed. This is the only test that directly proves ADR-0007's core claim — that changing a token repaints the whole app |

## 12.6 CI pipeline

Per `docs/deployment.md`, the frontend gate is one job that fails the build on any of:

1. `eslint` / `stylelint` — §12.1, §12.2, §12.3. Zero warnings permitted; warnings become errors in CI.
2. `tsc --noEmit` — no `any`, `strict: true`.
3. Unit + component tests, including the contrast suites (§12.4).
4. `axe-core` over every story, 4 permutations (§10.6). Zero violations.
5. Visual regression, including the token sweep (§12.5).
6. **Message-catalogue parity** — every `en` key has an `ar` key (§11.7).
7. **Guide-entry parity (Phase F)** — every route in the app's nav model has a user-guide entry with a current screenshot. A new page with no guide entry fails the build, which is the mechanical form of Phase F's maintenance rule.
8. **Token-doc parity** — the token tables in §4 of this document are generated from `tokens/semantic.css` and `tokens/components.css`; a drift between code and doc fails. `docs/` is a living deliverable, and this is what stops it decaying into fiction.

## 12.7 What a reviewer still has to do

The checks above cover *mechanical* conformance. Three things stay human, and a reviewer should be spending their attention here rather than hunting hex codes:

- **Is this a new component, or an existing one with a variant?** 57 components is the budget. The 58th needs an argument.
- **Does the status label read correctly to an operator?** §6.2 maps every string; a new state needs a place in that table, not an improvised label.
- **Does the RTL snapshot look right, or merely different?** A mirrored layout can pass a pixel diff and still read wrongly — a mirrored time axis, a mirrored logo, a reordered endpoint. §11.6 is the checklist.

---

## Appendix — Token count summary

| Category | Layer-2 tokens | Reference |
|---|---|---|
| Colour — surfaces, text, structure | 15 | §4.1 |
| Colour — brand | 7 | §4.2 |
| Colour — semantic status | 16 | §4.3 |
| Colour — assistant surface | 9 | §4.4 |
| Colour — sidebar, chart, utility | 19 | §4.5 |
| **Colour subtotal** | **66** | |
| Typography | 26 | §4.6 |
| Spacing & density | 22 | §4.7 |
| Radius | 8 | §4.8 |
| Shadow | 8 | §4.8 |
| Z-index | 8 | §4.8 |
| Motion | 10 | §4.8 |
| **Total layer 2, emitted as custom properties** | **147** | |
| Breakpoints (build-time, never emitted) | 4 | §4.9 |
| Layer 3 — component tokens | 42 | §4.10 |
| Layer 1 — primitives (not themable, not in skins) | 22 | §3.3 |

Breakpoints are listed separately rather than inside the layer-2 total: they are consumed by Tailwind at build time and never become CSS custom properties, so a "runtime tokens" count that included them would overstate what a skin can change.

| Component tier | Count |
|---|---|
| Atoms | 20 |
| Molecules | 20 |
| Organisms | 17 |
| **Total** | **57** |

