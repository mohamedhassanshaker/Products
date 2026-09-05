import type { ReactNode } from "react";
import { Outfit, Oxanium } from "next/font/google";
import { TooltipProvider } from "@nextbot/ui/components/ui/tooltip";
import { Toaster } from "@nextbot/ui/components/ui/toast";
import { cn } from "@nextbot/ui/lib/utils";
import "./globals.css";

/**
 * Plan Phase 0/1 font loading: `next/font/google` (not the shadcn preset's default
 * `<link>` snippet) — self-hosts the font files at build time (no runtime request to
 * Google Fonts, no layout-shift flash) and exposes each as a CSS variable matched to
 * `globals.css`'s `@theme inline` mapping (`--font-heading` / `--font-sans`).
 */
const oxaniumHeading = Oxanium({ subsets: ["latin"], variable: "--font-heading" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "NextBot Admin Console",
  description: "NextBot Admin Console",
};

/**
 * Root layout (Phase 3, BL-01 slice C; shadcn/Tailwind cutover — Plan Phase 1).
 * `lang`/`dir` are set per-request once the `next-intl` locale scaffold lands
 * (NFR-8 RTL support) — English-only, `dir="ltr"` for this dispatch, per the
 * plan's own scope note.
 *
 * Chakra's `<AppProviders>` (`ChakraProvider`) is intentionally *not* mounted here
 * anymore — Tailwind's `globals.css` + the two font variables are now the whole
 * root-level styling surface. `AdminShell.tsx` (mounted one level down, inside the
 * `(admin)` route group) still nests a *temporary* `<ChakraProvider>` directly
 * around `{children}` so the ~45-50 screens not yet migrated off Chakra keep
 * rendering correctly until Plan Phase 3 removes that shim — this root layout is
 * shared by the login/forgot-password screens too, which have no such shim (they're
 * fully converted in this same dispatch).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={cn("font-sans", outfit.variable, oxaniumHeading.variable)}>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        {/* Batch A (Plan Phase 2): mounted once here so every screen's
            `toast.success(...)`/`toast.error(...)` (`@nextbot/ui/lib/toast`) has
            somewhere to render, same pattern as `TooltipProvider` above. */}
        <Toaster />
      </body>
    </html>
  );
}
