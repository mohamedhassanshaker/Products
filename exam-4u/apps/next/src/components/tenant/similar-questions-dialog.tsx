'use client';

import { useEffect, useState } from 'react';
import { Badge, Box, Button, Dialog, Portal, Spinner, Stack, Text } from '@chakra-ui/react';
import * as pdfProcessingApi from '@/lib/tenant-console/pdf-processing-api';

type LoadState = 'loading' | 'loaded' | 'empty' | 'error';

export interface SimilarQuestionsDialogProps {
  /** `null` closes the dialog; a `generatedQuestionId` opens it and triggers the fetch. */
  generatedQuestionId: string | null;
  onClose(): void;
}

/**
 * Read-only "Find similar questions" dialog (migration plan Phase 6, sub-slice "6d") — launched from a
 * per-row action on the FR-PDF-8 review table, regardless of the row's own state (flagged/edited/etc.
 * never gate this tool). Ported layout from `legacy/web/.../similar-questions-dialog.component.ts`:
 * loading/loaded/error states, plus an empty state visually distinct from the error state (a "no
 * matches" result is a normal, unremarkable outcome — an error is not).
 *
 * **Never gates or is consulted by Finalize** — purely advisory; no per-match action is offered here
 * (no click-through/navigation target, matching the service's own doc comment on why
 * `SimilarQuestionMatch` carries no id).
 */
export function SimilarQuestionsDialog({ generatedQuestionId, onClose }: SimilarQuestionsDialogProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [matches, setMatches] = useState<pdfProcessingApi.SimilarQuestionMatch[]>([]);
  // Bumped to re-trigger the fetch effect below without changing `generatedQuestionId` itself — backs
  // the error state's "Retry" affordance (`docs/design/UX_GUIDELINES.md` §11.3a point 3: "a 'Retry'
  // button that re-issues the same request without closing the dialog").
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!generatedQuestionId) return;
    let cancelled = false;
    setState('loading');
    setMatches([]);
    pdfProcessingApi
      .findSimilarQuestions(generatedQuestionId)
      .then((result) => {
        if (cancelled) return;
        setMatches(result);
        setState(result.length === 0 ? 'empty' : 'loaded');
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [generatedQuestionId, attempt]);

  return (
    <Dialog.Root open={generatedQuestionId !== null} onOpenChange={(details) => !details.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="similar-questions-dialog">
            <Dialog.Header>
              <Dialog.Title>Find similar questions</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              {state === 'loading' && (
                <Stack direction="row" align="center" gap="3" role="status" aria-live="polite">
                  <Spinner size="sm" />
                  <Text>Searching the question bank…</Text>
                </Stack>
              )}

              {state === 'error' && (
                <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3">
                  <Text mb="2">Something went wrong while searching for similar questions.</Text>
                  <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                    Retry
                  </Button>
                </Box>
              )}

              {state === 'empty' && (
                <Box role="status" bg="gray.subtle" color="gray.fg" borderRadius="md" px="4" py="3" data-testid="similar-questions-empty">
                  <Text>No sufficiently similar questions were found in this tenant&apos;s question bank.</Text>
                </Box>
              )}

              {state === 'loaded' && (
                <Stack gap="3" data-testid="similar-questions-results">
                  <Text fontSize="sm" color="gray.600">
                    {matches.length} match{matches.length === 1 ? '' : 'es'} found.
                  </Text>
                  {matches.map((match, index) => (
                    <Box key={index} borderWidth="1px" borderRadius="md" p="3" data-testid="similar-question-match">
                      <Stack direction="row" align="center" justify="space-between" mb="1">
                        <Text fontSize="xs" color="gray.600">
                          {match.examTypeName} → {match.moduleName}
                        </Text>
                        <ScoreBadge score={match.score} />
                      </Stack>
                      <Text
                        fontSize="sm"
                        overflow="hidden"
                        css={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                      >
                        {match.questionText}
                      </Text>
                    </Box>
                  ))}
                </Stack>
              )}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** Score badge — color-banded (≥0.85 green/high, ≥0.6 amber/medium, else red/low), text-labeled (never
 * color-only, per `docs/design/UX_GUIDELINES.md`'s accessibility baseline — color must never be the
 * sole signal). No dedicated shared confidence-badge component exists elsewhere in this app yet (this
 * dispatch's own research assumption did not hold up against the actual codebase); kept small and
 * local to this one dialog rather than introducing a new shared component with a single consumer. */
function ScoreBadge({ score }: { score: number }) {
  const palette = score >= 0.85 ? 'green' : score >= 0.6 ? 'orange' : 'red';
  const label = score >= 0.85 ? 'High' : score >= 0.6 ? 'Medium' : 'Low';
  return (
    <Badge colorPalette={palette} size="sm">
      {label} · {score.toFixed(2)}
    </Badge>
  );
}
