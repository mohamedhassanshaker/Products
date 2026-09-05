'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, Flex, Heading, HStack, Input, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { listAuditLog, type AuditLogRow } from '@/lib/platform-console';

const PAGE_SIZE = 25;

type LoadState = 'loading' | 'loaded' | 'error';

const ACTOR_BADGE_PALETTE: Record<AuditLogRow['actorType'], string> = {
  PlatformAdmin: 'blue',
  TenantUser: 'purple',
  System: 'gray',
};

/**
 * Audit Log console page (migration plan Phase 2 sub-slice "2d", §18.10 of
 * `docs/design/UX_GUIDELINES.md`) — a read-only, paginated, filterable (actor/action/target, every
 * filter combined with AND) viewer over `platform.audit_log` (HLD §5.3). No legacy precedent — legacy
 * never built an admin-facing audit viewer.
 *
 * Follows the exact list-screen filter/pagination convention the Tenants list screen already
 * establishes (`docs/design/UX_GUIDELINES.md` §3.1/§18.1): plain text filter inputs (not a dropdown —
 * `action`/`targetType`/`targetId` have no small fixed enum the way tenant `status` does, so a free-text
 * filter is the only shape that scales as this system accumulates new action names over time),
 * client-debounced only via the load button/Enter key (no live-as-you-type re-fetch, avoiding a
 * request storm on every keystroke against a table that will grow unbounded over the product's life).
 */
export default function AuditLogPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [actorIdInput, setActorIdInput] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [targetTypeInput, setTargetTypeInput] = useState('');
  const [targetIdInput, setTargetIdInput] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ actorId: '', action: '', targetType: '', targetId: '' });

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await listAuditLog({
        actorId: appliedFilters.actorId || undefined,
        action: appliedFilters.action || undefined,
        targetType: appliedFilters.targetType || undefined,
        targetId: appliedFilters.targetId || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(result.items);
      setTotal(result.total);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, [appliedFilters, page]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters() {
    setPage(1);
    setAppliedFilters({
      actorId: actorIdInput.trim(),
      action: actionInput.trim(),
      targetType: targetTypeInput.trim(),
      targetId: targetIdInput.trim(),
    });
  }

  function clearFilters() {
    setActorIdInput('');
    setActionInput('');
    setTargetTypeInput('');
    setTargetIdInput('');
    setPage(1);
    setAppliedFilters({ actorId: '', action: '', targetType: '', targetId: '' });
  }

  const anyFilterApplied = Object.values(appliedFilters).some((v) => v !== '');
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Stack gap="6">
      <Heading size="lg">Audit Log</Heading>

      <Flex gap="3" align="flex-end" wrap="wrap" as="form" onSubmit={(e) => { e.preventDefault(); applyFilters(); }}>
        <Box>
          <Text as="label" fontSize="xs" color="gray.600" display="block" mb="1">
            Actor id
          </Text>
          <Input size="sm" width="40" value={actorIdInput} onChange={(e) => setActorIdInput(e.target.value)} />
        </Box>
        <Box>
          <Text as="label" fontSize="xs" color="gray.600" display="block" mb="1">
            Action
          </Text>
          <Input size="sm" width="48" value={actionInput} onChange={(e) => setActionInput(e.target.value)} placeholder="e.g. tenant.suspend" />
        </Box>
        <Box>
          <Text as="label" fontSize="xs" color="gray.600" display="block" mb="1">
            Target type
          </Text>
          <Input size="sm" width="36" value={targetTypeInput} onChange={(e) => setTargetTypeInput(e.target.value)} placeholder="e.g. Tenant" />
        </Box>
        <Box>
          <Text as="label" fontSize="xs" color="gray.600" display="block" mb="1">
            Target id
          </Text>
          <Input size="sm" width="40" value={targetIdInput} onChange={(e) => setTargetIdInput(e.target.value)} />
        </Box>
        <Button type="submit" size="sm" colorPalette="brand">
          Apply filters
        </Button>
        {anyFilterApplied && (
          <Button size="sm" variant="outline" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </Flex>

      {state === 'loading' && (
        <Stack gap="2" data-testid="audit-log-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height="10" />
          ))}
        </Stack>
      )}

      {state === 'error' && (
        <Box borderWidth="1px" borderColor="red.200" bg="red.subtle" borderRadius="md" p="4">
          <Text mb="2">We couldn&apos;t load the audit log. Try again.</Text>
          <Button onClick={load} size="sm">
            Retry
          </Button>
        </Box>
      )}

      {state === 'loaded' && items.length === 0 && (
        <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="8" textAlign="center">
          <Text color="gray.600">
            {anyFilterApplied ? 'No audit rows match the current filter.' : 'No audit activity recorded yet.'}
          </Text>
        </Box>
      )}

      {state === 'loaded' && items.length > 0 && (
        <>
          <Table.Root variant="line" data-testid="audit-log-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>When</Table.ColumnHeader>
                <Table.ColumnHeader>Actor</Table.ColumnHeader>
                <Table.ColumnHeader>Action</Table.ColumnHeader>
                <Table.ColumnHeader>Target</Table.ColumnHeader>
                <Table.ColumnHeader>Summary</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((row) => (
                <Table.Row key={row.id}>
                  <Table.Cell title={new Date(row.createdAt).toISOString()} whiteSpace="nowrap">
                    {new Date(row.createdAt).toLocaleString()}
                  </Table.Cell>
                  <Table.Cell>
                    <HStack gap="2">
                      <Badge colorPalette={ACTOR_BADGE_PALETTE[row.actorType]}>{row.actorType}</Badge>
                      {row.actorId && (
                        <Text fontSize="xs" color="gray.600" fontFamily="mono">
                          {row.actorId}
                        </Text>
                      )}
                    </HStack>
                  </Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="sm">
                    {row.action}
                  </Table.Cell>
                  <Table.Cell fontSize="sm">
                    {row.targetType ? `${row.targetType}${row.targetId ? ` (${row.targetId})` : ''}` : '—'}
                  </Table.Cell>
                  <Table.Cell fontSize="xs" color="gray.600" maxW="xs" whiteSpace="pre-wrap">
                    {row.summary ? JSON.stringify(row.summary) : '—'}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>

          <Flex justify="space-between" align="center">
            <Text fontSize="sm" color="gray.600">
              Page {page} of {totalPages} ({total} total)
            </Text>
            <HStack>
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </HStack>
          </Flex>
        </>
      )}
    </Stack>
  );
}
