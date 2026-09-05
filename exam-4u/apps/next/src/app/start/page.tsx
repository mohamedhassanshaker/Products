'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, Button, Field, Heading, Input, Stack, Text } from '@chakra-ui/react';

const SUBDOMAIN_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The tenant-picker entry page — added directly in response to a real UX gap a user hit: browsing the
 * bare apex/reserved host (e.g. `localhost:3010`) previously surfaced a raw `TENANT_NOT_FOUND` JSON
 * envelope instead of any usable page, since `middleware.ts` resolves every tenant-realm route from
 * the `Host` header alone and this app (like legacy before it) has no concept of a tenant chooser.
 *
 * Deliberately tenant-independent (excluded from `middleware.ts`'s matcher) — its whole job is
 * getting a user who doesn't know their own subdomain to it. `middleware.ts` also redirects any
 * top-level page navigation that fails tenant resolution here automatically.
 *
 * **Only Tenant + Email are collected here, not Password** — a deliberate deviation from the
 * reference three-field mock this page was modeled on. This app's tenant resolution is strictly
 * `Host`-header-based (every JWT claim, signed URL, and RBAC check is scoped to the resolved tenant),
 * so completing sign-in requires a real navigation to the target tenant's own subdomain/origin —
 * there is no secure way to carry a password across that origin change (unlike Tenant/Email, which
 * are safe to forward as a query param). The target tenant's own `/login` page (already built, fully
 * functional) is where the password is actually entered, pre-filled with the email typed here.
 */
export default function StartPage() {
  return (
    <Suspense fallback={null}>
      <TenantPickerForm />
    </Suspense>
  );
}

function TenantPickerForm() {
  const searchParams = useSearchParams();
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const slug = tenant.trim().toLowerCase();
    if (!SUBDOMAIN_SLUG_PATTERN.test(slug)) {
      setError('Enter your organization’s workspace address (lowercase letters, numbers, and hyphens only).');
      return;
    }
    setError(null);

    // The current host is whatever apex/base domain this page itself was reached at (e.g.
    // `localhost:3010`, `examland.local`) — prepending the slug reconstructs the tenant's real
    // subdomain without this page needing to know the configured apex domain itself.
    const targetHost = `${slug}.${window.location.hostname}`;
    const port = window.location.port ? `:${window.location.port}` : '';
    const query = email.trim() ? `?email=${encodeURIComponent(email.trim())}` : '';
    window.location.href = `${window.location.protocol}//${targetHost}${port}/login${query}`;
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
              Find your organization&apos;s workspace to sign in.
            </Text>
          </Stack>

          {error && (
            <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {error}
            </Box>
          )}

          <Field.Root required>
            <Field.Label>Workspace</Field.Label>
            <Input
              placeholder="your-company"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>Email (optional)</Field.Label>
            <Input type="email" placeholder="you@your-company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field.Root>

          <Button type="submit" colorPalette="brand">
            Continue
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
