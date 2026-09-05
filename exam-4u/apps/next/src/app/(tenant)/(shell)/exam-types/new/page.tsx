'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Field, Heading, IconButton, Input, NativeSelect, Stack, Text, Textarea } from '@chakra-ui/react';
import * as examTypesApi from '@/lib/tenant-console/exam-types-api';
import * as taxonomyApi from '@/lib/tenant-console/taxonomy-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';
import { toaster } from '@/components/ui/toaster';

interface ModuleRow {
  name: string;
  questionCount: string;
}

/**
 * Manual (ZIP) Exam Type creation screen (`docs/design/UX_GUIDELINES.md` §20.2, `/exam-types/new`) —
 * ported flow from legacy's `ExamTypeCreateComponent`: Name/Description, a two-step cascading
 * Education Level -> Stage select (no flat "every stage" endpoint exists, matching legacy's own
 * judgment call), a dynamically-growing Module repeater (name + target question count), and a ZIP
 * file drop zone. Gated by `exams.create`.
 */
export default function CreateExamTypePage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('exams.create')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Create Exam Type
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <CreateExamTypeFormAuthorized />;
}

function CreateExamTypeFormAuthorized() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [educationLevels, setEducationLevels] = useState<taxonomyApi.EducationLevelSummary[]>([]);
  const [stages, setStages] = useState<taxonomyApi.StageSummary[]>([]);
  const [educationLevelId, setEducationLevelId] = useState('');
  const [stageId, setStageId] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [totalQuestions, setTotalQuestions] = useState('');
  const [totalMinutes, setTotalMinutes] = useState('');
  const [modules, setModules] = useState<ModuleRow[]>([{ name: '', questionCount: '' }]);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [nameServerError, setNameServerError] = useState<string | null>(null);

  useEffect(() => {
    taxonomyApi.listEducationLevels().then(setEducationLevels).catch(() => undefined);
  }, []);

  useEffect(() => {
    setStageId('');
    setStages([]);
    if (!educationLevelId) return;
    taxonomyApi.listStages(Number(educationLevelId)).then(setStages).catch(() => undefined);
  }, [educationLevelId]);

  function addModuleRow() {
    setModules((rows) => [...rows, { name: '', questionCount: '' }]);
  }

  function removeModuleRow(index: number) {
    setModules((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
  }

  function updateModuleRow(index: number, patch: Partial<ModuleRow>) {
    setModules((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function setFileFromInput(candidate: File | undefined) {
    if (!candidate) return;
    setFileError(null);
    setFile(candidate);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    setFileFromInput(e.dataTransfer.files?.[0]);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFileFromInput(e.target.files?.[0]);
  }

  /** Pure-arithmetic pre-check on already-entered fields, cheap and safe to run before the upload
   * starts — catches the common `QUESTION_COUNT_MISMATCH` case client-side. Everything ZIP-content-
   * related is deliberately left to the server. */
  function declaredModulesSumMismatch(): number | null {
    const total = Number(totalQuestions);
    if (!Number.isFinite(total)) return null;
    const sum = modules.reduce((acc, m) => acc + (Number(m.questionCount) || 0), 0);
    return sum !== total ? sum : null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setBannerMessage(null);
    setNameServerError(null);
    setFileError(null);

    const modulesValid = modules.every((m) => m.name.trim().length > 0 && Number(m.questionCount) >= 1);
    const formValid =
      name.trim().length > 0 &&
      stageId !== '' &&
      Number(totalQuestions) >= 1 &&
      Number(totalMinutes) >= 1 &&
      modulesValid;

    if (!file) {
      setFileError('Choose a ZIP file to upload.');
    }
    if (!formValid || !file || uploading) {
      return;
    }

    const mismatchSum = declaredModulesSumMismatch();
    if (mismatchSum !== null) {
      setBannerMessage(
        `The total questions you entered (${totalQuestions}) doesn't match the number of questions found across your modules (${mismatchSum}). Update the Total questions field or your modules, then try again.`,
      );
      return;
    }

    setUploading(true);
    try {
      const created = await examTypesApi.createExamTypeFromZip(
        {
          name: name.trim(),
          description: description.trim() || undefined,
          totalQuestions: Number(totalQuestions),
          totalMinutes: Number(totalMinutes),
          stageId: Number(stageId),
          modules: modules.map((m) => ({ name: m.name.trim(), questionCount: Number(m.questionCount) })),
        },
        file,
      );
      toaster.create({ title: `Exam Type '${created.name}' created.`, type: 'success' });
      router.replace(`/exam-types/${created.id}`);
    } catch (err) {
      setUploading(false);
      handleUploadError(err);
    }
  }

  /** Per-code error copy — ported from legacy's `ExamTypeCreateComponent.handleUploadError`. The form
   * re-enables and every previously-entered value (including the selected file) remains exactly as it
   * was — never cleared on error. */
  function handleUploadError(err: unknown) {
    if (!isTenantApiError(err)) {
      setBannerMessage('Something went wrong while uploading this Exam Type. Please try again.');
      return;
    }
    switch (err.code) {
      case 'EXAM_TYPE_NAME_EXISTS':
        setNameServerError(`An Exam Type named '${name}' already exists. Choose a different name.`);
        return;
      case 'FILE_TOO_LARGE':
        setFileError('This ZIP file is too large. Choose a smaller file.');
        return;
      case 'INVALID_ZIP_STRUCTURE':
        setBannerMessage(
          "This ZIP file's structure doesn't match the modules you've defined. Each module name must have a matching top-level folder in the ZIP, and every top-level folder must correspond to a declared module. Check the folder names and try again.",
        );
        return;
      case 'INVALID_QUESTION_FILE': {
        const fileName = (err.details?.file as string | undefined) ?? 'unknown file';
        const field = (err.details?.field as string | undefined) ?? 'a required field';
        setBannerMessage(`The question file '${fileName}' is missing or has an invalid '${field}' value. Fix this file in your ZIP and re-upload.`);
        return;
      }
      case 'EMPTY_MODULE': {
        const moduleName = (err.details?.module as string | undefined) ?? 'a module';
        setBannerMessage(`The module '${moduleName}' has no valid questions in the ZIP. Add at least one valid question file to its folder and try again.`);
        return;
      }
      case 'QUESTION_COUNT_MISMATCH': {
        const moduleName = err.details?.module as string | undefined;
        if (moduleName !== undefined) {
          const declaredCount = err.details?.declaredCount as number;
          const actualCount = err.details?.actualCount as number;
          setBannerMessage(
            `The module '${moduleName}' declares ${pluralizeQuestions(declaredCount)}, but the ZIP contains ${pluralizeQuestions(actualCount)} for it. Update that module's question count or fix your ZIP, then try again.`,
          );
        } else {
          const declaredTotal = (err.details?.declaredTotal as number | undefined) ?? Number(totalQuestions);
          const actualTotal = (err.details?.sumOfModules as number | undefined) ?? 0;
          setBannerMessage(
            `The total questions you entered (${declaredTotal}) doesn't match the number of questions found across your modules (${actualTotal}). Update the Total questions field or your modules, then try again.`,
          );
        }
        return;
      }
      default:
        setBannerMessage(err.message || 'Something went wrong while uploading this Exam Type. Please try again.');
    }
  }

  return (
    <Box maxW="700px">
      <Heading size="md" mb="4">
        Create Exam Type
      </Heading>

      {bannerMessage && (
        <Box role="alert" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm" mb="4" tabIndex={-1}>
          {bannerMessage}
        </Box>
      )}

      <Box as="form" onSubmit={handleSubmit}>
        <Stack gap="4">
          <fieldset disabled={uploading} style={{ border: 'none', padding: 0, margin: 0 }}>
            <Stack gap="4">
              <Field.Root required invalid={submitted && name.trim().length === 0}>
                <Field.Label>Name</Field.Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
                {nameServerError ? (
                  <Field.ErrorText>{nameServerError}</Field.ErrorText>
                ) : submitted && name.trim().length === 0 ? (
                  <Field.ErrorText>Name is required.</Field.ErrorText>
                ) : null}
              </Field.Root>

              <Field.Root>
                <Field.Label>Description</Field.Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </Field.Root>

              <Stack direction={{ base: 'column', md: 'row' }} gap="3">
                <Field.Root>
                  <Field.Label>Education Level</Field.Label>
                  <NativeSelect.Root>
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

                <Field.Root required invalid={submitted && stageId === ''} disabled={!educationLevelId}>
                  <Field.Label>Stage</Field.Label>
                  <NativeSelect.Root disabled={!educationLevelId}>
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
                  {submitted && stageId === '' && <Field.ErrorText>Stage is required.</Field.ErrorText>}
                </Field.Root>
              </Stack>

              <Stack direction={{ base: 'column', md: 'row' }} gap="3">
                <Field.Root required invalid={submitted && Number(totalQuestions) < 1}>
                  <Field.Label>Total questions</Field.Label>
                  <Input type="number" min={1} value={totalQuestions} onChange={(e) => setTotalQuestions(e.target.value)} />
                  {submitted && Number(totalQuestions) < 1 && <Field.ErrorText>Enter a total question count of at least 1.</Field.ErrorText>}
                </Field.Root>

                <Field.Root required invalid={submitted && Number(totalMinutes) < 1}>
                  <Field.Label>Total minutes</Field.Label>
                  <Input type="number" min={1} value={totalMinutes} onChange={(e) => setTotalMinutes(e.target.value)} />
                  {submitted && Number(totalMinutes) < 1 && <Field.ErrorText>Enter a total duration of at least 1 minute.</Field.ErrorText>}
                </Field.Root>
              </Stack>

              <Box>
                <Text fontWeight="semibold" mb="2">
                  Modules
                </Text>
                <Stack gap="2">
                  {modules.map((row, i) => (
                    <Stack key={i} direction="row" gap="2" align="flex-start">
                      <Field.Root required invalid={submitted && row.name.trim().length === 0} flex="2">
                        <Input
                          placeholder="Module name"
                          data-testid={`module-name-${i}`}
                          value={row.name}
                          onChange={(e) => updateModuleRow(i, { name: e.target.value })}
                        />
                      </Field.Root>
                      <Field.Root required invalid={submitted && Number(row.questionCount) < 1} flex="1">
                        <Input
                          type="number"
                          min={1}
                          placeholder="Question count"
                          data-testid={`module-count-${i}`}
                          value={row.questionCount}
                          onChange={(e) => updateModuleRow(i, { questionCount: e.target.value })}
                        />
                      </Field.Root>
                      <IconButton
                        aria-label="Remove module"
                        variant="ghost"
                        disabled={modules.length <= 1}
                        onClick={() => removeModuleRow(i)}
                      >
                        ×
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
                <Button variant="outline" size="sm" mt="2" type="button" onClick={addModuleRow} data-testid="add-module">
                  + Add module
                </Button>
              </Box>

              <Box>
                <Text fontWeight="semibold" mb="2">
                  Exam Type ZIP file
                </Text>
                <Box
                  borderWidth="2px"
                  borderStyle="dashed"
                  borderColor={isDragging ? 'brand.500' : 'gray.300'}
                  borderRadius="md"
                  p="6"
                  textAlign="center"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    onChange={handleFileChange}
                    data-testid="zip-file-input"
                  />
                  {file ? (
                    <Stack direction="row" justify="center" align="center" gap="2" mt="2">
                      <Text>
                        {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                      </Text>
                      <Button size="sm" variant="ghost" type="button" onClick={() => setFile(null)}>
                        Change file
                      </Button>
                    </Stack>
                  ) : (
                    <Text color="gray.600" mt="2">
                      Drag and drop a ZIP file here, or use the field above to browse.
                    </Text>
                  )}
                </Box>
                {fileError && (
                  <Text color="red.fg" fontSize="sm" mt="1">
                    {fileError}
                  </Text>
                )}
              </Box>
            </Stack>
          </fieldset>

          <Stack direction="row" gap="3">
            <Button type="submit" colorPalette="brand" loading={uploading} loadingText="Uploading…">
              Create Exam Type
            </Button>
            <Link href="/exam-types">
              <Button variant="ghost" disabled={uploading}>
                Cancel
              </Button>
            </Link>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}

function pluralizeQuestions(count: number): string {
  return `${count} question${count === 1 ? '' : 's'}`;
}
