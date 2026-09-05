'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Box, Button, Flex, Heading, HStack, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { toaster } from '@/components/ui/toaster';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import {
  deleteAiModel,
  isPlatformApiError,
  listAiModels,
  setDefaultAiModel,
  updateAiModel,
  type ApprovedAiModelSummary,
} from '@/lib/platform-console';

type LoadState = 'loading' | 'loaded' | 'error';

/**
 * AI model allowlist screen (FR-AI-2, migration plan Phase 2 sub-slice "2b") — this app's Chakra v3
 * re-derivation of `legacy/web/src/app/features/platform/ai-models/ai-model-list/**`. Includes
 * disabled models (`includeDisabled=true`) since this is the Platform Admin's own management screen,
 * not the enabled-only per-tenant assignment dropdown (that list is rendered inline on the tenant
 * detail screen instead).
 *
 * **Scope note**: this screen manages the allowlist's *data* only — no actual OpenRouter/LLM call ever
 * happens anywhere in this app yet (Phase 5's job per the migration plan's own phase sequence).
 */
export default function AiModelListPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<ApprovedAiModelSummary[]>([]);
  const [rowActionId, setRowActionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApprovedAiModelSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await listAiModels(true);
      setItems(result.items);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggleEnabled(model: ApprovedAiModelSummary) {
    setRowActionId(model.id);
    try {
      await updateAiModel(model.id, { isEnabled: !model.isEnabled });
      toaster.create({ type: 'success', title: model.isEnabled ? 'Model disabled.' : 'Model enabled.' });
      await load();
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'DEFAULT_MODEL_REQUIRED') {
        toaster.create({ type: 'error', title: 'Designate a different platform default before disabling this model.' });
      } else {
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
    } finally {
      setRowActionId(null);
    }
  }

  async function handleSetDefault(model: ApprovedAiModelSummary) {
    setRowActionId(model.id);
    try {
      await setDefaultAiModel(model.id);
      toaster.create({ type: 'success', title: `'${model.displayName}' is now the platform default.` });
      await load();
    } catch {
      toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
    } finally {
      setRowActionId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAiModel(deleteTarget.id);
      toaster.create({ type: 'success', title: 'Model removed from the allowlist.' });
      setDeleteTarget(null);
      await load();
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'MODEL_IN_USE') {
        const tenantCount = (error.details?.tenantCount as number | undefined) ?? 'one or more';
        toaster.create({ type: 'error', title: `This model is still assigned to ${tenantCount} tenant(s); reassign them first.` });
      } else if (isPlatformApiError(error) && error.code === 'DEFAULT_MODEL_REQUIRED') {
        toaster.create({ type: 'error', title: 'Designate a different platform default before removing this model.' });
      } else {
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Stack gap="6">
      <Flex justify="space-between" align="center" wrap="wrap" gap="3">
        <Heading size="lg">AI Models</Heading>
        <Link href="/platform/ai-models/new">
          <Button colorPalette="brand">Approve model</Button>
        </Link>
      </Flex>

      {state === 'loading' && (
        <Stack gap="2" data-testid="ai-models-loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height="10" />
          ))}
        </Stack>
      )}

      {state === 'error' && (
        <Box borderWidth="1px" borderColor="red.200" bg="red.subtle" borderRadius="md" p="4">
          <Text mb="2">We couldn&apos;t load AI models. Try again.</Text>
          <Button onClick={load} size="sm">
            Retry
          </Button>
        </Box>
      )}

      {state === 'loaded' && items.length === 0 && (
        <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="8" textAlign="center">
          <Text mb="4" color="gray.600">
            No AI models approved yet. Approve the first one to get started.
          </Text>
          <Link href="/platform/ai-models/new">
            <Button colorPalette="brand">Approve model</Button>
          </Link>
        </Box>
      )}

      {state === 'loaded' && items.length > 0 && (
        <Table.Root variant="line" data-testid="ai-models-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Display name</Table.ColumnHeader>
              <Table.ColumnHeader>OpenRouter model id</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((model) => (
              <Table.Row key={model.id}>
                <Table.Cell>
                  <Link href={`/platform/ai-models/${model.id}`}>
                    <Text color="brand.fg" fontWeight="medium">
                      {model.displayName}
                    </Text>
                  </Link>
                </Table.Cell>
                <Table.Cell fontFamily="mono" fontSize="sm">
                  {model.openRouterModelId}
                </Table.Cell>
                <Table.Cell>
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
                </Table.Cell>
                <Table.Cell>
                  <HStack gap="2" wrap="wrap">
                    <Button size="sm" variant="outline" loading={rowActionId === model.id} onClick={() => handleToggleEnabled(model)}>
                      {model.isEnabled ? 'Disable' : 'Enable'}
                    </Button>
                    {model.isEnabled && !model.isPlatformDefault && (
                      <Button size="sm" variant="outline" loading={rowActionId === model.id} onClick={() => handleSetDefault(model)}>
                        Set as default
                      </Button>
                    )}
                    {!model.isPlatformDefault && (
                      <Button size="sm" variant="outline" colorPalette="red" onClick={() => setDeleteTarget(model)}>
                        Delete
                      </Button>
                    )}
                  </HStack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Remove '${deleteTarget?.displayName ?? ''}' from the allowlist?`}
        message="This model will no longer be assignable to any tenant. This can't be undone."
        confirmLabel="Remove model"
        tone="danger"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </Stack>
  );
}
