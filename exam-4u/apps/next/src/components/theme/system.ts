import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

/**
 * ExamLand's Chakra UI v3 design-system config (migration plan: "Chakra v3's CSS-variable-first
 * theming maps directly onto the existing single-CSS-custom-property tenant branding mechanism").
 *
 * **Phase 9 sub-slice "9a" update**: `brand.{50..900}` now resolve to the `--brand-accent-{step}` CSS
 * custom properties `components/theme/accent-scale.ts` derives from the acting tenant's persisted
 * accent hex and the root layout (`app/layout.tsx`) server-renders onto `<html>` — this is the same
 * `brand` palette every existing page already uses (`colorPalette="brand"`, `brand.700`, `brand.solid`,
 * etc.), so the whole app picks up a tenant's live accent color with zero per-component changes, and
 * with no FOUC (the vars are present in the very first server-rendered HTML byte). Each token also
 * carries a literal hex fallback (Chakra token `value` strings don't support CSS `var(x, fallback)`
 * syntax directly, so the fallback is instead guaranteed by `app/layout.tsx` ALWAYS emitting every
 * `--brand-accent-*` var — including on routes with no resolved tenant — rather than leaving any var
 * undefined; see that file's own doc comment) seeded from the previous Phase 0 placeholder ramp.
 */
const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: 'var(--brand-accent-50)' },
          100: { value: 'var(--brand-accent-100)' },
          200: { value: 'var(--brand-accent-200)' },
          300: { value: 'var(--brand-accent-300)' },
          400: { value: 'var(--brand-accent-400)' },
          500: { value: 'var(--brand-accent)' },
          600: { value: 'var(--brand-accent-600)' },
          700: { value: 'var(--brand-accent-700)' },
          800: { value: 'var(--brand-accent-800)' },
          900: { value: 'var(--brand-accent-900)' },
        },
      },
    },
    // Required for `colorPalette="brand"` to resolve on component recipes (Badge/Button's
    // solid/subtle/outline variants read `colorPalette.solid`/`.contrast`/etc., not the raw
    // `colors.brand.*` scale directly) — Chakra v3 only auto-generates these for its own built-in
    // palette names, so a custom palette must define them explicitly. Shape/naming follows Chakra's
    // own documented semantic-token convention for a color palette.
    semanticTokens: {
      colors: {
        brand: {
          solid: { value: '{colors.brand.600}' },
          contrast: { value: '{colors.brand.50}' },
          fg: { value: '{colors.brand.700}' },
          muted: { value: '{colors.brand.100}' },
          subtle: { value: '{colors.brand.50}' },
          emphasized: { value: '{colors.brand.300}' },
          focusRing: { value: '{colors.brand.500}' },
        },
      },
    },
  },
});

/** The process-wide Chakra system, consumed by `components/ui/provider.tsx`. */
export const system = createSystem(defaultConfig, config);
