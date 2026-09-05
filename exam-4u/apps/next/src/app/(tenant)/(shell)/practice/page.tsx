'use client';

import { useEffect, useState } from 'react';
import { Box, Button, Heading, NativeSelect, NumberInput, Stack, Text, Textarea } from '@chakra-ui/react';
import * as curriculaApi from '@/lib/tenant-console/curricula-api';
import * as practiceApi from '@/lib/tenant-console/practice-api';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

/**
 * FR-CUR-5's live Prompt Practice flow (migration plan Phase 8) — gated by `curricula.manage_own`,
 * matching `POST /api/practice/prompt`'s own RBAC grant.
 *
 * **Explicit state machine (`docs/design/UX_GUIDELINES.md`'s Phase 8 addition)**: `'form'` (entry) →
 * `'generating'` (a multi-second wait — FR-CUR-5's own documented "Generating" state) → one of three
 * terminal states: `'completed'` (real questions rendered), `'failed'` (a normal 200 with an
 * actionable message — the zero-usable-questions outcome, distinct from a genuine error), or
 * `'error'` (a real network/5xx failure). Client-side validation prevents submitting an empty prompt
 * or an out-of-range count before any request is made (`EMPTY_PROMPT`/`INVALID_QUESTION_COUNT` are
 * both client-preventable per this feature's own spec framing); a `CURRICULUM_NOT_FOUND` response is
 * the one server-side validation error this form cannot prevent client-side (the dropdown only lists
 * curricula the caller already owns, but a stale selection racing a concurrent delete is still
 * possible) and is surfaced via the generic error state's message.
 *
 * **Lesson Practice / Full-Bank Assessment ship backend-only this phase** — see
 * `docs/plans/nextjs-rewrite-phase8-plan.md`'s "Decisions made" for the documented scope choice
 * (matches legacy's own precedent: both shipped backend-only, no UI, in the legacy build).
 */
export default function PracticePage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('curricula.manage_own')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Practice
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <PromptPracticeAuthorized />;
}

type ViewState =
  | { kind: 'form' }
  | { kind: 'generating' }
  | { kind: 'completed'; questions: practiceApi.PromptPracticeQuestion[] }
  | { kind: 'failed'; message: string }
  | { kind: 'error'; message: string };

function PromptPracticeAuthorized() {
  const [curricula, setCurricula] = useState<curriculaApi.CurriculumSummary[] | null>(null);
  const [curriculumId, setCurriculumId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(5);
  const [view, setView] = useState<ViewState>({ kind: 'form' });

  useEffect(() => {
    curriculaApi
      .listCurricula()
      .then((rows) => {
        setCurricula(rows);
        if (rows.length > 0) setCurriculumId(rows[0].id);
      })
      .catch(() => setCurricula([]));
  }, []);

  // Client-prevented per this feature's own spec framing — EMPTY_PROMPT/INVALID_QUESTION_COUNT never
  // reach the server from this form.
  const promptTrimmed = prompt.trim();
  const canSubmit = curriculumId.length > 0 && promptTrimmed.length > 0 && Number.isInteger(count) && count >= 1 && count <= 30;

  async function generate() {
    setView({ kind: 'generating' });
    try {
      const result = await practiceApi.generatePromptPractice({ curriculumId, prompt: promptTrimmed, count });
      if (result.status === 'failed') {
        setView({ kind: 'failed', message: result.message });
      } else {
        setView({ kind: 'completed', questions: result.questions });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong generating your practice questions.';
      setView({ kind: 'error', message });
    }
  }

  return (
    <Box maxW="800px">
      <Heading size="md" mb="4">
        Prompt Practice
      </Heading>
      <Text color="gray.600" mb="6">
        Describe a topic and get practice questions generated live from your Curriculum&apos;s content.
      </Text>

      {view.kind === 'generating' ? (
        <Stack gap="3" data-testid="practice-generating">
          <Text>Generating your practice questions…</Text>
          <Box h="10" bg="gray.100" borderRadius="md" />
        </Stack>
      ) : view.kind === 'completed' ? (
        <Stack gap="4" data-testid="practice-results">
          <Text fontWeight="semibold">{view.questions.length} question(s) generated</Text>
          {view.questions.map((q, i) => (
            <Box key={i} borderWidth="1px" borderRadius="md" p="4">
              <Text fontWeight="medium" mb="2">
                {i + 1}. {q.questionText}
              </Text>
              <Stack gap="1" mb="2">
                {q.options.map((opt) => (
                  <Text key={opt.key} fontSize="sm">
                    {opt.key}. {opt.text}
                    {opt.key === q.correctAnswer ? ' ✓' : ''}
                  </Text>
                ))}
              </Stack>
              <Text fontSize="sm" color="gray.600">
                {q.explanation}
              </Text>
            </Box>
          ))}
          <Button variant="outline" onClick={() => setView({ kind: 'form' })} alignSelf="start">
            Practice again
          </Button>
        </Stack>
      ) : view.kind === 'failed' ? (
        <Stack gap="3" data-testid="practice-failed">
          <Text color="orange.700">{view.message}</Text>
          <Button variant="outline" onClick={() => setView({ kind: 'form' })} alignSelf="start">
            Try again
          </Button>
        </Stack>
      ) : view.kind === 'error' ? (
        <Stack gap="3" data-testid="practice-error">
          <Text color="red.600">{view.message}</Text>
          <Button variant="outline" onClick={() => setView({ kind: 'form' })} alignSelf="start">
            Try again
          </Button>
        </Stack>
      ) : (
        <Stack gap="4" data-testid="practice-form">
          <Box>
            <Text mb="1" fontSize="sm" fontWeight="medium">
              Curriculum
            </Text>
            {curricula === null ? (
              <Box h="10" bg="gray.100" borderRadius="md" />
            ) : curricula.length === 0 ? (
              <Text color="gray.600" fontSize="sm">
                You don&apos;t have any curricula yet — create one first.
              </Text>
            ) : (
              <NativeSelect.Root>
                <NativeSelect.Field value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)}>
                  {curricula.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            )}
          </Box>

          <Box>
            <Text mb="1" fontSize="sm" fontWeight="medium">
              Prompt
            </Text>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Practice questions about photosynthesis"
              data-testid="practice-prompt-input"
            />
          </Box>

          <Box maxW="200px">
            <Text mb="1" fontSize="sm" fontWeight="medium">
              Number of questions (1-30)
            </Text>
            <NumberInput.Root
              value={String(count)}
              min={1}
              max={30}
              onValueChange={(e) => setCount(Number.isNaN(e.valueAsNumber) ? 0 : e.valueAsNumber)}
            >
              <NumberInput.Control />
              <NumberInput.Input data-testid="practice-count-input" />
            </NumberInput.Root>
          </Box>

          <Button colorPalette="brand" onClick={generate} disabled={!canSubmit} alignSelf="start" data-testid="practice-generate-button">
            Generate
          </Button>
        </Stack>
      )}
    </Box>
  );
}
