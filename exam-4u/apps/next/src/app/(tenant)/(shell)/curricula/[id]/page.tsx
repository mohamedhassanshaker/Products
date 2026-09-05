'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Field, Heading, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import * as curriculaApi from '@/lib/tenant-console/curricula-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { toaster } from '@/components/ui/toaster';

type LoadState = 'loading' | 'not-found' | 'error' | 'ready';

/**
 * Curriculum detail/edit (`docs/design/UX_GUIDELINES.md` §10.3/§19 — ownership/metadata scope only
 * this phase; the document-upload/list/search sub-sections §10.3a-c describe are deliberately not
 * built yet, see `docs/plans/nextjs-rewrite-phase3-plan.md`). Not-found and not-owned are rendered
 * identically (per FR-CUR-1a — the UI must never leak which of the two actually occurred).
 */
export default function CurriculumDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [state, setState] = useState<LoadState>('loading');
  const [curriculum, setCurriculum] = useState<curriculaApi.CurriculumSummary | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    curriculaApi
      .getCurriculum(id)
      .then((row) => {
        setCurriculum(row);
        setName(row.name);
        setDescription(row.description ?? '');
        setState('ready');
      })
      .catch((err) => {
        // FORBIDDEN (the acting user holds no curricula.manage_own permission at all, so
        // requirePermission rejects before CurriculaService ever runs) is folded into the same
        // "not-found" treatment as CURRICULUM_NOT_FOUND/NOT_CURRICULUM_OWNER — a direct-URL visit by a
        // user with no capacity to be here at all should look identical to one who simply isn't the
        // owner, never revealing which condition applies (defense in depth beyond the nav-level gate).
        if (isTenantApiError(err) && (err.code === 'CURRICULUM_NOT_FOUND' || err.code === 'NOT_CURRICULUM_OWNER' || err.code === 'FORBIDDEN')) {
          setState('not-found');
        } else {
          setState('error');
        }
      });
  }, [id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await curriculaApi.updateCurriculum(id, { name: name.trim(), description: description.trim() });
      setCurriculum(updated);
      toaster.create({ title: 'Curriculum saved.', type: 'success' });
    } catch (err) {
      setSaveError(isTenantApiError(err) ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await curriculaApi.deleteCurriculum(id);
      toaster.create({ title: 'Curriculum deleted.', type: 'success' });
      router.replace('/curricula');
    } catch {
      toaster.create({ title: 'Something went wrong. Please try again.', type: 'error' });
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  if (state === 'loading') {
    return (
      <Box maxW="600px">
        <Box h="8" bg="gray.100" borderRadius="md" mb="4" w="240px" />
        <Box h="40" bg="gray.100" borderRadius="md" />
      </Box>
    );
  }

  if (state === 'not-found') {
    return (
      <Box maxW="600px">
        <Text mb="4">This Curriculum doesn&apos;t exist or you don&apos;t have access to it.</Text>
        <Link href="/curricula">
          <Text as="span" color="brand.fg">
            ← Back to Curricula
          </Text>
        </Link>
      </Box>
    );
  }

  if (state === 'error' || !curriculum) {
    return (
      <Box maxW="600px">
        <Text>We couldn&apos;t load this Curriculum. Try again.</Text>
      </Box>
    );
  }

  return (
    <Box maxW="600px">
      <Link href="/curricula">
        <Text as="span" color="brand.fg" display="inline-block" mb="4">
          ← Back to Curricula
        </Text>
      </Link>

      <Stack direction="row" justify="space-between" align="center" mb="4">
        <Heading size="md">{curriculum.name}</Heading>
        <Button variant="outline" colorPalette="red" onClick={() => setConfirmOpen(true)}>
          Delete Curriculum
        </Button>
      </Stack>

      <Box as="form" onSubmit={handleSave} mb="8">
        <Stack gap="4">
          {saveError && (
            <Box role="alert" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {saveError}
            </Box>
          )}
          <Field.Root required>
            <Field.Label>Name</Field.Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </Field.Root>
          <Field.Root>
            <Field.Label>Description</Field.Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} />
          </Field.Root>
          <Button type="submit" colorPalette="brand" alignSelf="flex-start" loading={saving} loadingText="Saving…">
            Save
          </Button>
        </Stack>
      </Box>

      <Text color="gray.500" fontSize="sm">
        Document upload and semantic search for this Curriculum are not available yet — they land in a
        later phase of this migration, once the underlying AI/vector infrastructure exists.
      </Text>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Curriculum"
        message={`Delete '${curriculum.name}'? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </Box>
  );
}
