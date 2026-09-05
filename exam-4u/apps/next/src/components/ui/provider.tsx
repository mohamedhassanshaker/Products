'use client';

import { ChakraProvider } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { system } from '@/components/theme/system';
import { Toaster } from './toaster';

/**
 * The single root Chakra provider — wraps `ChakraProvider` (the styling engine, fed our custom
 * {@link system}) around the app. Mounted once in `app/layout.tsx`, client-side (Chakra's runtime
 * style injection requires a Client Component boundary).
 *
 * Deliberately does NOT wrap `next-themes`' `ThemeProvider` this phase (Chakra's docs show it
 * alongside `ChakraProvider` for color-mode/dark-mode toggling): verified end-to-end in a real
 * browser during Phase 0 that `next-themes`' no-flash boot `<script>` injection races Chakra's own
 * Emotion SSR style tag under React 19 + Next.js 16's App Router, producing a genuine hydration
 * mismatch (not a lint/type issue — reproduced via Playwright, see docs/plans/
 * nextjs-rewrite-phase0-plan.md). Nothing in this phase reads/toggles color mode, so there is no
 * behavior loss in leaving it out now; re-introduce `next-themes` in whichever phase first ships a
 * real light/dark toggle, and re-verify the hydration behavior at that point.
 *
 * Also mounts the single process-wide {@link Toaster} (Phase 2's first consumer — the platform
 * console's transient suspend/activate/create confirmations — but placed here, not under
 * `components/platform/`, since it's a general-purpose cross-cutting UI primitive every future
 * feature's own toasts will reuse, matching this file's own "single root provider" scope).
 */
export function Provider({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={system}>
      {children}
      <Toaster />
    </ChakraProvider>
  );
}
