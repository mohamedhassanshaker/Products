'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Checkbox, Field, Heading, Image, Input, NativeSelect, Spinner, Stack, Table, Text, Textarea } from '@chakra-ui/react';
import * as pdfProcessingApi from '@/lib/tenant-console/pdf-processing-api';
import * as curriculaApi from '@/lib/tenant-console/curricula-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';
import { toaster } from '@/components/ui/toaster';
import { SimilarQuestionsDialog } from '@/components/tenant/similar-questions-dialog';

type LoadState = 'loading' | 'not-found' | 'forbidden' | 'error' | 'ready';

/** In-flight statuses the poll keeps re-fetching for; a terminal status (`Completed`/`Failed`) stops
 * polling — matches `PdfProcessingSessionStatus`'s own status vocabulary. */
const IN_FLIGHT_STATUSES = new Set(['Pending', 'Extracting', 'Classifying', 'Processing']);

/** How often this screen re-polls `GET /api/pdf-processing/sessions/:id` while a session is in flight. */
const POLL_INTERVAL_MS = 3000;

/**
 * PDF processing session status screen (migration plan Phase 6, sub-slice "6a", `/pdf-processing/:id`)
 * — the minimal status-poll surface this sub-slice's own scope calls for: a "Generating" in-flight
 * spinner state, a "Reviewing-ready" (`Completed`) state showing the real, persisted question count,
 * and a "Failed" state showing the real `errorMessage`. The full review-table UI (edit/bulk-actions,
 * FR-PDF-8/9) is sub-slice 6c's own scope — this screen deliberately stops at "tell the uploader what
 * happened", matching legacy's own `PdfSessionComponent`'s documented status-driven rendering
 * convention (one route rendering distinct states purely from `session.status`), narrowed to this
 * sub-slice's own three states.
 *
 * Gated by `pdf.review` (or ownership, enforced server-side by `PdfProcessingService.getSession` — this
 * screen itself does not attempt a client-side ownership check, since the server is the sole source of
 * truth for that decision).
 */
export default function PdfProcessingSessionPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useTenantAuthContext();
  const [state, setState] = useState<LoadState>('loading');
  const [session, setSession] = useState<pdfProcessingApi.PdfProcessingSessionSummary | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const row = await pdfProcessingApi.getSession(id);
        if (cancelled) return;
        setSession(row);
        setState('ready');
        if (IN_FLIGHT_STATUSES.has(row.status)) {
          pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        if (isTenantApiError(err) && err.code === 'SESSION_NOT_FOUND') {
          setState('not-found');
        } else if (isTenantApiError(err) && (err.code === 'NOT_SESSION_OWNER' || err.code === 'FORBIDDEN')) {
          setState('forbidden');
        } else {
          setState('error');
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [id]);

  if (!hasPermission('pdf.review')) {
    return (
      <Box maxW="700px">
        <Heading size="md" mb="2">
          PDF Processing Session
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
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
        <Text mb="4">This PDF processing session no longer exists.</Text>
        <BackLink />
      </Box>
    );
  }

  if (state === 'forbidden') {
    return (
      <Box maxW="700px">
        <Text mb="4">You do not have access to this processing session.</Text>
        <BackLink />
      </Box>
    );
  }

  if (state === 'error' || !session) {
    return (
      <Box maxW="700px">
        <Text>We couldn&apos;t load this session. Try again.</Text>
      </Box>
    );
  }

  return (
    <Box maxW="700px">
      <BackLink />
      <Heading size="md" mb="4" mt="4">
        {session.sourceFileName}
      </Heading>

      {IN_FLIGHT_STATUSES.has(session.status) && (
        <Stack direction="row" align="center" gap="3" role="status" aria-live="polite" mb="4">
          <Spinner size="sm" />
          <Text>Generating… ({session.status})</Text>
        </Stack>
      )}

      {session.status === 'Completed' && (
        <Box role="status" aria-live="polite" bg="green.subtle" color="green.fg" borderRadius="md" px="4" py="3" mb="4">
          <Text fontWeight="semibold">Ready for review</Text>
          <Text fontSize="sm">
            {session.successfulQuestions} question{session.successfulQuestions === 1 ? '' : 's'} generated
            {session.reusedFromSessionId ? ' (reused from a previously-processed identical/near-duplicate document)' : ''}.
          </Text>
        </Box>
      )}

      {session.status === 'Failed' && (
        <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" mb="4">
          <Text fontWeight="semibold">Processing failed</Text>
          <Text fontSize="sm">{session.errorMessage ?? 'An unknown error occurred.'}</Text>
        </Box>
      )}

      <Table.Root variant="outline" data-testid="pdf-session-metadata">
        <Table.Body>
          <Table.Row>
            <Table.Cell fontWeight="medium">Status</Table.Cell>
            <Table.Cell>{session.status}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell fontWeight="medium">Content type</Table.Cell>
            <Table.Cell>{session.contentType ?? '—'}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell fontWeight="medium">Pages</Table.Cell>
            <Table.Cell>{session.pageCount ?? '—'}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell fontWeight="medium">Questions generated</Table.Cell>
            <Table.Cell>{session.successfulQuestions}</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell fontWeight="medium">Uploaded</Table.Cell>
            <Table.Cell>{new Date(session.createdAt).toLocaleString()}</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>

      {session.status === 'Completed' && <ReviewAndFinalizeSection sessionId={session.id} />}
    </Box>
  );
}

