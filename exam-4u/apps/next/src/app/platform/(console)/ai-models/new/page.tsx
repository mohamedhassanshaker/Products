'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Box, Button, Field, Heading, Input, Stack, Text } from '@chakra-ui/react';
import { toaster } from '@/components/ui/toaster';
import { approveAiModel, isPlatformApiError } from '@/lib/platform-console';

/** Approve-AI-model screen (FR-AI-2) — a dedicated route (`/platform/ai-models/new`), matching
 * §18.1's established create-flow precedent. */
export default function ApproveAiModelPage() {
  const router = useRouter();
  const [openRouterModelId, setOpenRouterModelId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFieldError(null);
    setBannerMessage(null);
    setSubmitting(true);
    try {
      const model = await approveAiModel({ openRouterModelId, displayName });
      toaster.create({ type: 'success', title: `'${model.displayName}' approved.` });
      router.replace(`/platform/ai-models/${model.id}`);
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'INVALID_MODEL_ID') {
        setFieldError('The OpenRouter model id must look like "provider/model" (e.g. "anthropic/claude-3.5-haiku").');
      } else if (isPlatformApiError(error) && error.code === 'MODEL_ALREADY_APPROVED') {
        setFieldError('This model is already on the approved allowlist.');
      } else {
        setBannerMessage('Something went wrong while approving this model. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="6" maxW="lg">
      <Link href="/platform/ai-models">
        <Text color="brand.fg" fontWeight="medium" display="inline-block">
          ← Back to AI models
        </Text>
      </Link>
      <Heading size="lg">Approve AI model</Heading>

      <Box as="form" onSubmit={handleSubmit}>
        <Stack gap="5">
          {bannerMessage && (
            <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {bannerMessage}
            </Box>
          )}

          <Field.Root invalid={!!fieldError} required>
            <Field.Label>OpenRouter model id</Field.Label>
            <Input
              value={openRouterModelId}
              onChange={(e) => setOpenRouterModelId(e.target.value)}
              disabled={submitting}
              placeholder="anthropic/claude-3.5-haiku"
            />
            {fieldError && <Field.ErrorText>{fieldError}</Field.ErrorText>}
          </Field.Root>

          <Field.Root required>
            <Field.Label>Display name</Field.Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={submitting} placeholder="Claude 3.5 Haiku" />
          </Field.Root>

          <Stack direction="row" gap="3">
            <Button type="submit" colorPalette="brand" loading={submitting}>
              Approve model
            </Button>
            <Button variant="outline" disabled={submitting} onClick={() => router.push('/platform/ai-models')}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
