import type { ReactNode } from 'react';
import { PlatformAuthProvider } from '@/lib/platform-console/auth-context';

/**
 * `/platform/**` root layout — mounts {@link PlatformAuthProvider} once for the whole platform
 * console (login page included, since the login form itself calls `login()` through this same
 * context). See `src/middleware.ts`'s own updated matcher/doc-comment for why `/platform/**` is
 * excluded from tenant resolution the same way `/api/platform/**` already was (this dispatch's own
 * decision — `docs/plans/nextjs-rewrite-phase2-plan.md`).
 */
export default function PlatformRootLayout({ children }: { children: ReactNode }) {
  return <PlatformAuthProvider>{children}</PlatformAuthProvider>;
}
