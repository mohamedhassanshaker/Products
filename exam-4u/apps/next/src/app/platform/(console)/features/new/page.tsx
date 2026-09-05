'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Box, Button, Field, Heading, Input, NativeSelect, Stack, Text, Textarea } from '@chakra-ui/react';
import { toaster } from '@/components/ui/toaster';
import { createFeature, isPlatformApiError } from '@/lib/platform-console';

const RESET_PERIODS = ['NONE', 'DAILY', 'MONTHLY'] as const;

/** Maps a hard-rejection `ErrorCode` to the field it belongs on — mirrors the tenants console's own
 * `FIELD_ERROR_COPY` convention (`app/platform/(console)/tenants/new/page.tsx`). */
const FIELD_ERROR_COPY: Record<string, { field: 'key'; message: string }> = {
  FEATURE_KEY_EXISTS: { field: 'key', message: 'A feature with this key already exists.' },
};

/** Create-feature screen (FR-PKG-7) — a dedicated route (`/platform/features/new`), matching the
 * precedent `docs/design/UX_GUIDELINES.md` §3.3/§18.1 established ("apply consistently to any future
 * console create-flow") rather than a modal. */
export default function CreateFeaturePage() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('');
  const [resetPeriod, setResetPeriod] = useState<(typeof RESET_PERIODS)[number]>('MONTHLY');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'key', string>>>({});
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFieldErrors({});
    setBannerMessage(null);
    setSubmitting(true);
    try {
      const feature = await createFeature({ key, name, description: description || undefined, unit, resetPeriod });
      toaster.create({ type: 'success', title: `Feature '${feature.name}' created.` });
      router.replace(`/platform/features/${feature.id}`);
    } catch (error) {
      if (isPlatformApiError(error) && FIELD_ERROR_COPY[error.code]) {
        const { field, message } = FIELD_ERROR_COPY[error.code];
        setFieldErrors({ [field]: message });
      } else if (isPlatformApiError(error) && error.code === 'VALIDATION_FAILED') {
        setBannerMessage('Please check the fields above and try again.');
      } else {
        setBannerMessage('Something went wrong while creating this feature. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="6" maxW="lg">
      <Link href="/platform/features">
        <Text color="brand.fg" fontWeight="medium" display="inline-block">
          ← Back to features
        </Text>
      </Link>
      <Heading size="lg">Create feature</Heading>

      <Box as="form" onSubmit={handleSubmit}>
        <Stack gap="5">
          {bannerMessage && (
            <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {bannerMessage}
            </Box>
          )}

          <Field.Root invalid={!!fieldErrors.key} required>
            <Field.Label>Key</Field.Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={submitting} placeholder="exams.create" />
            <Text fontSize="sm" color="gray.600">
              Lowercase letters, numbers, and separators (. _ -) only.
            </Text>
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
            <Field.Label>Unit</Field.Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={submitting} placeholder="exams" />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Reset period</Field.Label>
            <NativeSelect.Root disabled={submitting}>
              <NativeSelect.Field
                value={resetPeriod}
                onChange={(e) => setResetPeriod(e.target.value as (typeof RESET_PERIODS)[number])}
              >
                {RESET_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p === 'NONE' ? 'None (lifetime cap)' : p}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>

          <Stack direction="row" gap="3">
            <Button type="submit" colorPalette="brand" loading={submitting}>
              Create feature
            </Button>
            <Button variant="outline" disabled={submitting} onClick={() => router.push('/platform/features')}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
