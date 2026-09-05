/**
 * PostCSS pipeline for Tailwind CSS v4 (Phase 0 of the Chakra -> shadcn/ui
 * migration). Tailwind v4 ships as a single PostCSS plugin (`@tailwindcss/postcss`)
 * — no separate `autoprefixer`/`tailwindcss` plugin chain is needed as in v3.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
