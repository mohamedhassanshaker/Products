'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Button, Heading, Stack, Table, Text } from '@chakra-ui/react';
import * as curriculaApi from '@/lib/tenant-console/curricula-api';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

/**
 * Curriculum list (`docs/design/UX_GUIDELINES.md` §10.1/§19 — ownership/metadata scope only this
 * phase, no document count column since documents don't exist yet). `GET /api/curricula` already
 * scopes the result to "my curricula" (or every curriculum in the tenant if the signed-in user holds
 * `curricula.read_all`) — this page never branches on that itself, matching §10's own "list scope is
 * server-decided" specification. Gated by `curricula.manage_own` (route-level defense in depth — a
 * hidden nav link is not access control, per §4.0/§19's own principle); a permission check is kept in
 * its own component (not an early `return` before hooks) to respect the Rules of Hooks, mirroring the
 * taxonomy page's identical pattern.
 */
export default function CurriculaListPage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('curricula.manage_own')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Curricula
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <CurriculaListAuthorized />;
}

function CurriculaListAuthorized() {
  const [rows, setRows] = useState<curriculaApi.CurriculumSummary[] | null>(null);
  const [error, setError] = useState(false);

  function load() {
    setError(false);
    curriculaApi
      .listCurricula()
      .then(setRows)
      .catch(() => setError(true));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Box maxW="900px">
      <Stack direction="row" justify="space-between" align="center" mb="4">
        <Heading size="md">Curricula</Heading>
        <Link href="/curricula/new">
          <Button colorPalette="brand">Create Curriculum</Button>
        </Link>
      </Stack>

      {error ? (
        <Box>
          <Text mb="2">We couldn&apos;t load your Curricula. Try again.</Text>
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        </Box>
      ) : rows === null ? (
        <Stack gap="2">
          {[1, 2, 3].map((i) => (
            <Box key={i} h="12" bg="gray.100" borderRadius="md" />
          ))}
        </Stack>
      ) : rows.length === 0 ? (
        <Box textAlign="center" py="10">
          <Text mb="4" color="gray.600" maxW="480px" mx="auto">
            Curricula are where you organize your own material by Subject, so it can later ground
            ExamLand&apos;s AI features. Create your first Curriculum to get started.
          </Text>
          <Link href="/curricula/new">
            <Button colorPalette="brand">Create Curriculum</Button>
          </Link>
        </Box>
      ) : (
        <Table.Root data-testid="curricula-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Description</Table.ColumnHeader>
              <Table.ColumnHeader></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.id}>
                <Table.Cell fontWeight="medium">{row.name}</Table.Cell>
                <Table.Cell color="gray.600">{row.description || '—'}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Link href={`/curricula/${row.id}`}>
                    <Text as="span" color="brand.fg">
                      View
                    </Text>
                  </Link>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  );
}
