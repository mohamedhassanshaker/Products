'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Box, Button, Heading, HStack, SimpleGrid, Skeleton, Text, VStack } from '@chakra-ui/react';
import * as dashboardApi from '@/lib/tenant-console/dashboard-api';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

type LoadState = 'loading' | 'loaded' | 'error';

/** Attempt-status badge — never color-only (WCAG 2.2 AA), reusing `settings/billing/page.tsx`'s own
 * "text label is the non-color differentiator" precedent. */
const ATTEMPT_STATUS_LABEL: Record<dashboardApi.AttemptStatus, string> = {
  InProgress: 'In progress',
  Submitted: 'Submitted',
  TimedOut: 'Timed out',
};
const ATTEMPT_STATUS_PALETTE: Record<dashboardApi.AttemptStatus, string> = {
  InProgress: 'blue',
  Submitted: 'green',
  TimedOut: 'orange',
};

const PRACTICE_KIND_LABEL: Record<dashboardApi.PracticeSessionKind, string> = {
  Prompt: 'Prompt practice',
  LessonDocument: 'Lesson practice (document)',
  LessonSubject: 'Lesson practice (subject)',
  LessonCurriculum: 'Lesson practice (curriculum)',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One at-a-glance metric tile — reused for every count-only section (Curriculum/Exam Types). */
function StatTile({ label, value, href, testId }: { label: string; value: number; href: string; testId: string }) {
  return (
    <Link href={href}>
      <Box borderWidth="1px" borderRadius="md" p="4" _hover={{ bg: 'brand.subtle' }} data-testid={testId}>
        <Text fontSize="sm" color="gray.600" mb="1">
          {label}
        </Text>
        <Heading size="lg">{value}</Heading>
      </Box>
    </Link>
  );
}

/**
 * The tenant dashboard (`/`, migration plan Phase 9 sub-slice "9c" — deliberately the last Phase 9
 * sub-slice per the migration plan's own "aggregates across 3-8" ordering, since it has nothing to
 * aggregate until every prior feature module exists).
 *
 * **This is a genuinely new feature, not a port**: legacy's own `dashboard.component.ts` is an
 * early-build placeholder whose own doc comment states the real aggregating dashboard was "out of this
 * phase's scope (later backlog items)" and was never built — there is no legacy screen to port pixel-for
 * -pixel. This screen's own scope/shape (four proportionate summary sections, no charts/analytics
 * platform) is this dispatch's own documented judgment call — see
 * `docs/plans/nextjs-rewrite-phase9-plan.md`'s "Sub-slice 9c" section and
 * `docs/design/UX_GUIDELINES.md`'s new dashboard addition for the full write-up.
 *
 * Every section is optional in the wire response (`DashboardSummary`) — a section renders only when
 * present, so a user without a given permission simply sees fewer cards, never an error or an empty
 * placeholder for something they were never entitled to see (mirrors `tenant-shell.tsx`'s own
 * permission-gated nav).
 */
export default function DashboardPage() {
  const { user } = useTenantAuthContext();
  const [state, setState] = useState<LoadState>('loading');
  const [summary, setSummary] = useState<dashboardApi.DashboardSummary | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await dashboardApi.getDashboardSummary();
      setSummary(result);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box maxW="5xl">
      <Heading size="md" mb="1">
        {user ? `Welcome back, ${user.firstName}` : 'Dashboard'}
      </Heading>
      <Text color="gray.600" mb="6" fontSize="sm">
        A quick summary of your curricula, exam types, attempts, and practice activity.
      </Text>

      {state === 'loading' && (
        <VStack align="stretch" gap="4">
          <SimpleGrid columns={{ base: 1, sm: 2 }} gap="4">
            <Skeleton height="24" />
            <Skeleton height="24" />
          </SimpleGrid>
          <Skeleton height="32" />
          <Skeleton height="32" />
        </VStack>
      )}

      {state === 'error' && (
        <Box role="alert" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3">
          <Text mb="2">We couldn&apos;t load your dashboard.</Text>
          <Button size="sm" onClick={() => load()}>
            Retry
          </Button>
        </Box>
      )}

      {state === 'loaded' && summary && (
        <VStack align="stretch" gap="8" data-testid="dashboard-content">
          {!summary.curricula && !summary.examTypes && !summary.attempts && !summary.practice && (
            <Box borderRadius="md" px="4" py="3" bg="gray.50" data-testid="dashboard-empty">
              <Text>Nothing to show yet — your account doesn&apos;t have any dashboard-eligible permissions.</Text>
            </Box>
          )}

          {(summary.curricula || summary.examTypes) && (
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="4">
              {summary.curricula && (
                <StatTile label="Curricula" value={summary.curricula.count} href="/curricula" testId="stat-curricula" />
              )}
              {summary.examTypes && (
                <StatTile label="Exam types" value={summary.examTypes.count} href="/exam-types" testId="stat-exam-types" />
              )}
            </SimpleGrid>
          )}

          {summary.attempts && (
            <Box data-testid="attempts-section">
              <Heading size="sm" mb="3">
                Attempts
              </Heading>

              {summary.attempts.inProgress && (
                <Box
                  borderWidth="1px"
                  borderRadius="md"
                  p="4"
                  mb="4"
                  bg="blue.subtle"
                  data-testid="continue-attempt-card"
                >
                  <Text fontSize="sm" color="gray.700" mb="2">
                    Continue where you left off
                  </Text>
                  <HStack justify="space-between">
                    <Text fontWeight="medium">{summary.attempts.inProgress.examTypeName}</Text>
                    <Link href={`/attempts/${summary.attempts.inProgress.attemptId}`}>
                      <Button size="sm" colorPalette="brand">
                        Resume
                      </Button>
                    </Link>
                  </HStack>
                </Box>
              )}

              {summary.attempts.recent.length === 0 ? (
                <Text fontSize="sm" color="gray.500" data-testid="attempts-empty">
                  No completed attempts yet.
                </Text>
              ) : (
                <VStack align="stretch" gap="2">
                  {summary.attempts.recent.map((attempt) => (
                    <HStack
                      key={attempt.attemptId}
                      justify="space-between"
                      borderWidth="1px"
                      borderRadius="md"
                      px="3"
                      py="2"
                      data-testid={`recent-attempt-${attempt.attemptId}`}
                    >
                      <VStack align="start" gap="0">
                        <Text fontWeight="medium">{attempt.examTypeName}</Text>
                        <Text fontSize="xs" color="gray.500">
                          {attempt.startTime ? formatDate(attempt.startTime) : ''}
                        </Text>
                      </VStack>
                      <HStack gap="3">
                        {attempt.scorePercent !== null && <Text fontSize="sm">{attempt.scorePercent}%</Text>}
                        <Badge colorPalette={ATTEMPT_STATUS_PALETTE[attempt.status]} variant="subtle">
                          {ATTEMPT_STATUS_LABEL[attempt.status]}
                        </Badge>
                      </HStack>
                    </HStack>
                  ))}
                </VStack>
              )}
              <Link href="/attempts">
                <Text fontSize="sm" color="brand.fg" mt="2">
                  View all attempts →
                </Text>
              </Link>
            </Box>
          )}

          {summary.practice && (
            <Box data-testid="practice-section">
              <Heading size="sm" mb="3">
                Recent practice
              </Heading>
              {summary.practice.recent.length === 0 ? (
                <Text fontSize="sm" color="gray.500" data-testid="practice-empty">
                  No practice sessions yet.
                </Text>
              ) : (
                <VStack align="stretch" gap="2">
                  {summary.practice.recent.map((session) => (
                    <HStack
                      key={session.id}
                      justify="space-between"
                      borderWidth="1px"
                      borderRadius="md"
                      px="3"
                      py="2"
                      data-testid={`recent-practice-${session.id}`}
                    >
                      <VStack align="start" gap="0">
                        <Text fontWeight="medium">{PRACTICE_KIND_LABEL[session.kind]}</Text>
                        <Text fontSize="xs" color="gray.500">
                          {formatDate(session.createdAt)} · {session.requestedCount} questions
                        </Text>
                      </VStack>
                      <Badge colorPalette={session.status === 'Failed' ? 'red' : 'green'} variant="subtle">
                        {session.status}
                      </Badge>
                    </HStack>
                  ))}
                </VStack>
              )}
              <Link href="/practice">
                <Text fontSize="sm" color="brand.fg" mt="2">
                  Go to Practice →
                </Text>
              </Link>
            </Box>
          )}
        </VStack>
      )}
    </Box>
  );
}
