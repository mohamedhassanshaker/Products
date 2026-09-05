'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Button, Heading, Stack, Table, Text } from '@chakra-ui/react';
import * as examTypesApi from '@/lib/tenant-console/exam-types-api';
import * as taxonomyApi from '@/lib/tenant-console/taxonomy-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { toaster } from '@/components/ui/toaster';

/**
 * Exam Type list (`docs/design/UX_GUIDELINES.md` §20.1) — ported flow from legacy's
 * `ExamTypeListComponent`: one unfiltered fetch, no search box/paginator (the underlying
 * `GET /api/exam-types` returns the full unsorted set, matching legacy's identical scope). Gated by
 * `exams.read` (route-level defense in depth — a hidden nav link is not access control, per
 * §4.0/§19's own principle, reused here).
 */
export default function ExamTypesListPage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('exams.read')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Exam Types
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <ExamTypesListAuthorized />;
}

function ExamTypesListAuthorized() {
  const { hasPermission } = useTenantAuthContext();
  const canCreate = hasPermission('exams.create');
  const canDelete = hasPermission('exams.delete');

  const [rows, setRows] = useState<examTypesApi.ExamTypeSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [stageNames, setStageNames] = useState<Map<number, string>>(new Map());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<examTypesApi.ExamTypeSummary | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  function load() {
    setError(false);
    examTypesApi
      .listExamTypes()
      .then(setRows)
      .catch(() => setError(true));
    loadStageNames();
  }

  /** Best-effort stage-name lookup, matching legacy's own "no flat all-stages endpoint" judgment call
   * (`/api/taxonomy/stages` requires an `educationLevelId`) — a failure here never blocks the list
   * itself from rendering; stage names simply fall back to "—". */
  function loadStageNames() {
    taxonomyApi
      .listEducationLevels()
      .then(async (levels) => {
        const map = new Map<number, string>();
        for (const level of levels) {
          try {
            const stages = await taxonomyApi.listStages(level.id);
            for (const stage of stages) map.set(stage.id, stage.name);
          } catch {
            // Best-effort — skip this level's stages on failure, keep the rest.
          }
        }
        setStageNames(map);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stageName(stageId: number | null): string {
    if (stageId === null) return '—';
    return stageNames.get(stageId) ?? '—';
  }

  async function handleDelete() {
    const target = confirmTarget;
    if (!target) return;
    setDeletingId(target.id);
    setBlockedMessage(null);
    try {
      await examTypesApi.deleteExamType(target.id);
      setConfirmTarget(null);
      setDeletingId(null);
      toaster.create({ title: 'Exam Type deleted.', type: 'success' });
      load();
    } catch (err) {
      setDeletingId(null);
      if (isTenantApiError(err) && err.code === 'EXAM_TYPE_HAS_ACTIVE_ATTEMPTS') {
        setConfirmTarget(null);
        setBlockedMessage(
          `'${target.name}' can't be deleted right now because it has learners actively taking exams. Try again once those attempts are finished.`,
        );
      } else if (isTenantApiError(err) && err.code === 'EXAM_TYPE_NOT_FOUND') {
        setConfirmTarget(null);
        toaster.create({ title: 'This Exam Type was already removed.', type: 'info' });
        load();
      } else {
        toaster.create({ title: 'Something went wrong. Please try again.', type: 'error' });
      }
    }
  }

  return (
    <Box maxW="1000px">
      <Stack direction="row" justify="space-between" align="center" mb="4">
        <Heading size="md">Exam Types</Heading>
        {canCreate && (
          <Link href="/exam-types/new">
            <Button colorPalette="brand">Create Exam Type</Button>
          </Link>
        )}
      </Stack>

      {blockedMessage && (
        <Box role="alert" bg="orange.subtle" color="orange.fg" borderRadius="md" px="4" py="3" fontSize="sm" mb="4">
          {blockedMessage}
        </Box>
      )}

      {error ? (
        <Box>
          <Text mb="2">We couldn&apos;t load Exam Types. Try again.</Text>
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
          <Text mb="4" color="gray.600">
            {canCreate ? 'No Exam Types yet. Create one to get started.' : 'No Exam Types yet. Ask an exam manager to create one.'}
          </Text>
          {canCreate && (
            <Link href="/exam-types/new">
              <Button colorPalette="brand">Create Exam Type</Button>
            </Link>
          )}
        </Box>
      ) : (
        <Table.Root data-testid="exam-types-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Stage</Table.ColumnHeader>
              <Table.ColumnHeader>Questions</Table.ColumnHeader>
              <Table.ColumnHeader>Duration</Table.ColumnHeader>
              <Table.ColumnHeader></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.id}>
                <Table.Cell fontWeight="medium">{row.name}</Table.Cell>
                <Table.Cell color="gray.600">{stageName(row.stageId)}</Table.Cell>
                <Table.Cell>{row.totalQuestions}</Table.Cell>
                <Table.Cell>{row.totalMinutes} min</Table.Cell>
                <Table.Cell textAlign="right">
                  <Stack direction="row" gap="3" justify="flex-end">
                    <Link href={`/exam-types/${row.id}`}>
                      <Text as="span" color="brand.fg">
                        View
                      </Text>
                    </Link>
                    {canDelete && (
                      <Text
                        as="button"
                        color="red.fg"
                        opacity={deletingId === row.id ? 0.5 : 1}
                        onClick={() => setConfirmTarget(row)}
                        aria-disabled={deletingId === row.id}
                      >
                        Delete
                      </Text>
                    )}
                  </Stack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget ? `Delete '${confirmTarget.name}'?` : ''}
        message="This permanently removes the Exam Type, all of its questions, and any generated content tied to it. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        loading={deletingId !== null}
        onConfirm={handleDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </Box>
  );
}
