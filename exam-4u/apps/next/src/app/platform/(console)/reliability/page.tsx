'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, DataList, Heading, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { getReliabilityDashboard, type ReliabilityDashboardSnapshot } from '@/lib/platform-console';

type LoadState = 'loading' | 'loaded' | 'error';

const WORK_HINT_LABELS: Record<string, string> = {
  pdf_session: 'PDF processing sessions',
  outbox: 'Outbox messages',
  attempt_timeout: 'Attempt timeouts',
};

/**
 * Reliability console dashboard (migration plan Phase 2 sub-slice "2d", §18.9 of
 * `docs/design/UX_GUIDELINES.md`) — a read-only, cross-tenant snapshot of outbox health
 * (pending/delivered/dead-letter counts, `server/reliability`'s `OutboxRepository`), file-cleanup-queue
 * health (`FileCleanupRepository`), and the platform-schema work-hint counts
 * (`server/platform/reliability`'s `WorkHintsService`). No legacy precedent — legacy never built an
 * admin-facing reliability viewer.
 *
 * A dashboard, not an editor (per the migration plan's own "platform/reliability dashboards"
 * framing): no action buttons here, only counts. The work-hint section legitimately shows `0` for
 * every kind today since no producer writes any hint yet (see `TenantWorkHintEntity`'s own doc
 * comment) — this is an honest empty state, not a stub to apologize for, and the page says so
 * explicitly rather than looking broken.
 */
export default function ReliabilityDashboardPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [snapshot, setSnapshot] = useState<ReliabilityDashboardSnapshot | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await getReliabilityDashboard();
      setSnapshot(result);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Stack gap="6" maxW="3xl">
      <Heading size="lg">Reliability</Heading>

      {state === 'loading' && (
        <Stack gap="3" data-testid="reliability-loading">
          <Skeleton height="8" />
          <Skeleton height="32" />
          <Skeleton height="32" />
        </Stack>
      )}

      {state === 'error' && (
        <Box borderWidth="1px" borderColor="red.200" bg="red.subtle" borderRadius="md" p="4">
          <Text mb="2">We couldn&apos;t load the reliability dashboard. Try again.</Text>
          <Button onClick={load} size="sm">
            Retry
          </Button>
        </Box>
      )}

      {state === 'loaded' && snapshot && (
        <Stack gap="6">
          <Text fontSize="sm" color="gray.600">
            Scanned {snapshot.tenantsScanned} active tenant{snapshot.tenantsScanned === 1 ? '' : 's'}.
          </Text>

          <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="5" data-testid="outbox-health">
            <Stack gap="4">
              <Heading size="md">Outbox</Heading>
              <DataList.Root orientation="horizontal">
                <DataList.Item>
                  <DataList.ItemLabel>Pending</DataList.ItemLabel>
                  <DataList.ItemValue>{snapshot.outbox.pending}</DataList.ItemValue>
                </DataList.Item>
                <DataList.Item>
                  <DataList.ItemLabel>Delivered</DataList.ItemLabel>
                  <DataList.ItemValue>{snapshot.outbox.delivered}</DataList.ItemValue>
                </DataList.Item>
                <DataList.Item>
                  <DataList.ItemLabel>Dead letter</DataList.ItemLabel>
                  <DataList.ItemValue>
                    <Badge colorPalette={snapshot.outbox.deadLetter > 0 ? 'red' : 'gray'}>{snapshot.outbox.deadLetter}</Badge>
                  </DataList.ItemValue>
                </DataList.Item>
              </DataList.Root>
            </Stack>
          </Box>

          <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="5" data-testid="file-cleanup-health">
            <Stack gap="4">
              <Heading size="md">File cleanup queue</Heading>
              <DataList.Root orientation="horizontal">
                <DataList.Item>
                  <DataList.ItemLabel>Awaiting deletion</DataList.ItemLabel>
                  <DataList.ItemValue>{snapshot.fileCleanup.due}</DataList.ItemValue>
                </DataList.Item>
              </DataList.Root>
            </Stack>
          </Box>

          <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="5" data-testid="work-hints">
            <Stack gap="4">
              <Heading size="md">Work hints</Heading>
              <Table.Root variant="line">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Kind</Table.ColumnHeader>
                    <Table.ColumnHeader>Pending tenants</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {snapshot.workHints.map((row) => (
                    <Table.Row key={row.kind}>
                      <Table.Cell>{WORK_HINT_LABELS[row.kind] ?? row.kind}</Table.Cell>
                      <Table.Cell>{row.pendingCount}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
              <Text fontSize="xs" color="gray.500">
                No pending hints is expected today — no feature that writes a work hint (PDF processing,
                attempt timeouts) has shipped yet.
              </Text>
            </Stack>
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
