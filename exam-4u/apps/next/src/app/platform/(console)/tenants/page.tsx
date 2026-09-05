'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Button, Flex, Heading, HStack, NativeSelect, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { toaster } from '@/components/ui/toaster';
import { StatusBadge } from '@/components/platform/status-badge';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import {
  activateTenant,
  isPlatformApiError,
  listTenants,
  suspendTenant,
  type TenantStatus,
  type TenantSummary,
} from '@/lib/platform-console';

const PAGE_SIZE = 25;
const STATUS_OPTIONS: TenantStatus[] = ['Provisioning', 'Active', 'Suspended', 'Failed'];

type LoadState = 'loading' | 'loaded' | 'error';

/** Tenant list screen (`docs/design/UX_GUIDELINES.md` §3.1) — the platform console's landing route. */
export default function TenantListPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<TenantSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<TenantStatus | ''>('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [rowActionId, setRowActionId] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<TenantSummary | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await listTenants({
        status: statusFilter || undefined,
        includeDeleted,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(result.items);
      setTotal(result.total);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, [statusFilter, includeDeleted, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function runRowAction(id: string, action: () => Promise<TenantSummary>, successMessage: string) {
    setRowActionId(id);
    try {
      await action();
      toaster.create({ type: 'success', title: successMessage });
      await load();
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'INVALID_TENANT_STATE') {
        toaster.create({ type: 'info', title: "This tenant's status has changed. Refreshing…" });
        await load();
      } else {
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
    } finally {
      setRowActionId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Stack gap="6">
      <Flex justify="space-between" align="center" wrap="wrap" gap="3">
        <Heading size="lg">Tenants</Heading>
        <Link href="/platform/tenants/new">
          <Button colorPalette="brand">Create tenant</Button>
        </Link>
      </Flex>

      <Flex gap="4" align="center" wrap="wrap">
        <NativeSelect.Root width="48">
          <NativeSelect.Field
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value as TenantStatus | '');
            }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <Box as="label" display="flex" alignItems="center" gap="2" fontSize="sm">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => {
              setPage(1);
              setIncludeDeleted(e.target.checked);
            }}
          />
          Show deleted
        </Box>
      </Flex>

      {state === 'loading' && (
        <Stack gap="2" data-testid="tenants-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height="10" />
          ))}
        </Stack>
      )}

      {state === 'error' && (
        <Box borderWidth="1px" borderColor="red.200" bg="red.subtle" borderRadius="md" p="4">
          <Text mb="2">We couldn&apos;t load tenants. Try again.</Text>
          <Button onClick={load} size="sm">
            Retry
          </Button>
        </Box>
      )}

      {state === 'loaded' && items.length === 0 && (
        <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="8" textAlign="center">
          <Text mb="4" color="gray.600">
            {total === 0 && page === 1 && !statusFilter && !includeDeleted
              ? 'No tenants yet. Create the first one to get started.'
              : 'No tenants match the current filter.'}
          </Text>
          {total === 0 && !statusFilter && !includeDeleted ? (
            <Link href="/platform/tenants/new">
              <Button colorPalette="brand">Create tenant</Button>
            </Link>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setStatusFilter('');
                setIncludeDeleted(false);
                setPage(1);
              }}
            >
              Clear filter
            </Button>
          )}
        </Box>
      )}

      {state === 'loaded' && items.length > 0 && (
        <>
          <Table.Root variant="line" data-testid="tenants-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Name</Table.ColumnHeader>
                <Table.ColumnHeader>Subdomain</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Created</Table.ColumnHeader>
                <Table.ColumnHeader>Actions</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((tenant) => (
                <Table.Row key={tenant.id}>
                  <Table.Cell>
                    <Link href={`/platform/tenants/${tenant.id}`}>
                      <Text color="brand.fg" fontWeight="medium">
                        {tenant.name}
                      </Text>
                    </Link>
                  </Table.Cell>
                  <Table.Cell>{tenant.subdomainSlug}.examland.app</Table.Cell>
                  <Table.Cell>
                    <StatusBadge status={tenant.status} />
                  </Table.Cell>
                  <Table.Cell title={new Date(tenant.createdAt).toLocaleString()}>
                    {new Date(tenant.createdAt).toLocaleDateString()}
                  </Table.Cell>
                  <Table.Cell>
                    <HStack gap="2">
                      {tenant.status === 'Active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={rowActionId === tenant.id}
                          onClick={() => setSuspendTarget(tenant)}
                        >
                          Suspend
                        </Button>
                      )}
                      {tenant.status === 'Suspended' && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={rowActionId === tenant.id}
                          onClick={() => runRowAction(tenant.id, () => activateTenant(tenant.id), 'Tenant activated.')}
                        >
                          Activate
                        </Button>
                      )}
                      <Link href={`/platform/tenants/${tenant.id}`}>
                        <Button size="sm" variant="ghost">
                          View
                        </Button>
                      </Link>
                    </HStack>
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

      <ConfirmDialog
        open={suspendTarget !== null}
        title={`Suspend '${suspendTarget?.name ?? ''}'?`}
        message="Users on this tenant will be unable to sign in until it is reactivated."
        confirmLabel="Suspend"
        loading={rowActionId === suspendTarget?.id}
        onCancel={() => setSuspendTarget(null)}
        onConfirm={async () => {
          const target = suspendTarget!;
          setSuspendTarget(null);
          await runRowAction(target.id, () => suspendTenant(target.id), 'Tenant suspended.');
        }}
      />
    </Stack>
  );
}
