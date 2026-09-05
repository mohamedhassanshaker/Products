'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Button, Field, Heading, Input, Stack, Text } from '@chakra-ui/react';
import { BackToTenantsLink } from '@/components/platform/platform-shell';
import { toaster } from '@/components/ui/toaster';
import { createTenant, isPlatformApiError } from '@/lib/platform-console';

/** Maps a per-field hard-rejection `ErrorCode` to the field it belongs on, per
 * `docs/design/UX_GUIDELINES.md` §3.3 step 7's exact copy table. */
const FIELD_ERROR_COPY: Record<string, { field: 'name' | 'subdomainSlug' | 'adminEmail'; message: string }> = {
  TENANT_NAME_REQUIRED: { field: 'name', message: 'Enter a tenant name.' },
  INVALID_SUBDOMAIN: { field: 'subdomainSlug', message: "This subdomain isn't valid. Use lowercase letters, numbers, and hyphens only." },
  SUBDOMAIN_TAKEN: { field: 'subdomainSlug', message: 'This subdomain is already in use. Try another.' },
  VALIDATION_FAILED: { field: 'adminEmail', message: 'Enter a valid email address.' },
};

/**
 * Create-tenant screen (`docs/design/UX_GUIDELINES.md` §3.3) — a dedicated route
 * (`/platform/tenants/new`), not a modal (see `docs/plans/nextjs-rewrite-phase2-plan.md`'s "Decisions
 * made" for why a dedicated route was chosen over the doc's "either is acceptable" guidance: simpler,
 * more robust focus management in this stack, and consistent deep-linkability for any future
 * console create-flow).
 *
 * The submit call is genuinely synchronous and can take several seconds (the full provisioning
 * workflow runs inline) — every field and both buttons disable for the duration, and an explicit
 * "don't close this window" banner renders alongside the button's own spinner (§3.3's explicit
 * "visibility of system status" requirement for an atypically long operation).
 */
export default function CreateTenantPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [subdomainSlug, setSubdomainSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'subdomainSlug' | 'adminEmail', string>>>({});
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFieldErrors({});
    setBannerMessage(null);

    setSubmitting(true);
    try {
      const tenant = await createTenant({ name, subdomainSlug, adminEmail });
      // A `Failed`-status result is still a *success* from this form's point of view (§3.3 step 6) —
      // a row was created; the detail screen's own provisioningError panel is where that gets surfaced.
      toaster.create({ type: 'success', title: `Tenant '${tenant.name}' created.` });
      router.replace(`/platform/tenants/${tenant.id}`);
    } catch (error) {
      if (isPlatformApiError(error) && FIELD_ERROR_COPY[error.code]) {
        const { field, message } = FIELD_ERROR_COPY[error.code];
        setFieldErrors({ [field]: message });
      } else {
        setBannerMessage('Something went wrong while creating this tenant. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="6" maxW="lg">
      <BackToTenantsLink />
      <Heading size="lg">Create tenant</Heading>

      <Box as="form" onSubmit={handleSubmit}>
        <Stack gap="5">
          {bannerMessage && (
            <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {bannerMessage}
            </Box>
          )}

          <Field.Root invalid={!!fieldErrors.name} required>
            <Field.Label>Tenant name</Field.Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
            {fieldErrors.name && <Field.ErrorText>{fieldErrors.name}</Field.ErrorText>}
          </Field.Root>

          <Field.Root invalid={!!fieldErrors.subdomainSlug} required>
            <Field.Label>Subdomain</Field.Label>
            <Input
              value={subdomainSlug}
              onChange={(e) => setSubdomainSlug(e.target.value.toLowerCase())}
              disabled={submitting}
              aria-describedby="subdomain-preview"
            />
            <Text id="subdomain-preview" fontSize="sm" color="gray.600">
              {subdomainSlug ? `${subdomainSlug}.examland.app` : 'your-slug.examland.app'}
            </Text>
            {fieldErrors.subdomainSlug && <Field.ErrorText>{fieldErrors.subdomainSlug}</Field.ErrorText>}
          </Field.Root>

          <Field.Root invalid={!!fieldErrors.adminEmail} required>
            <Field.Label>Admin email</Field.Label>
            <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} disabled={submitting} />
            {fieldErrors.adminEmail && <Field.ErrorText>{fieldErrors.adminEmail}</Field.ErrorText>}
          </Field.Root>

          {submitting && (
            <Box role="status" aria-live="polite" bg="brand.subtle" color="brand.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              Provisioning your tenant… this can take a few seconds. Please don&apos;t close this window.
            </Box>
          )}

          <Stack direction="row" gap="3">
            <Button type="submit" colorPalette="brand" loading={submitting} loadingText="Creating tenant…">
              Create tenant
            </Button>
            <Button variant="outline" disabled={submitting} onClick={() => router.push('/platform/tenants')}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
