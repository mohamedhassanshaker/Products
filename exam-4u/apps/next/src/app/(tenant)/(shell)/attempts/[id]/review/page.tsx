'use client';

import { use, useEffect, useState } from 'react';
import { Badge, Box, Button, Heading, HStack, Stack, Text } from '@chakra-ui/react';
import * as attemptsApi from '@/lib/tenant-console/attempts-api';

/** FR-TAKE-8's review screen — wrong-only/all toggle, ordering always by original question position
 * regardless of filter (the server's own contract, this screen simply renders whatever it returns). */
export default function AttemptReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AttemptReviewScreen attemptId={id} />;
}

function AttemptReviewScreen({ attemptId }: { attemptId: string }) {
  const [filter, setFilter] = useState<'all' | 'wrong'>('all');
  const [review, setReview] = useState<attemptsApi.AttemptReview | null>(null);
  const [error, setError] = useState(false);

  function load(f: 'all' | 'wrong') {
    setError(false);
    attemptsApi
      .getReview(attemptId, f)
      .then(setReview)
      .catch(() => setError(true));
  }

  useEffect(() => {
    load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, filter]);

  return (
    <Box maxW="700px">
      <HStack justify="space-between" mb="4">
        <Heading size="md">Review</Heading>
        <HStack gap="2">
          <Button size="sm" variant={filter === 'all' ? 'solid' : 'outline'} onClick={() => setFilter('all')}>
            All
          </Button>
          <Button size="sm" variant={filter === 'wrong' ? 'solid' : 'outline'} onClick={() => setFilter('wrong')}>
            Wrong only
          </Button>
        </HStack>
      </HStack>

      {error ? (
        <Text color="red.fg">Could not load the review. Try again.</Text>
      ) : !review ? (
        <Stack gap="2">
          {[1, 2, 3].map((i) => (
            <Box key={i} h="16" bg="gray.100" borderRadius="md" />
          ))}
        </Stack>
      ) : review.items.length === 0 ? (
        <Text color="gray.600">{filter === 'wrong' ? 'No incorrect answers — nice work!' : 'No questions to review.'}</Text>
      ) : (
        <Stack gap="4" data-testid="review-items">
          {review.items.map((item) => (
            <Box key={item.questionIndex} borderWidth="1px" borderRadius="md" p="4">
              <HStack justify="space-between" mb="2">
                <Text fontWeight="medium">
                  Q{item.questionIndex + 1}. {item.questionText}
                </Text>
                {item.isCorrect === true && <Badge colorPalette="green">Correct</Badge>}
                {item.isCorrect === false && <Badge colorPalette="red">Incorrect</Badge>}
                {item.isCorrect === null && <Badge colorPalette="gray">Not answered</Badge>}
              </HStack>
              <Stack gap="1" mb="2">
                {Object.entries(item.options).map(([key, label]) => (
                  <Text key={key} fontSize="sm" color={key === item.correctAnswer ? 'green.fg' : key === item.selectedOption ? 'red.fg' : 'gray.700'}>
                    {key}. {label}
                    {key === item.correctAnswer ? ' (correct answer)' : ''}
                    {key === item.selectedOption && key !== item.correctAnswer ? ' (your answer)' : ''}
                  </Text>
                ))}
              </Stack>
              {item.explanation && (
                <Text fontSize="sm" color="gray.600">
                  {item.explanation}
                </Text>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
