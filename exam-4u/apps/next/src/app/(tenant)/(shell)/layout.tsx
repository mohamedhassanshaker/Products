'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Center, Spinner } from '@chakra-ui/react';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';
import { TenantShell } from '@/components/tenant/tenant-shell';

/**
 * The authenticated half of the tenant realm (every route except `/login` itself) — a route group
 * (`(shell)`, no URL segment) so `/curricula`/`/settings/taxonomy` render inside {@link TenantShell}
 * while `/login` stays a bare centered card with no sidebar chrome. Mirrors
 * `app/platform/(console)/layout.tsx`'s exact pattern.
 *
 * Client-side auth guard (this app has no server-side session/cookie to check in a Server Component —
 * the tenant-user token lives in `localStorage`): redirects to `/login?returnUrl=...` the moment the
 * auth context resolves to `'unauthenticated'`, and renders nothing but a full-page loading spinner
 * while it's still `'checking'` (avoids a flash of shell content before the stored token is verified
 * against a real `GET /api/auth/me` call).
 */
export default function TenantShellLayout({ children }: { children: ReactNode }) {
  const { status } = useTenantAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      const returnUrl = encodeURIComponent(pathname ?? '/');
      router.replace(`/login?returnUrl=${returnUrl}`);
    }
  }, [status, router, pathname]);

  if (status !== 'authenticated') {
    return (
      <Center minH="100dvh">
        <Spinner size="xl" color="brand.solid" />
      </Center>
    );
  }

  return <TenantShell>{children}</TenantShell>;
}
