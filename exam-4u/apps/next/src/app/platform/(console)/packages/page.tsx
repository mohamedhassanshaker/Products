'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Box, Button, Flex, Heading, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { listPackages, type PackageSummary } from '@/lib/platform-console';

type LoadState = 'loading' | 'loaded' | 'error';

/** Formats a whole-cent integer amount as a display dollar string (e.g. `2900` → `$29.00`) — the
 * inverse of the create/edit forms' own cents conversion. */
function formatPrice(priceCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(priceCents / 100);
}

/**
 * Packages catalog list screen (migration plan Phase 2 sub-slice "2b", FR-PKG-7) — this app's Chakra
 * v3 re-derivation of `legacy/web/src/app/features/platform/packages/package-list/**`.
 */
export default function PackageListPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<PackageSummary[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await listPackages();
      setItems(result.items);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Stack gap="6">
      <Flex justify="space-between" align="center" wrap="wrap" gap="3">
        <Heading size="lg">Packages</Heading>
        <Link href="/platform/packages/new">
          <Button colorPalette="brand">Create package</Button>
        </Link>
      </Flex>

      {state === 'loading' && (
        <Stack gap="2" data-testid="packages-loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height="10" />
          ))}
        </Stack>
      )}

      {state === 'error' && (
        <Box borderWidth="1px" borderColor="red.200" bg="red.subtle" borderRadius="md" p="4">
          <Text mb="2">We couldn&apos;t load packages. Try again.</Text>
          <Button onClick={load} size="sm">
            Retry
          </Button>
        </Box>
      )}

      {state === 'loaded' && items.length === 0 && (
        <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="8" textAlign="center">
          <Text mb="4" color="gray.600">
            No packages yet. Create the first one to get started.
          </Text>
          <Link href="/platform/packages/new">
            <Button colorPalette="brand">Create package</Button>
          </Link>
        </Box>
      )}

      {state === 'loaded' && items.length > 0 && (
        <Table.Root variant="line" data-testid="packages-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Key</Table.ColumnHeader>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Price</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Sort order</Table.ColumnHeader>
              <Table.ColumnHeader>Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((pkg) => (
              <Table.Row key={pkg.id}>
                <Table.Cell fontFamily="mono" fontSize="sm">
                  {pkg.key}
                </Table.Cell>
                <Table.Cell>
                  <Link href={`/platform/packages/${pkg.id}`}>
                    <Text color="brand.fg" fontWeight="medium">
                      {pkg.name}
                    </Text>
                  </Link>
                </Table.Cell>
                <Table.Cell>{formatPrice(pkg.priceCents, pkg.currency)}/mo</Table.Cell>
                <Table.Cell>
                  <Badge colorPalette={pkg.isActive ? 'green' : 'gray'} variant="subtle">
                    {pkg.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{pkg.sortOrder}</Table.Cell>
                <Table.Cell>
                  <Link href={`/platform/packages/${pkg.id}`}>
                    <Button size="sm" variant="ghost">
                      Edit
                    </Button>
                  </Link>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Stack>
  );
}
