'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Field, Heading, Input, NativeSelect, Stack, Text, Textarea } from '@chakra-ui/react';
import * as taxonomyApi from '@/lib/tenant-console/taxonomy-api';
import * as curriculaApi from '@/lib/tenant-console/curricula-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';
import { toaster } from '@/components/ui/toaster';

/**
 * Curriculum create (`docs/design/UX_GUIDELINES.md` §10.2/§19) — Name/Description + a three-level
 * cascading Subject select (Education Level → Stage → Subject), since `Curriculum.subjectId` points
 * one level deeper into the taxonomy than a single-level picker would. Each select is visible-but-
 * disabled until its parent is chosen (a required sequential dependency, not a permission gate — §10.2's
 * own reasoning), clearing any previously-selected child when a parent changes. Gated by
 * `curricula.manage_own`, same route-level defense-in-depth pattern as the list page.
 */
export default function CreateCurriculumPage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('curricula.manage_own')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Create Curriculum
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <CreateCurriculumFormAuthorized />;
}

function CreateCurriculumFormAuthorized() {
  const router = useRouter();

  const [educationLevels, setEducationLevels] = useState<taxonomyApi.EducationLevelSummary[]>([]);
  const [stages, setStages] = useState<taxonomyApi.StageSummary[]>([]);
  const [subjects, setSubjects] = useState<taxonomyApi.SubjectSummary[]>([]);

  const [educationLevelId, setEducationLevelId] = useState('');
  const [stageId, setStageId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  useEffect(() => {
    taxonomyApi.listEducationLevels().then(setEducationLevels).catch(() => setBannerMessage('Something went wrong loading the taxonomy.'));
  }, []);

  useEffect(() => {
    setStageId('');
    setSubjectId('');
    setStages([]);
    if (!educationLevelId) return;
    taxonomyApi.listStages(Number(educationLevelId)).then(setStages).catch(() => setBannerMessage('Something went wrong loading stages.'));
  }, [educationLevelId]);

  useEffect(() => {
    setSubjectId('');
    setSubjects([]);
    if (!stageId) return;
    taxonomyApi.listSubjects(Number(stageId)).then(setSubjects).catch(() => setBannerMessage('Something went wrong loading subjects.'));
  }, [stageId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBannerMessage(null);
    if (!name.trim() || !subjectId) return;

    setSubmitting(true);
    try {
      const created = await curriculaApi.createCurriculum({
        name: name.trim(),
        description: description.trim() || undefined,
        subjectId: Number(subjectId),
      });
      toaster.create({ title: `Curriculum '${created.name}' created.`, type: 'success' });
      router.replace(`/curricula/${created.id}`);
    } catch (error) {
      setBannerMessage(
        isTenantApiError(error) ? error.message : 'Something went wrong while creating this Curriculum. Please try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <Box maxW="600px">
      <Heading size="md" mb="4">
        Create Curriculum
      </Heading>

      {bannerMessage && (
        <Box role="alert" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm" mb="4">
          {bannerMessage}
        </Box>
      )}

      <Box as="form" onSubmit={handleSubmit}>
        <Stack gap="4">
          <Field.Root required>
            <Field.Label>Name</Field.Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          </Field.Root>

          <Field.Root>
            <Field.Label>Description</Field.Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={submitting} />
          </Field.Root>

          <Stack direction={{ base: 'column', md: 'row' }} gap="3">
            <Field.Root required>
              <Field.Label>Education Level</Field.Label>
              <NativeSelect.Root disabled={submitting}>
                <NativeSelect.Field value={educationLevelId} onChange={(e) => setEducationLevelId(e.target.value)}>
                  <option value="">Select…</option>
                  {educationLevels.map((lvl) => (
                    <option key={lvl.id} value={lvl.id}>
                      {lvl.name}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root required disabled={!educationLevelId}>
              <Field.Label>Stage</Field.Label>
              <NativeSelect.Root disabled={submitting || !educationLevelId}>
                <NativeSelect.Field value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  <option value="">{educationLevelId ? 'Select…' : 'Select an Education Level first'}</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root required disabled={!stageId}>
              <Field.Label>Subject</Field.Label>
              <NativeSelect.Root disabled={submitting || !stageId}>
                <NativeSelect.Field value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">{stageId ? 'Select…' : 'Select a Stage first'}</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
          </Stack>

          <Stack direction="row" gap="3">
            <Button type="submit" colorPalette="brand" loading={submitting} loadingText="Creating…" disabled={!name.trim() || !subjectId}>
              Create Curriculum
            </Button>
            <Link href="/curricula">
              <Button variant="ghost" disabled={submitting}>
                Cancel
              </Button>
            </Link>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
