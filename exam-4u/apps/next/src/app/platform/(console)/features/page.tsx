'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Box, Button, Flex, Heading, HStack, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { toaster } from '@/components/ui/toaster';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { deleteFeature, isPlatformApiError, listFeatures, type FeatureSummary } from '@/lib/platform-console';

type LoadState = 'loading' | 'loaded' | 'error';

/**
 * Features catalog list screen (migration plan Phase 2 sub-slice "2b", FR-PKG-7) — this app's Chakra
 * v3 re-derivation of `legacy/web/src/app/features/platform/features/feature-list/**`. Follows the
 * exact list-screen conventions Phase 2a's tenants list already established (`docs/design/
 * UX_GUIDELINES.md` §18.0's Chakra vocabulary table): a `Table.Root` with loading/empty/error states,
 * a "Create feature" call-to-action, and per-row actions gated by server-computed state
 * (`isReferenced` — Delete is only offered on a feature no package currently references, matching this
 * screen's own preemptive Key-lock UX rather than surprising the admin with a post-submit 409).
 */
export default function FeatureListPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<FeatureSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<FeatureSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await listFeatures();
      setItems(result.items);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFeature(deleteTarget.id);
      toaster.create({ type: 'success', title: 'Feature deleted.' });
      setDeleteTarget(null);
      await load();
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'FEATURE_IN_USE') {
        toaster.create({ type: 'error', title: "This feature is used by one or more packages and can't be deleted." });
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
        <Heading size="lg">Features</Heading>
        <Link href="/platform/features/new">
          <Button colorPalette="brand">Create feature</Button>
        </Link>
      </Flex>

      {state === 'loading' && (
        <Stack gap="2" data-testid="features-loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height="10" />
          ))}
        </Stack>
      )}

      {state === 'error' && (
        <Box borderWidth="1px" borderColor="red.200" bg="red.subtle" borderRadius="md" p="4">
          <Text mb="2">We couldn&apos;t load features. Try again.</Text>
          <Button onClick={load} size="sm">
            Retry
          </Button>
        </Box>
      )}

      {state === 'loaded' && items.length === 0 && (
        <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="8" textAlign="center">
          <Text mb="4" color="gray.600">
            No features yet. Create the first one to get started.
          </Text>
          <Link href="/platform/features/new">
            <Button colorPalette="brand">Create feature</Button>
          </Link>
        </Box>
      )}

      {state === 'loaded' && items.length > 0 && (
        <Table.Root variant="line" data-testid="features-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Key</Table.ColumnHeader>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Unit</Table.ColumnHeader>
              <Table.ColumnHeader>Reset period</Table.ColumnHeader>
              <Table.ColumnHeader>In use</Table.ColumnHeader>
              <Table.ColumnHeader>Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((feature) => (
              <Table.Row key={feature.id}>
                <Table.Cell fontFamily="mono" fontSize="sm">
                  {feature.key}
                </Table.Cell>
                <Table.Cell>
                  <Link href={`/platform/features/${feature.id}`}>
                    <Text color="brand.fg" fontWeight="medium">
                      {feature.name}
                    </Text>
                  </Link>
                </Table.Cell>
                <Table.Cell>{feature.unit}</Table.Cell>
                <Table.Cell>{feature.resetPeriod}</Table.Cell>
                <Table.Cell>
                  <Badge colorPalette={feature.isReferenced ? 'blue' : 'gray'} variant="subtle">
                    {feature.isReferenced ? 'Referenced' : 'Unreferenced'}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <HStack gap="2">
                    <Link href={`/platform/features/${feature.id}`}>
                      <Button size="sm" variant="ghost">
                        Edit
                      </Button>
                    </Link>
                    {!feature.isReferenced && (
                      <Button size="sm" variant="outline" colorPalette="red" onClick={() => setDeleteTarget(feature)}>
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
        title={`Delete '${deleteTarget?.name ?? ''}'?`}
        message="This feature will be permanently removed from the catalog. This can't be undone."
        confirmLabel="Delete feature"
        tone="danger"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </Stack>
  );
}
