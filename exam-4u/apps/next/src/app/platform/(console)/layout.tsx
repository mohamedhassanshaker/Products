'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Center, Spinner } from '@chakra-ui/react';
import { usePlatformAuthContext } from '@/lib/platform-console/auth-context';
import { PlatformShell } from '@/components/platform/platform-shell';

/**
 * The authenticated half of `/platform/**` (every route except `/platform/login` itself) — a route
 * group (`(console)`, no URL segment of its own) so `/platform/tenants` etc. render inside
 * {@link PlatformShell} while `/platform/login` stays a bare centered card with no sidebar chrome.
 *
 * Client-side auth guard (this app has no server-side session/cookie to check in a Server Component
 * — the platform-admin token lives in `localStorage`, see `lib/platform-console/token-storage.ts`):
 * redirects to `/platform/login?returnUrl=...` the moment the auth context resolves to
 * `'unauthenticated'`, and renders nothing but a full-page loading spinner while it's still
 * `'checking'` (avoids a flash of console content before the stored token is verified against a real
 * `GET /api/platform/auth/me` call).
 */
export default function PlatformConsoleLayout({ children }: { children: ReactNode }) {
  const { status } = usePlatformAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      const returnUrl = encodeURIComponent(pathname ?? '/platform/tenants');
      router.replace(`/platform/login?returnUrl=${returnUrl}`);
    }
  }, [status, router, pathname]);

  if (status !== 'authenticated') {
    return (
      <Center minH="100dvh">
        <Spinner size="xl" color="brand.solid" />
      </Center>
    );
  }

  return <PlatformShell>{children}</PlatformShell>;
}
