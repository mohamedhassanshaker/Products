'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Button, Heading, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import * as attemptsApi from '@/lib/tenant-console/attempts-api';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

/**
 * FR-TAKE-1's exam discovery list (`docs/design/UX_GUIDELINES.md` §12) — gated by `attempts.take`.
 *
 * **Route-naming decision (this dispatch's own judgment call, documented per the migration plan's
 * instruction)**: exam *discovery* for learners lives at `/exams`, a distinct route from `/exam-types`
 * (Phase 4's admin Exam Type management surface) even though both ultimately list `exam_type` rows —
 * the two are structurally different concepts (a Tenant Admin managing/authoring Exam Types vs. a
 * Member browsing which exams they can attempt), matching legacy's own distinct
 * `exam-discovery`/`exam-types` Angular route split, so a learner's nav item never reads like an admin
 * screen and vice versa.
 */
export default function ExamsDiscoveryPage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('attempts.take')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Exams
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }

  return <ExamsDiscoveryAuthorized />;
}

function ExamsDiscoveryAuthorized() {
  const [rows, setRows] = useState<attemptsApi.AvailableExamSummary[] | null>(null);
  const [error, setError] = useState(false);

  function load() {
    setError(false);
    attemptsApi
      .listAvailableExams()
      .then(setRows)
      .catch(() => setError(true));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Box maxW="1000px">
      <Heading size="md" mb="4">
        Exams
      </Heading>

      {error ? (
        <Box>
          <Text mb="2">We couldn&apos;t load the available exams. Try again.</Text>
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        </Box>
      ) : rows === null ? (
        <Stack gap="2">
          {[1, 2, 3].map((i) => (
            <Box key={i} h="16" bg="gray.100" borderRadius="md" />
          ))}
        </Stack>
      ) : rows.length === 0 ? (
        <Box textAlign="center" py="10">
          <Text color="gray.600">No exams are available yet. Check back later.</Text>
        </Box>
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="4" data-testid="exams-grid">
          {rows.map((row) => (
            <Box key={row.id} borderWidth="1px" borderRadius="md" p="4">
              <Heading size="sm" mb="1">
                {row.name}
              </Heading>
              {row.description && (
                <Text color="gray.600" fontSize="sm" mb="2">
                  {row.description}
                </Text>
              )}
              <Text fontSize="sm" color="gray.600" mb="3">
                {row.totalQuestions} question(s) · {row.totalMinutes} min · {row.moduleCount} module(s)
              </Text>
              <Link href={`/exams/${row.id}`}>
                <Button size="sm" colorPalette="brand">
                  View instructions
                </Button>
              </Link>
            </Box>
          ))}
        </SimpleGrid>
      )}
    </Box>
  );
}
