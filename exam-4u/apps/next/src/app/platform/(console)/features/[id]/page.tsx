'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Badge, Box, Button, Field, Heading, HStack, Input, NativeSelect, Skeleton, Stack, Text, Textarea } from '@chakra-ui/react';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { toaster } from '@/components/ui/toaster';
import { deleteFeature, getFeature, isPlatformApiError, updateFeature, type FeatureSummary } from '@/lib/platform-console';

const RESET_PERIODS = ['NONE', 'DAILY', 'MONTHLY'] as const;

type LoadState = 'loading' | 'loaded' | 'error' | 'not-found';

/**
 * Feature edit screen (FR-PKG-7) — this app's Chakra v3 re-derivation of
 * `legacy/web/src/app/features/platform/features/feature-form/**`. The `key` field is disabled
 * whenever the loaded feature is `isReferenced` (§7.1's preemptive Key-lock UX: never let the admin
 * type a new key only to get a post-submit `409 FEATURE_KEY_IMMUTABLE`).
 */
export default function FeatureDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [state, setState] = useState<LoadState>('loading');
  const [feature, setFeature] = useState<FeatureSummary | null>(null);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('');
  const [resetPeriod, setResetPeriod] = useState<(typeof RESET_PERIODS)[number]>('MONTHLY');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await getFeature(id);
      setFeature(result);
      setKey(result.key);
      setName(result.name);
      setDescription(result.description ?? '');
      setUnit(result.unit);
      setResetPeriod(result.resetPeriod);
      setState('loaded');
    } catch (error) {
      setState(isPlatformApiError(error) && error.status === 404 ? 'not-found' : 'error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saving || !feature) return;
    setBannerMessage(null);
    setSaving(true);
    try {
      const updated = await updateFeature(id, {
        key: feature.isReferenced ? undefined : key,
        name,
        description,
        unit,
        resetPeriod,
      });
      setFeature(updated);
      toaster.create({ type: 'success', title: 'Feature saved.' });
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'FEATURE_KEY_EXISTS') {
        setBannerMessage('A feature with this key already exists.');
      } else if (isPlatformApiError(error) && error.code === 'FEATURE_KEY_IMMUTABLE') {
        setBannerMessage("This feature's key can't be changed because it's used by one or more packages.");
      } else {
        setBannerMessage('Something went wrong while saving. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteFeature(id);
      toaster.create({ type: 'success', title: 'Feature deleted.' });
      router.replace('/platform/features');
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'FEATURE_IN_USE') {
        toaster.create({ type: 'error', title: "This feature is used by one or more packages and can't be deleted." });
      } else {
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const BackLink = () => (
    <Link href="/platform/features">
      <Text color="brand.fg" fontWeight="medium" display="inline-block">
        ← Back to features
      </Text>
    </Link>
  );

  if (state === 'loading') {
    return (
      <Stack gap="4" maxW="lg" data-testid="feature-detail-loading">
        <BackLink />
        <Skeleton height="8" width="48" />
        <Skeleton height="32" />
      </Stack>
    );
  }

  if (state === 'not-found') {
    return (
      <Stack gap="4">
        <BackLink />
        <Text>Feature not found.</Text>
      </Stack>
    );
  }

  if (state === 'error' || !feature) {
    return (
      <Stack gap="4">
        <BackLink />
        <Text>We couldn&apos;t load this feature. Try again.</Text>
        <Button onClick={load} alignSelf="flex-start">
          Retry
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="6" maxW="lg">
      <BackLink />
      <HStack justify="space-between" wrap="wrap" gap="3">
        <Heading size="lg">{feature.name}</Heading>
        <Badge colorPalette={feature.isReferenced ? 'blue' : 'gray'} variant="subtle">
          {feature.isReferenced ? 'Referenced by a package' : 'Unreferenced'}
        </Badge>
      </HStack>

      <Box as="form" onSubmit={handleSave}>
        <Stack gap="5">
          {bannerMessage && (
            <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {bannerMessage}
            </Box>
          )}

          <Field.Root required disabled={feature.isReferenced}>
            <Field.Label>Key</Field.Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={saving || feature.isReferenced} />
            {feature.isReferenced && (
              <Text fontSize="sm" color="gray.600">
                The key can&apos;t be changed while this feature is used by one or more packages.
              </Text>
            )}
          </Field.Root>

          <Field.Root required>
            <Field.Label>Name</Field.Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </Field.Root>

          <Field.Root>
            <Field.Label>Description</Field.Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Unit</Field.Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={saving} />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Reset period</Field.Label>
            <NativeSelect.Root disabled={saving}>
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

          <HStack gap="3">
            <Button type="submit" colorPalette="brand" loading={saving}>
              Save changes
            </Button>
            {!feature.isReferenced && (
              <Button variant="outline" colorPalette="red" disabled={saving} onClick={() => setConfirmDelete(true)}>
                Delete feature
              </Button>
            )}
          </HStack>
        </Stack>
      </Box>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete '${feature.name}'?`}
        message="This feature will be permanently removed from the catalog. This can't be undone."
        confirmLabel="Delete feature"
        tone="danger"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </Stack>
  );
}