/**
 * FR-PDF-8's review table (edit/flag/bulk-delete/bulk-regenerate, image thumbnails via `server/media`'s
 * `listImagesForQuestions` read shape) and FR-PDF-9's finalize form (migration plan Phase 6, sub-slice
 * "6c"). Only rendered once a session reaches `Completed` — a review screen for an in-flight session has
 * nothing yet to review. `pdf.review` gates the table itself (checked by the parent page's own
 * `hasPermission` guard before this component is ever mounted); `exams.finalize` gates the finalize
 * button specifically (a reviewer without that permission can still review/edit/delete but not create a
 * live Exam Type).
 */
function ReviewAndFinalizeSection({ sessionId }: { sessionId: string }) {
  const { hasPermission } = useTenantAuthContext();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [questions, setQuestions] = useState<pdfProcessingApi.GeneratedQuestionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  // Sub-slice "6d" — the reviewer "Find similar questions" tool, launched per-row regardless of the
  // row's own state (flagged/edited/etc. never gate this advisory-only lookup).
  const [similarQuestionId, setSimilarQuestionId] = useState<string | null>(null);

  const [examName, setExamName] = useState('');
  const [totalMinutes, setTotalMinutes] = useState('30');
  const [minConfidence, setMinConfidence] = useState('0.5');
  const [finalizing, setFinalizing] = useState(false);

  // FR-AUTH-4's optional Curriculum-linking picker — left unselected (`''`) by default, since linking a
  // Curriculum is genuinely optional at finalize time (LLD §8.5); `curriculumId === ''` means "finalize
  // with no `curriculumLinks[]` at all", not "link to an empty id".
  const [curricula, setCurricula] = useState<curriculaApi.CurriculumSummary[]>([]);
  const [curriculumId, setCurriculumId] = useState('');
  const [contextWeight, setContextWeight] = useState('5');

  const pageSize = 20;

  useEffect(() => {
    curriculaApi.listCurricula().then(setCurricula).catch(() => {
      // Best-effort — the picker simply stays empty (equivalent to "no Curriculum available to link
      // yet"); it must never block the rest of this already-loaded review/finalize screen.
    });
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const result = await pdfProcessingApi.listQuestions(sessionId, page, pageSize);
      setQuestions(result.items);
      setTotal(result.total);
      setSelected(new Set());
    } catch {
      toaster.create({ title: 'Could not load questions', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFlag(id: string, flagged: boolean) {
    try {
      await pdfProcessingApi.setQuestionFlag(id, flagged);
      await reload();
    } catch {
      toaster.create({ title: 'Could not update the review flag', type: 'error' });
    }
  }

  function startEdit(question: pdfProcessingApi.GeneratedQuestionSummary) {
    setEditingId(question.id);
    setEditText(question.questionText);
  }

  async function saveEdit(id: string) {
    try {
      await pdfProcessingApi.editQuestion(id, { questionText: editText });
      setEditingId(null);
      await reload();
    } catch {
      toaster.create({ title: 'Could not save the edit', type: 'error' });
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    try {
      const result = await pdfProcessingApi.bulkDeleteQuestions(sessionId, Array.from(selected));
      toaster.create({ title: `Deleted ${result.deletedCount} question(s)`, type: 'success' });
      await reload();
    } catch {
      toaster.create({ title: 'Bulk delete failed', type: 'error' });
    }
  }

  async function handleBulkRegenerate() {
    if (selected.size === 0) return;
    try {
      const result = await pdfProcessingApi.bulkRegenerateQuestions(sessionId, Array.from(selected));
      toaster.create({ title: `Regenerated ${result.regeneratedCount} of ${result.requestedCount} question(s)`, type: 'success' });
      await reload();
    } catch {
      toaster.create({ title: 'Bulk regenerate failed', type: 'error' });
    }
  }

  async function handleFinalize() {
    if (!examName.trim()) {
      toaster.create({ title: 'Enter an Exam Type name first', type: 'error' });
      return;
    }
    if (curriculumId && (!Number.isInteger(Number(contextWeight)) || Number(contextWeight) < 1 || Number(contextWeight) > 10)) {
      toaster.create({ title: 'Context weight must be a whole number from 1 to 10', type: 'error' });
      return;
    }
    setFinalizing(true);
    try {
      const examType = await pdfProcessingApi.finalizeSession(sessionId, {
        examName: examName.trim(),
        totalMinutes: Number(totalMinutes) || 30,
        totalQuestions: total,
        minConfidence: Number(minConfidence) || 0,
        // Only present when a Curriculum is actually selected — an empty `curriculumLinks: []` and an
        // omitted `curriculumLinks` are functionally identical server-side, but omitting it here keeps
        // the request body an honest reflection of "the reviewer did not use this optional feature".
        curriculumLinks: curriculumId ? [{ curriculumId, contextWeight: Number(contextWeight) }] : undefined,
      });
      toaster.create({ title: `Exam Type "${examType.name}" created`, type: 'success' });
      router.push(`/exam-types/${examType.id}`);
    } catch (err) {
      const message = isTenantApiError(err) ? err.message : 'Finalize failed';
      toaster.create({ title: message, type: 'error' });
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <Box mt="8">
      <Heading size="sm" mb="3">
        Review questions ({total})
      </Heading>

      {loading ? (
        <Spinner size="sm" />
      ) : (
        <>
          <Stack direction="row" gap="2" mb="3">
            <Button size="sm" onClick={handleBulkDelete} disabled={selected.size === 0}>
              Delete selected ({selected.size})
            </Button>
            <Button size="sm" variant="outline" onClick={handleBulkRegenerate} disabled={selected.size === 0}>
              Regenerate selected
            </Button>
          </Stack>

          <Table.Root variant="outline" size="sm" data-testid="question-review-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader />
                <Table.ColumnHeader>Question</Table.ColumnHeader>
                <Table.ColumnHeader>Confidence</Table.ColumnHeader>
                <Table.ColumnHeader>Flagged</Table.ColumnHeader>
                <Table.ColumnHeader>Images</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {questions.map((q) => (
                <Table.Row key={q.id}>
                  <Table.Cell>
                    <Checkbox.Root checked={selected.has(q.id)} onCheckedChange={() => toggleSelected(q.id)}>
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                    </Checkbox.Root>
                  </Table.Cell>
                  <Table.Cell maxW="360px">
                    {editingId === q.id ? (
                      <Stack direction="row" gap="2">
                        <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} size="sm" />
                        <Button size="sm" onClick={() => saveEdit(q.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </Stack>
                    ) : (
                      <Text onClick={() => startEdit(q)} cursor="pointer">
                        {q.questionText} {q.isHumanEdited && <Text as="span" color="gray.500" fontSize="xs">(edited)</Text>}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>{q.confidenceScore.toFixed(2)}</Table.Cell>
                  <Table.Cell>
                    <Checkbox.Root checked={q.isReviewFlagged} onCheckedChange={() => handleFlag(q.id, !q.isReviewFlagged)}>
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                    </Checkbox.Root>
                  </Table.Cell>
                  <Table.Cell>
                    <Stack direction="row" gap="1">
                      {q.images.slice(0, 3).map((img) => (
                        <Image key={img.id} src={`/api/files/d/${img.storageKey}`} alt={img.altText} boxSize="32px" objectFit="cover" borderRadius="sm" />
                      ))}
                    </Stack>
                  </Table.Cell>
                  <Table.Cell>
                    <Button size="xs" variant="outline" onClick={() => setSimilarQuestionId(q.id)}>
                      Find similar
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>

          <SimilarQuestionsDialog generatedQuestionId={similarQuestionId} onClose={() => setSimilarQuestionId(null)} />

          <Stack direction="row" gap="2" mt="3" align="center">
            <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <Text fontSize="sm">Page {page}</Text>
            <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)} disabled={page * pageSize >= total}>
              Next
            </Button>
          </Stack>
        </>
      )}

      {hasPermission('exams.finalize') && (
        <Box mt="8" borderWidth="1px" borderRadius="md" p="4" data-testid="finalize-form">
          <Heading size="sm" mb="3">
            Finalize into an Exam Type
          </Heading>
          <Stack gap="3" maxW="400px">
            <Field.Root>
              <Field.Label>Exam Type name</Field.Label>
              <Input value={examName} onChange={(e) => setExamName(e.target.value)} />
            </Field.Root>
            <Field.Root>
              <Field.Label>Total minutes</Field.Label>
              <Input type="number" value={totalMinutes} onChange={(e) => setTotalMinutes(e.target.value)} />
            </Field.Root>
            <Field.Root>
              <Field.Label>Minimum confidence (0-1)</Field.Label>
              <Input type="number" step="0.05" min="0" max="1" value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} />
            </Field.Root>

            <Field.Root>
              <Field.Label>Link a Curriculum (optional)</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)}>
                  <option value="">No Curriculum link</option>
                  {curricula.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
            {curriculumId && (
              <Field.Root>
                <Field.Label>Context weight (1-10)</Field.Label>
                <Input type="number" min="1" max="10" step="1" value={contextWeight} onChange={(e) => setContextWeight(e.target.value)} />
              </Field.Root>
            )}

            <Button onClick={handleFinalize} loading={finalizing} colorPalette="brand">
              Finalize
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

function BackLink() {
  return (
    <Link href="/pdf-processing">
      <Text as="span" color="brand.fg" display="inline-block">
        ← Back to PDF Import
      </Text>
    </Link>
  );
}
