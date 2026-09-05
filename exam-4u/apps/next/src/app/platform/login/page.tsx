'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Button, Field, Heading, Input, Stack, Text } from '@chakra-ui/react';
import { isPlatformApiError, usePlatformAuthContext } from '@/lib/platform-console/auth-context';

/**
 * Platform Admin login (`docs/design/UX_GUIDELINES.md` §3.0) — a centered-card `auth-shell`-style
 * screen (not the sidebar console shell), matching the doc's "identical flow/state/copy pattern as
 * §2.1 (Login), minus the tenant branding pre-fetch and the registration/forgot-password links."
 *
 * Enumeration-safety: `INVALID_CREDENTIALS`-equivalent rejections (unknown email, wrong password, or
 * a deactivated admin — `PlatformAdminAuthService.login`'s own documented single rejection path) all
 * render the identical generic message below; both fields are flagged together via one form-level
 * banner, never a per-field error (§3.0/§2.1's shared enumeration-safety rule).
 *
 * Wrapped in `Suspense` because the inner component reads `useSearchParams()` (the `returnUrl` query
 * param) — Next.js App Router requires that boundary for any Client Component using it, or the whole
 * route is forced out of static rendering with a build-time warning.
 */
export default function PlatformLoginPage() {
  return (
    <Suspense fallback={null}>
      <PlatformLoginForm />
    </Suspense>
  );
}

function PlatformLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, status } = usePlatformAuthContext();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);

  // Already authenticated (e.g. a stored token survived a reload) — skip straight past the login
  // form to the console, honoring a `returnUrl` query param the same way the legacy screen does.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(searchParams.get('returnUrl') ?? '/platform/tenants');
    }
  }, [status, router, searchParams]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBannerMessage(null);
    if (!email || !password || submitting) return;

    setSubmitting(true);
    try {
      await login(email, password);
      router.replace(searchParams.get('returnUrl') ?? '/platform/tenants');
    } catch (error) {
      setPassword('');
      setBannerMessage(
        isPlatformApiError(error) && error.status === 401
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
              ExamLand Platform Admin
            </Heading>
            <Text color="gray.600" fontSize="sm">
              Sign in to manage tenants.
            </Text>
          </Stack>

          {bannerMessage && (
            <Box
              ref={bannerRef}
              tabIndex={-1}
              role="alert"
              aria-live="assertive"
              bg="red.subtle"
              color="red.fg"
              borderRadius="md"
              px="4"
              py="3"
              fontSize="sm"
            >
              {bannerMessage}
            </Box>
          )}

          <Field.Root required>
            <Field.Label>Email</Field.Label>
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Password</Field.Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </Field.Root>

          <Button type="submit" colorPalette="brand" loading={submitting} loadingText="Signing in…">
            Sign in
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
