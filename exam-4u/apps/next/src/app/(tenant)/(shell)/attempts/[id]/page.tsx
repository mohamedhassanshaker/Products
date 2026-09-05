'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Box, Button, Heading, HStack, Progress, RadioGroup, Stack, Text } from '@chakra-ui/react';
import * as attemptsApi from '@/lib/tenant-console/attempts-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';

/**
 * FR-TAKE-4/5/6/7's exam-taking screen (`docs/design/UX_GUIDELINES.md` §12.2/12.3). Renders purely
 * from the attempt's own `status`, matching this app's established "one screen, several states driven
 * by server truth" convention (`PdfSessionComponent`'s identical shape).
 *
 * **Server-authoritative timer (HLD §10.4) — never a client-trusted countdown**: the displayed
 * countdown is derived once per header refresh from `deadlineAt - serverNow` (both server clock
 * values) plus the *client's own* elapsed wall-clock time since that refresh — it is a display
 * convenience only. Enforcement always happens server-side (the lazy-timeout path applied before
 * every read/write); this screen simply re-fetches the header periodically and reacts to whatever the
 * server reports, including the named "time's up" interstitial the moment any request comes back
 * `ATTEMPT_NOT_IN_PROGRESS`/409 with a status no longer `InProgress`.
 */
export default function AttemptTakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AttemptTakeScreen attemptId={id} />;
}

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'timedOut' }
  | { kind: 'result'; result: attemptsApi.SubmitResult }
  | { kind: 'taking'; header: attemptsApi.AttemptHeader; question: attemptsApi.AttemptQuestionView };

