'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Box, Heading, Table, Text } from '@chakra-ui/react';
import * as attemptsApi from '@/lib/tenant-console/attempts-api';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

/** FR-TAKE-9's own-history view — gated by `attempts.read_own`. */
export default function AttemptHistoryPage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('attempts.read_own')) {
    return <Text color="gray.600">You do not have permission to view this page.</Text>;
  }
  return <AttemptHistoryAuthorized />;
}

function statusBadge(status: attemptsApi.AttemptStatus) {
  if (status === 'InProgress') return <Badge colorPalette="blue">In progress</Badge>;
  if (status === 'Submitted') return <Badge colorPalette="green">Submitted</Badge>;
  return <Badge colorPalette="orange">Timed out</Badge>;
}

function AttemptHistoryAuthorized() {
  const [rows, setRows] = useState<attemptsApi.AttemptHistoryItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    attemptsApi
      .listOwnHistory()
      .then(setRows)
      .catch(() => setError(true));
  }, []);

  return (
    <Box maxW="1000px">
      <Heading size="md" mb="4">
        My Attempts
      </Heading>

      {error ? (
        <Text color="red.fg">We couldn&apos;t load your attempt history. Try again.</Text>
      ) : rows === null ? (
        <Box h="32" bg="gray.100" borderRadius="md" />
      ) : rows.length === 0 ? (
        <Text color="gray.600">You haven&apos;t attempted any exams yet.</Text>
      ) : (
        <Table.Root data-testid="attempt-history-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Exam</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Score</Table.ColumnHeader>
              <Table.ColumnHeader>Started</Table.ColumnHeader>
              <Table.ColumnHeader></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.attemptId}>
                <Table.Cell fontWeight="medium">{row.examTypeName}</Table.Cell>
                <Table.Cell>{statusBadge(row.status)}</Table.Cell>
                <Table.Cell>{row.scorePercent === null ? '—' : `${row.scorePercent}%`}</Table.Cell>
                <Table.Cell color="gray.600">{new Date(row.startTime).toLocaleString()}</Table.Cell>
                <Table.Cell textAlign="right">
                  {row.status === 'InProgress' ? (
                    <Link href={`/attempts/${row.attemptId}`}>
                      <Text as="span" color="brand.fg">
                        Resume
                      </Text>
                    </Link>
                  ) : (
                    <Link href={`/attempts/${row.attemptId}/review`}>
                      <Text as="span" color="brand.fg">
                        Review
                      </Text>
                    </Link>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  );
}
