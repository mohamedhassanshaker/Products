'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Badge, Box, Button, Field, Heading, HStack, Input, Skeleton, Stack, Text } from '@chakra-ui/react';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { toaster } from '@/components/ui/toaster';
import {
  deleteAiModel,
  getAiModel,
  isPlatformApiError,
  setDefaultAiModel,
  updateAiModel,
  type ApprovedAiModelSummary,
} from '@/lib/platform-console';

type LoadState = 'loading' | 'loaded' | 'error' | 'not-found';

/** AI model edit screen (FR-AI-2) — `openRouterModelId` is deliberately not editable (the allowlist's
 * own unique key). */
export default function AiModelDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [state, setState] = useState<LoadState>('loading');
  const [model, setModel] = useState<ApprovedAiModelSummary | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await getAiModel(id);
      setModel(result);
      setDisplayName(result.displayName);
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
    if (saving) return;
    setBannerMessage(null);
    setSaving(true);
    try {
      const updated = await updateAiModel(id, { displayName });
      setModel(updated);
      toaster.create({ type: 'success', title: 'Model saved.' });
    } catch {
      setBannerMessage('Something went wrong while saving. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    if (!model || saving) return;
    setSaving(true);
    try {
      const updated = await updateAiModel(id, { isEnabled: !model.isEnabled });
      setModel(updated);
      toaster.create({ type: 'success', title: model.isEnabled ? 'Model disabled.' : 'Model enabled.' });
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'DEFAULT_MODEL_REQUIRED') {
        toaster.create({ type: 'error', title: 'Designate a different platform default before disabling this model.' });
      } else {
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault() {
    setSettingDefault(true);
    try {
      const updated = await setDefaultAiModel(id);
      setModel(updated);
      toaster.create({ type: 'success', title: `'${updated.displayName}' is now the platform default.` });
    } catch {
      toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
    } finally {
      setSettingDefault(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAiModel(id);
      toaster.create({ type: 'success', title: 'Model removed from the allowlist.' });
      router.replace('/platform/ai-models');
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'MODEL_IN_USE') {
        const tenantCount = (error.details?.tenantCount as number | undefined) ?? 'one or more';
        toaster.create({ type: 'error', title: `This model is still assigned to ${tenantCount} tenant(s); reassign them first.` });
      } else if (isPlatformApiError(error) && error.code === 'DEFAULT_MODEL_REQUIRED') {
        toaster.create({ type: 'error', title: 'Designate a different platform default before removing this model.' });
      } else {
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const BackLink = () => (
    <Link href="/platform/ai-models">
      <Text color="brand.fg" fontWeight="medium" display="inline-block">
        ← Back to AI models
      </Text>
    </Link>
  );

  if (state === 'loading') {
    return (
      <Stack gap="4" maxW="lg" data-testid="ai-model-detail-loading">
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
        <Text>AI model not found.</Text>
      </Stack>
    );
  }

  if (state === 'error' || !model) {
    return (
      <Stack gap="4">
        <BackLink />
        <Text>We couldn&apos;t load this AI model. Try again.</Text>
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
        <Heading size="lg">{model.displayName}</Heading>
        <HStack gap="2">
          <Badge colorPalette={model.isEnabled ? 'green' : 'gray'} variant="subtle">
            {model.isEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
          {model.isPlatformDefault && (
            <Badge colorPalette="blue" variant="subtle">
              Platform default
            </Badge>
          )}
        </HStack>
      </HStack>

      <Box as="form" onSubmit={handleSave}>
        <Stack gap="5">
          {bannerMessage && (
            <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {bannerMessage}
            </Box>
          )}

          <Field.Root>
            <Field.Label>OpenRouter model id</Field.Label>
            <Input value={model.openRouterModelId} disabled fontFamily="mono" />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Display name</Field.Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={saving} />
          </Field.Root>

          <Button type="submit" colorPalette="brand" loading={saving} alignSelf="flex-start">
            Save changes
          </Button>
        </Stack>
      </Box>

      <HStack gap="3" wrap="wrap">
        <Button variant="outline" loading={saving} onClick={handleToggleEnabled}>
          {model.isEnabled ? 'Disable' : 'Enable'}
        </Button>
        {model.isEnabled && !model.isPlatformDefault && (
          <Button colorPalette="brand" loading={settingDefault} onClick={handleSetDefault}>
            Set as platform default
          </Button>
        )}
        {!model.isPlatformDefault && (
          <Button variant="outline" colorPalette="red" onClick={() => setConfirmDelete(true)}>
            Remove from allowlist
          </Button>
        )}
      </HStack>

      <ConfirmDialog
        open={confirmDelete}
        title={`Remove '${model.displayName}' from the allowlist?`}
        message="This model will no longer be assignable to any tenant. This can't be undone."
        confirmLabel="Remove model"
        tone="danger"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </Stack>
  );
}