function AttemptTakeScreen({ attemptId }: { attemptId: string }) {
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [questionIndex, setQuestionIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Local wall-clock anchor so the on-screen countdown ticks every second between header refreshes,
  // without ever trusting the client's own notion of "now" for anything but display.
  const [nowTick, setNowTick] = useState(() => Date.now());

  const loadedOnce = useRef(false);

  async function loadHeaderAndQuestion(index: number) {
    try {
      const header = await attemptsApi.getAttemptHeader(attemptId);
      if (header.status !== 'InProgress') {
        setState({ kind: 'timedOut' });
        return;
      }
      const question = await attemptsApi.getQuestion(attemptId, index);
      setState({ kind: 'taking', header, question });
    } catch (err) {
      if (isTenantApiError(err) && err.code === 'ATTEMPT_NOT_IN_PROGRESS') {
        setState({ kind: 'timedOut' });
      } else {
        setState({ kind: 'error' });
      }
    }
  }

  useEffect(() => {
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      loadHeaderAndQuestion(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // Re-syncs the header (and therefore the deadline) every 15s — the periodic re-check that surfaces
  // a server-side timeout even if the learner never navigates between questions.
  useEffect(() => {
    if (state.kind !== 'taking') return;
    const interval = setInterval(() => loadHeaderAndQuestion(questionIndex), 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, questionIndex]);

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  async function goTo(index: number) {
    setQuestionIndex(index);
    await loadHeaderAndQuestion(index);
  }

  async function handleAnswer(option: string) {
    if (state.kind !== 'taking') return;
    try {
      await attemptsApi.answerQuestion(attemptId, questionIndex, option);
      setState({ ...state, question: { ...state.question, selectedOption: option } });
    } catch (err) {
      if (isTenantApiError(err) && err.code === 'ATTEMPT_NOT_IN_PROGRESS') {
        setState({ kind: 'timedOut' });
      }
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const result = await attemptsApi.submitAttempt(attemptId);
      setState({ kind: 'result', result });
    } catch (err) {
      if (isTenantApiError(err) && err.code === 'ATTEMPT_NOT_IN_PROGRESS') {
        setState({ kind: 'timedOut' });
      } else {
        setState({ kind: 'error' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === 'loading') {
    return <Progress.Root value={null}><Progress.Track><Progress.Range /></Progress.Track></Progress.Root>;
  }

  if (state.kind === 'error') {
    return <Text color="red.fg">Something went wrong loading this attempt. Please refresh.</Text>;
  }

  // The named "time's up"/no-longer-in-progress interstitial (FR-TAKE-6/7) — never a silent redirect,
  // always an explicit, distinct screen state (UX_GUIDELINES §12.3a).
  if (state.kind === 'timedOut') {
    return (
      <Box textAlign="center" py="10" role="alert">
        <Heading size="md" mb="3">
          Time&apos;s up
        </Heading>
        <Text color="gray.600" mb="6">
          This attempt is no longer in progress — it was either submitted or the time limit was
          reached. Your answers up to that point have been saved and scored.
        </Text>
        <Link href={`/attempts/${attemptId}/review`}>
          <Button colorPalette="brand">View review</Button>
        </Link>
      </Box>
    );
  }

  if (state.kind === 'result') {
    const r = state.result;
    return (
      <Box textAlign="center" py="10">
        <Heading size="md" mb="3">
          Exam submitted
        </Heading>
        <Text fontSize="4xl" fontWeight="bold" mb="1">
          {r.scorePercent ?? 0}%
        </Text>
        <Text color="gray.600" mb="6">
          {r.correctCount} correct · {r.wrongCount} incorrect · {r.answeredCount}/{r.totalQuestions} answered
        </Text>
        <HStack justify="center" gap="3">
          <Link href={`/attempts/${attemptId}/review`}>
            <Button colorPalette="brand">Review answers</Button>
          </Link>
          <Link href="/attempts">
            <Button variant="outline">View history</Button>
          </Link>
        </HStack>
      </Box>
    );
  }

  const { header, question } = state;
  const remainingMs = Math.max(0, new Date(header.deadlineAt).getTime() - new Date(header.serverNow).getTime() - (nowTick - Date.parse(header.serverNow)));
  const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;

  return (
    <Box maxW="700px">
      <HStack justify="space-between" mb="4">
        <Heading size="md">{header.examTypeName}</Heading>
        <Text fontFamily="mono" fontSize="lg" aria-live="polite" aria-label="Time remaining" data-testid="attempt-time-remaining">
          {minutes}:{seconds.toString().padStart(2, '0')}
        </Text>
      </HStack>
      <Text color="gray.600" fontSize="sm" mb="4">
        Question {questionIndex + 1} of {header.totalQuestions} · {header.answeredCount} answered
      </Text>

      <Box borderWidth="1px" borderRadius="md" p="4" mb="4">
        <Text mb="4" fontWeight="medium">
          {question.questionText}
        </Text>
        {/* `key={question.questionIndex}` forces a fresh RadioGroup instance per question — a real,
            previously-latent bug this dispatch's own Playwright verification caught (only reachable by
            actually driving the real UI, never by a mocked-service unit test). Every question's option
            keys are the same literal strings ("A"/"B"/...), so without a remount React reconciles the
            SAME underlying `<input type=radio>` DOM nodes across a question navigation instead of
            replacing them.

            The key MUST be read from `question.questionIndex` (the fetched question's own field, set
            atomically together with `question.selectedOption` in the single `setState` call that lands
            the new question) — NOT from the separate `questionIndex` React state variable that this
            same component also tracks. `goTo` calls `setQuestionIndex(index)` synchronously, well
            before its own `await loadHeaderAndQuestion(index)` resolves and replaces `state.question`;
            keying off that separate variable therefore produces one transient render where the key has
            already advanced to the NEW index but `state.question` is still the PREVIOUS, already-
            answered question object (e.g. `selectedOption: 'B'`). Chakra's RadioGroup treats that
            transient value as its fresh mount's initial state, and — since the two renders that follow
            keep the SAME key (no second remount) — never visually re-syncs to `undefined` once the real
            new question's data lands a moment later. The net effect: the next option the learner clicks
            (even the identical letter, e.g. "B" again) is already showing as checked, so no native
            `change` event fires and the answer's `POST .../answer` call is silently never sent. Keying
            off `question.questionIndex` instead means the key and its `value` always change in the same
            state update — there is no intermediate frame where they disagree. */}
        <RadioGroup.Root
          key={question.questionIndex}
          value={question.selectedOption ?? undefined}
          onValueChange={(details) => details.value && handleAnswer(details.value)}
        >
          <Stack gap="3">
            {Object.entries(question.options).map(([key, label]) => (
              <RadioGroup.Item key={key} value={key} data-testid={`attempt-option-${key}`}>
                <RadioGroup.ItemHiddenInput />
                <RadioGroup.ItemIndicator />
                <RadioGroup.ItemText>
                  {key}. {label}
                </RadioGroup.ItemText>
              </RadioGroup.Item>
            ))}
          </Stack>
        </RadioGroup.Root>
      </Box>

      <HStack justify="space-between">
        <Button variant="outline" disabled={questionIndex === 0} onClick={() => goTo(questionIndex - 1)}>
          Previous
        </Button>
        {questionIndex + 1 < header.totalQuestions ? (
          <Button colorPalette="brand" onClick={() => goTo(questionIndex + 1)}>
            Next
          </Button>
        ) : (
          <Button colorPalette="brand" loading={submitting} onClick={handleSubmit}>
            Submit exam
          </Button>
        )}
      </HStack>
    </Box>
  );
}
