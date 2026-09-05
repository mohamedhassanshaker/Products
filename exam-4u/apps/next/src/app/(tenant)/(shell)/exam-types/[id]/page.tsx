'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Field, Heading, Input, Stack, Table, Text } from '@chakra-ui/react';
import * as examTypesApi from '@/lib/tenant-console/exam-types-api';
import * as taxonomyApi from '@/lib/tenant-console/taxonomy-api';
import * as pdfProcessingApi from '@/lib/tenant-console/pdf-processing-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { toaster } from '@/components/ui/toaster';

type LoadState = 'loading' | 'not-found' | 'error' | 'ready';

/**
 * Exam Type detail screen (`docs/design/UX_GUIDELINES.md` §20.3, `/exam-types/:id`) — read-only,
 * ported from legacy's `ExamTypeDetailComponent`: **no edit form** — the real contract exposes only
 * create-via-ZIP and delete, no update endpoint (see `docs/plans/nextjs-rewrite-phase4-plan.md`'s
 * scope section for why building one here would be inventing scope). Gated by `exams.read`;
 * `exams.delete` separately gates the Delete action.
 */
export default function ExamTypeDetailPage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('exams.read')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Exam Type
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <ExamTypeDetailAuthorized />;
}

function ExamTypeDetailAuthorized() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useTenantAuthContext();
  const canDelete = hasPermission('exams.delete');

  const [state, setState] = useState<LoadState>('loading');
  const [examType, setExamType] = useState<examTypesApi.ExamTypeSummary | null>(null);
  const [stageName, setStageName] = useState('—');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  useEffect(() => {
    examTypesApi
      .getExamType(id)
      .then((row) => {
        setExamType(row);
        setState('ready');
        if (row.stageId !== null) {
          loadStageName(row.stageId).then(setStageName);
        }
      })
      .catch((err) => {
        setState(isTenantApiError(err) && err.code === 'EXAM_TYPE_NOT_FOUND' ? 'not-found' : 'error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Same client-side aggregation the list page uses — best-effort, never blocks the rest of the
   * detail screen from rendering on failure. */
  async function loadStageName(stageId: number): Promise<string> {
    try {
      const levels = await taxonomyApi.listEducationLevels();
      for (const level of levels) {
        const stages = await taxonomyApi.listStages(level.id);
        const match = stages.find((s) => s.id === stageId);
        if (match) return match.name;
      }
    } catch {
      // Best-effort — fall through to the default.
    }
    return '—';
  }

  async function handleDelete() {
    if (!examType) return;
    setDeleting(true);
    setBlockedMessage(null);
    try {
      await examTypesApi.deleteExamType(examType.id);
      toaster.create({ title: 'Exam Type deleted.', type: 'success' });
      router.replace('/exam-types');
    } catch (err) {
      setDeleting(false);
      if (isTenantApiError(err) && err.code === 'EXAM_TYPE_HAS_ACTIVE_ATTEMPTS') {
        setConfirmOpen(false);
        setBlockedMessage(
          `'${examType.name}' can't be deleted right now because it has learners actively taking exams. Try again once those attempts are finished.`,
        );
      } else if (isTenantApiError(err) && err.code === 'EXAM_TYPE_NOT_FOUND') {
        toaster.create({ title: 'This Exam Type was already removed.', type: 'info' });
        router.replace('/exam-types');
      } else {
        toaster.create({ title: 'Something went wrong. Please try again.', type: 'error' });
        setConfirmOpen(false);
      }
    }
  }

  if (state === 'loading') {
    return (
      <Box maxW="700px">
        <Box h="8" bg="gray.100" borderRadius="md" mb="4" w="240px" />
        <Box h="40" bg="gray.100" borderRadius="md" />
      </Box>
    );
  }

  if (state === 'not-found') {
    return (
      <Box maxW="700px">
        <Text mb="4">This Exam Type no longer exists. It may have been deleted.</Text>
        <Link href="/exam-types">
          <Text as="span" color="brand.fg">
            ← Back to Exam Types
          </Text>
        </Link>
      </Box>
    );
  }

  if (state === 'error' || !examType) {
    return (
      <Box maxW="700px">
        <Text>We couldn&apos;t load this Exam Type. Try again.</Text>
      </Box>
    );
  }

  return (
    <Box maxW="700px">
      <Link href="/exam-types">
        <Text as="span" color="brand.fg" display="inline-block" mb="4">
          ← Back to Exam Types
        </Text>
      </Link>

      <Stack direction="row" justify="space-between" align="center" mb="4">
        <Heading size="md">{examType.name}</Heading>
        {canDelete && (
          <Button variant="outline" colorPalette="red" onClick={() => setConfirmOpen(true)}>
            Delete Exam Type
          </Button>
        )}
      </Stack>

      {blockedMessage && (
        <Box role="alert" bg="orange.subtle" color="orange.fg" borderRadius="md" px="4" py="3" fontSize="sm" mb="4" tabIndex={-1}>
          {blockedMessage}
        </Box>
      )}

      <Table.Root variant="outline" mb="8" data-testid="exam-type-metadata">
        <Table.Body>
          <Table.Row>
            <Table.Cell fontWeight="medium">Description</Table.Cell>
            <Table.Cell>{examType.description ?? '—'}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell fontWeight="medium">Stage</Table.Cell>
            <Table.Cell>{stageName}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell fontWeight="medium">Total questions declared</Table.Cell>
            <Table.Cell>{examType.totalQuestions}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell fontWeight="medium">Total minutes</Table.Cell>
            <Table.Cell>{examType.totalMinutes}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell fontWeight="medium">Created</Table.Cell>
            <Table.Cell>{new Date(examType.createdAt).toLocaleString()}</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>

      <Heading size="sm" mb="2">
        Modules
      </Heading>
      <Table.Root data-testid="exam-type-modules-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Module name</Table.ColumnHeader>
            <Table.ColumnHeader>Declared question count</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {examType.modules.map((m) => (
            <Table.Row key={m.id}>
              <Table.Cell>{m.moduleName}</Table.Cell>
              <Table.Cell>{m.questionCount}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      {examType.curriculumLinks.length > 0 && (
        <Box mt="8">
          <Heading size="sm" mb="2">
            Linked Curricula
          </Heading>
          <Table.Root data-testid="exam-type-curriculum-links-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Curriculum</Table.ColumnHeader>
                <Table.ColumnHeader>Context weight</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {examType.curriculumLinks.map((link) => (
                <Table.Row key={link.curriculumId}>
                  <Table.Cell>{link.curriculumName}</Table.Cell>
                  <Table.Cell>{link.contextWeight}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      {hasPermission('exams.finalize') && examType.origin === 'AiPipeline' && (
        <AppendFromSessionSection examTypeId={examType.id} onAppended={(row) => setExamType(row)} />
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete '${examType.name}'?`}
        message="This permanently removes the Exam Type, all of its questions, and any generated content tied to it. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </Box>
  );
}

/**
 * FR-PDF-10's append action, surfaced from the Exam Type detail page (migration plan Phase 6, sub-slice
 * "6c") — lets a reviewer pick a completed PDF processing session and a comma-separated list of that
 * session's `generated_question` ids to append onto THIS (already-live, `AiPipeline`-origin) Exam Type.
 * Only rendered for an `AiPipeline`-origin Exam Type (append is rejected with
 * `APPEND_NOT_SUPPORTED_FOR_LEGACY_ZIP` for a `ZipImport` one — see `AppendExamService`'s own doc
 * comment) and only for a caller holding `exams.finalize` (the same permission `POST .../finalize`
 * requires — LLD §7.6 names no separate permission for append).
 *
 * Deliberately a minimal id-list input rather than a full cross-session question picker widget — the
 * review screen at `/pdf-processing/:id` is where a reviewer actually selects/inspects questions
 * (checkboxes in that screen's own table); this control's job is only to target THIS Exam Type as the
 * append destination once those ids are known (e.g. copied from that screen), not to duplicate its
 * picker UI here.
 */
function AppendFromSessionSection({ examTypeId, onAppended }: { examTypeId: string; onAppended: (examType: examTypesApi.ExamTypeSummary) => void }) {
  const [sessionId, setSessionId] = useState('');
  const [idsText, setIdsText] = useState('');
  const [appending, setAppending] = useState(false);

  async function handleAppend() {
    const ids = idsText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (!sessionId.trim() || ids.length === 0) {
      toaster.create({ title: 'Enter the source session id and at least one question id', type: 'error' });
      return;
    }
    setAppending(true);
    try {
      const result = await pdfProcessingApi.appendToExamType(sessionId.trim(), { examTypeId, ids }, crypto.randomUUID());
      toaster.create({ title: `Now ${result.totalQuestions} question(s) total`, type: 'success' });
      onAppended(result as unknown as examTypesApi.ExamTypeSummary);
      setIdsText('');
    } catch (err) {
      const message = isTenantApiError(err) ? err.message : 'Append failed';
      toaster.create({ title: message, type: 'error' });
    } finally {
      setAppending(false);
    }
  }

  return (
    <Box mt="8" borderWidth="1px" borderRadius="md" p="4" data-testid="append-from-session-form">
      <Heading size="sm" mb="3">
        Append questions from a PDF processing session
      </Heading>
      <Stack gap="3" maxW="500px">
        <Field.Root>
          <Field.Label>Source session id</Field.Label>
          <Input value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="Completed session id" />
        </Field.Root>
        <Field.Root>
          <Field.Label>Question ids (comma-separated)</Field.Label>
          <Input value={idsText} onChange={(e) => setIdsText(e.target.value)} placeholder="id-1, id-2, id-3" />
        </Field.Root>
        <Button onClick={handleAppend} loading={appending} colorPalette="brand" alignSelf="start">
          Append
        </Button>
      </Stack>
    </Box>
  );
}
