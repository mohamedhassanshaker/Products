import type { ReactNode } from 'react';
import { TenantAuthProvider } from '@/lib/tenant-console/auth-context';

/**
 * Tenant realm root layout (Phase 3, the first tenant-realm UI in this migration) — mounts
 * {@link TenantAuthProvider} once for the whole tenant realm (login page included, since the login
 * form itself calls `login()` through this same context), mirroring `app/platform/layout.tsx`'s
 * identical shape. `(tenant)` is a bare route group (no URL segment) — tenant pages live at plain
 * top-level paths (`/login`, `/curricula`, `/settings/taxonomy`), unlike `/platform/**`'s real path
 * segment, since every one of these paths *should* go through `middleware.ts`'s tenant resolution
 * (that's the entire point of the tenant realm) — no matcher exclusion is needed or added.
 */
export default function TenantRootLayout({ children }: { children: ReactNode }) {
  return <TenantAuthProvider>{children}</TenantAuthProvider>;
}
