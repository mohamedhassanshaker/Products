'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Box, Button, Field, Heading, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { toaster } from '@/components/ui/toaster';
import { createPackage, isPlatformApiError } from '@/lib/platform-console';

const FIELD_ERROR_COPY: Record<string, { field: 'key'; message: string }> = {
  PACKAGE_KEY_EXISTS: { field: 'key', message: 'A package with this key already exists.' },
};

/** Create-package screen (FR-PKG-7) — a dedicated route (`/platform/packages/new`), matching §18.1's
 * established precedent. Price is entered as a decimal dollar amount and converted to whole cents
 * before submitting (matching `priceCents`'s wire shape). */
export default function CreatePackagePage() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceDollars, setPriceDollars] = useState('0.00');
  const [sortOrder, setSortOrder] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'key', string>>>({});
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFieldErrors({});
    setBannerMessage(null);

    const priceCents = Math.round(Number.parseFloat(priceDollars || '0') * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setBannerMessage('Enter a valid, non-negative price.');
      return;
    }

    setSubmitting(true);
    try {
      const pkg = await createPackage({
        key,
        name,
        description: description || undefined,
        priceCents,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      });
      toaster.create({ type: 'success', title: `Package '${pkg.name}' created.` });
      router.replace(`/platform/packages/${pkg.id}`);
    } catch (error) {
      if (isPlatformApiError(error) && FIELD_ERROR_COPY[error.code]) {
        const { field, message } = FIELD_ERROR_COPY[error.code];
        setFieldErrors({ [field]: message });
      } else if (isPlatformApiError(error) && error.code === 'VALIDATION_FAILED') {
        setBannerMessage('Please check the fields above and try again.');
      } else {
        setBannerMessage('Something went wrong while creating this package. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="6" maxW="lg">
      <Link href="/platform/packages">
        <Text color="brand.fg" fontWeight="medium" display="inline-block">
          ← Back to packages
        </Text>
      </Link>
      <Heading size="lg">Create package</Heading>

      <Box as="form" onSubmit={handleSubmit}>
        <Stack gap="5">
          {bannerMessage && (
            <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {bannerMessage}
            </Box>
          )}

          <Field.Root invalid={!!fieldErrors.key} required>
            <Field.Label>Key</Field.Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={submitting} placeholder="pro" />
            {fieldErrors.key && <Field.ErrorText>{fieldErrors.key}</Field.ErrorText>}
          </Field.Root>

          <Field.Root required>
            <Field.Label>Name</Field.Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          </Field.Root>

          <Field.Root>
            <Field.Label>Description</Field.Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={submitting} />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Price (USD/month)</Field.Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              disabled={submitting}
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>Sort order</Field.Label>
            <Input type="number" min="0" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={submitting} />
          </Field.Root>

          <Stack direction="row" gap="3">
            <Button type="submit" colorPalette="brand" loading={submitting}>
              Create package
            </Button>
            <Button variant="outline" disabled={submitting} onClick={() => router.push('/platform/packages')}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
