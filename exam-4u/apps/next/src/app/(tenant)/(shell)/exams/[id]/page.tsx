'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Button, Heading, List, Stack, Text } from '@chakra-ui/react';
import * as attemptsApi from '@/lib/tenant-console/attempts-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';

/**
 * FR-TAKE-1's instructions screen (`docs/design/UX_GUIDELINES.md` §12.1) — gated by `attempts.take`.
 * Starting a new attempt while one is already `InProgress` for this Exam Type surfaces
 * `ATTEMPT_ALREADY_IN_PROGRESS` (carrying the existing attempt's id in `details.attemptId`); this
 * screen reacts to that by opening the resume dialog rather than showing a generic error toast — the
 * one deliberate special-case error handling on this page.
 */
export default function ExamInstructionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('attempts.take')) {
    return (
      <Box>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <ExamInstructionsAuthorized examTypeId={id} />;
}

function ExamInstructionsAuthorized({ examTypeId }: { examTypeId: string }) {
  const router = useRouter();
  const [instructions, setInstructions] = useState<attemptsApi.ExamInstructions | null>(null);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [resumeAttemptId, setResumeAttemptId] = useState<string | null>(null);

  useEffect(() => {
    attemptsApi
      .getInstructions(examTypeId)
      .then(setInstructions)
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examTypeId]);

  async function handleStart() {
    setStarting(true);
    try {
      const result = await attemptsApi.startAttempt(examTypeId);
      router.push(`/attempts/${result.attemptId}`);
    } catch (err) {
      setStarting(false);
      if (isTenantApiError(err) && err.code === 'ATTEMPT_ALREADY_IN_PROGRESS') {
        const existingId = (err.details?.attemptId as string | undefined) ?? null;
        setResumeAttemptId(existingId);
      } else if (isTenantApiError(err) && err.code === 'INSUFFICIENT_QUESTION_BANK') {
        setError(true);
      }
    }
  }

  if (error) {
    return <Text color="red.fg">This exam is not currently available. Please try again later.</Text>;
  }
  if (!instructions) {
    return (
      <Stack gap="2">
        {[1, 2, 3].map((i) => (
          <Box key={i} h="10" bg="gray.100" borderRadius="md" />
        ))}
      </Stack>
    );
  }

  return (
    <Box maxW="700px">
      <Heading size="md" mb="2">
        {instructions.name}
      </Heading>
      {instructions.description && (
        <Text color="gray.600" mb="4">
          {instructions.description}
        </Text>
      )}
      <Text mb="1">
        <strong>{instructions.totalQuestions}</strong> question(s), <strong>{instructions.totalMinutes}</strong> minute(s) total.
      </Text>
      <List.Root mb="6" ps="4">
        {instructions.modules.map((m) => (
          <List.Item key={m.moduleName}>
            {m.moduleName} — {m.questionCount} question(s)
          </List.Item>
        ))}
      </List.Root>
      <Text fontSize="sm" color="gray.600" mb="4">
        Once you start, the timer begins immediately and cannot be paused. The exam is automatically
        submitted if time runs out.
      </Text>
      <Button colorPalette="brand" loading={starting} onClick={handleStart}>
        Start exam
      </Button>

      <ConfirmDialog
        open={resumeAttemptId !== null}
        title="You already have an attempt in progress"
        message="You already started this exam and haven't finished it yet. Resume where you left off?"
        confirmLabel="Resume"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (resumeAttemptId) router.push(`/attempts/${resumeAttemptId}`);
        }}
        onCancel={() => setResumeAttemptId(null)}
      />
    </Box>
  );
}
