/**
 * PostCSS entry point for Tailwind v4 (design-system.md §3.4, ADR-0007).
 *
 * v4 moved its build-time processing (the `@import "tailwindcss"` expansion,
 * `@theme` resolution, utility generation) out of the old JS `tailwind.config`
 * pipeline and into a dedicated PostCSS plugin package. Next.js's own build
 * already runs PostCSS for CSS Modules and autoprefixing, so this is the only
 * file needed to opt that existing pipeline into Tailwind — no `tailwind.config.ts`
 * is required for a CSS-first v4 setup.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
