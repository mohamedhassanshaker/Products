'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Button, Field, Heading, Input, Stack, Text } from '@chakra-ui/react';
import { isTenantApiError, useTenantAuthContext } from '@/lib/tenant-console/auth-context';

/**
 * Tenant-user login (`docs/design/UX_GUIDELINES.md` §19's `auth-shell`-style centered-card screen, not
 * the sidebar shell — the user has no session/nav context yet). This is the tenant realm's first-ever
 * UI screen in this migration (see `docs/plans/nextjs-rewrite-phase3-plan.md`'s "Decisions made" #1 for
 * why it had to be built even though it wasn't itemized in this dispatch's own scope list) — mirrors
 * `app/platform/login/page.tsx`'s exact structural pattern.
 *
 * Enumeration-safety: any rejection (unknown email, wrong password, inactive account) renders the
 * identical generic banner below — this route never distinguishes them to the client.
 *
 * Wrapped in `Suspense` because the inner component reads `useSearchParams()` (the `returnUrl` query
 * param) — a Next.js App Router requirement for any Client Component using it.
 */
export default function TenantLoginPage() {
  return (
    <Suspense fallback={null}>
      <TenantLoginForm />
    </Suspense>
  );
}

function TenantLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, status } = useTenantAuthContext();

  // Pre-filled when arriving from `/start` (the tenant-picker page) with `?email=` — never a
  // password (see `app/start/page.tsx`'s own doc comment for why that can't be carried across the
  // origin change from the apex host to this tenant's own subdomain).
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);

  // Already authenticated (e.g. a stored token survived a reload) — skip straight past the login form.
  // Phase 9 sub-slice "9c" added the real dashboard at `/` — the default landing target once no
  // `returnUrl` was supplied (previously `/curricula`, before a dashboard existed).
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(searchParams.get('returnUrl') ?? '/');
    }
  }, [status, router, searchParams]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBannerMessage(null);
    if (!email || !password || submitting) return;

    setSubmitting(true);
    try {
      await login(email, password);
      router.replace(searchParams.get('returnUrl') ?? '/');
    } catch (error) {
      setPassword('');
      setBannerMessage(
        isTenantApiError(error) && error.status === 401
          ? 'The email or password you entered is incorrect.'
          : 'Could not reach the server. Check your connection and try again.',
      );
      queueMicrotask(() => bannerRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box minH="100dvh" display="flex" alignItems="center" justifyContent="center" bg="gray.50" p="4">
      <Box as="form" onSubmit={handleSubmit} maxW="sm" w="full" bg="white" borderRadius="lg" borderWidth="1px" boxShadow="md" p="8">
        <Stack gap="6">
          <Stack gap="1" textAlign="center">
            <Heading size="lg" color="brand.700">
              ExamLand
            </Heading>
            <Text color="gray.600" fontSize="sm">
              Sign in to your account.
            </Text>
          </Stack>

          {bannerMessage && (
            <Box ref={bannerRef} tabIndex={-1} role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {bannerMessage}
            </Box>
          )}

          <Field.Root required>
            <Field.Label>Email</Field.Label>
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Password</Field.Label>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} />
          </Field.Root>

          <Button type="submit" colorPalette="brand" loading={submitting} loadingText="Signing in…">
            Sign in
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
