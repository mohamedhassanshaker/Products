'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Button, Heading, Input, Stack, Table, Text } from '@chakra-ui/react';
import * as taxonomyApi from '@/lib/tenant-console/taxonomy-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { toaster } from '@/components/ui/toaster';

/** A single row shape common to all three taxonomy levels for this panel's purposes. */
interface Row {
  id: number;
  name: string;
}

/**
 * Taxonomy browse/create/delete (`docs/design/UX_GUIDELINES.md` §6/§19 — Education Level → Stage →
 * Subject, single-panel breadcrumb drill-down, per that section's own layout decision). Gated by
 * `taxonomy.read` (route-level — a user without it sees a forbidden message, not a blank/broken
 * screen) with create/delete additionally gated per-action by `taxonomy.create`/`taxonomy.delete`
 * (§6's "omission is clearer than a perpetually-disabled control" rule).
 *
 * Drill-down state (`?levelId=&stageId=`) lives in the URL query string, giving back-button/reload/
 * deep-link support without three nested route levels — §6's own explicit reasoning.
 */
export default function TaxonomyPage() {
  return (
    <Suspense fallback={null}>
      <TaxonomyBrowser />
    </Suspense>
  );
}

/**
 * Route-level permission gate, kept as its own component (rather than an early `return` inside
 * {@link TaxonomyBrowser}) so every hook below always runs in the same order on every render — an
 * early return before a `useState`/`useEffect` call would violate the Rules of Hooks the moment
 * `hasPermission` toggles between renders (e.g. immediately after login resolves).
 */
function TaxonomyBrowser() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('taxonomy.read')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Taxonomy
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <TaxonomyBrowserAuthorized />;
}

function TaxonomyBrowserAuthorized() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = useTenantAuthContext();

  const levelIdRaw = searchParams.get('levelId');
  const stageIdRaw = searchParams.get('stageId');
  const levelId = levelIdRaw ? Number(levelIdRaw) : null;
  const stageId = stageIdRaw ? Number(stageIdRaw) : null;

  const canCreate = hasPermission('taxonomy.create');
  const canDelete = hasPermission('taxonomy.delete');

  const [educationLevels, setEducationLevels] = useState<Row[] | null>(null);
  const [stages, setStages] = useState<Row[] | null>(null);
  const [subjects, setSubjects] = useState<Row[] | null>(null);
  const [levelsError, setLevelsError] = useState(false);
  const [childError, setChildError] = useState(false);
  const [parentGone, setParentGone] = useState(false);

  const loadEducationLevels = useCallback(() => {
    setLevelsError(false);
    taxonomyApi
      .listEducationLevels()
      .then(setEducationLevels)
      .catch(() => setLevelsError(true));
  }, []);

  useEffect(() => {
    loadEducationLevels();
  }, [loadEducationLevels]);

  const loadStages = useCallback(() => {
    if (levelId === null) {
      setStages(null);
      return;
    }
    setChildError(false);
    setParentGone(false);
    taxonomyApi
      .listStages(levelId)
      .then(setStages)
      .catch((err) => {
        if (isTenantApiError(err) && err.code === 'TAXONOMY_ENTRY_NOT_FOUND') setParentGone(true);
        else setChildError(true);
      });
  }, [levelId]);

  useEffect(() => {
    loadStages();
  }, [loadStages]);

  const loadSubjects = useCallback(() => {
    if (stageId === null) {
      setSubjects(null);
      return;
    }
    setChildError(false);
    setParentGone(false);
    taxonomyApi
      .listSubjects(stageId)
      .then(setSubjects)
      .catch((err) => {
        if (isTenantApiError(err) && err.code === 'TAXONOMY_ENTRY_NOT_FOUND') setParentGone(true);
        else setChildError(true);
      });
  }, [stageId]);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  const currentLevel = educationLevels?.find((l) => l.id === levelId) ?? null;
  const currentStage = stages?.find((s) => s.id === stageId) ?? null;

  function goToRoot() {
    router.push('/settings/taxonomy');
  }
  function goToLevel(id: number) {
    router.push(`/settings/taxonomy?levelId=${id}`);
  }
  function goToStage(id: number) {
    router.push(`/settings/taxonomy?levelId=${levelId}&stageId=${id}`);
  }

  const depth: 'levels' | 'stages' | 'subjects' = stageId !== null ? 'subjects' : levelId !== null ? 'stages' : 'levels';

  return (
    <Box maxW="720px">
      <Heading size="md" mb="4">
        Taxonomy
      </Heading>

      <Box as="nav" aria-label="Taxonomy breadcrumb" mb="4">
        <Text fontSize="sm" color="gray.600">
          {levelId === null ? (
            <Text as="span" aria-current="page" fontWeight="medium" color="gray.900">
              All education levels
            </Text>
          ) : (
            <Text as="span" color="brand.fg" cursor="pointer" onClick={goToRoot}>
              All education levels
            </Text>
          )}
          {levelId !== null && (
            <>
              {' › '}
              {stageId === null ? (
                <Text as="span" aria-current="page" fontWeight="medium" color="gray.900">
                  {currentLevel?.name ?? '…'}
                </Text>
              ) : (
                <Text as="span" color="brand.fg" cursor="pointer" onClick={() => goToLevel(levelId)}>
                  {currentLevel?.name ?? '…'}
                </Text>
              )}
            </>
          )}
          {stageId !== null && (
            <>
              {' › '}
              <Text as="span" aria-current="page" fontWeight="medium" color="gray.900">
                {currentStage?.name ?? '…'}
              </Text>
            </>
          )}
        </Text>
      </Box>

      {parentGone && (
        <Box mb="4">
          <Text mb="2">
            {depth === 'subjects'
              ? "This stage no longer exists. It may have been deleted."
              : 'This education level no longer exists. It may have been deleted.'}
          </Text>
          <Button variant="outline" onClick={goToRoot}>
            Back to Education Levels
          </Button>
        </Box>
      )}

      {!parentGone && depth === 'levels' && (
        <TaxonomyLevelPanel
          rows={educationLevels}
          error={levelsError}
          onRetry={loadEducationLevels}
          emptyMessage="No education levels yet. Add one to get started."
          placeholder="Add education level…"
          canCreate={canCreate}
          canDelete={canDelete}
          drillable
          onRowClick={(row) => goToLevel(row.id)}
          onCreate={async (name) => {
            await taxonomyApi.createEducationLevel(name);
            loadEducationLevels();
          }}
          onDelete={async (row) => {
            await taxonomyApi.deleteEducationLevel(row.id);
            loadEducationLevels();
          }}
        />
      )}

      {!parentGone && depth === 'stages' && (
        <TaxonomyLevelPanel
          rows={stages}
          error={childError}
          onRetry={loadStages}
          emptyMessage={`No stages under '${currentLevel?.name ?? ''}' yet. Add one below.`}
          placeholder="Add stage…"
          canCreate={canCreate}
          canDelete={canDelete}
          drillable
          onRowClick={(row) => goToStage(row.id)}
          onCreate={async (name) => {
            await taxonomyApi.createStage(levelId as number, name);
            loadStages();
          }}
          onDelete={async (row) => {
            await taxonomyApi.deleteStage(row.id);
            loadStages();
          }}
        />
      )}

      {!parentGone && depth === 'subjects' && (
        <TaxonomyLevelPanel
          rows={subjects}
          error={childError}
          onRetry={loadSubjects}
          emptyMessage={`No subjects under '${currentStage?.name ?? ''}' yet. Add one below.`}
          placeholder="Add subject…"
          canCreate={canCreate}
          canDelete={canDelete}
          drillable={false}
          onCreate={async (name) => {
            await taxonomyApi.createSubject(stageId as number, name);
            loadSubjects();
          }}
          onDelete={async (row) => {
            await taxonomyApi.deleteSubject(row.id);
            loadSubjects();
          }}
        />
      )}
    </Box>
  );
}

function TaxonomyLevelPanel({
  rows,
  error,
  onRetry,
  emptyMessage,
  placeholder,
  canCreate,
  canDelete,
  drillable,
  onRowClick,
  onCreate,
  onDelete,
}: {
  rows: Row[] | null;
  error: boolean;
  onRetry: () => void;
  emptyMessage: string;
  placeholder: string;
  canCreate: boolean;
  canDelete: boolean;
  drillable: boolean;
  onRowClick?: (row: Row) => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (row: Row) => Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (trimmed.length < 2 || trimmed.length > 150) {
      setCreateError('Enter a name between 2 and 150 characters.');
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      await onCreate(trimmed);
      setNewName('');
      toaster.create({ title: 'Added.', type: 'success' });
    } catch (err) {
      if (isTenantApiError(err) && err.code === 'INVALID_NAME') {
        setCreateError('Enter a name between 2 and 150 characters.');
      } else if (isTenantApiError(err) && err.code === 'TAXONOMY_ENTRY_NOT_FOUND') {
        setCreateError('The parent no longer exists. Refresh and try again.');
      } else {
        setCreateError('Something went wrong. Please try again.');
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(pendingDelete);
      setPendingDelete(null);
      toaster.create({ title: 'Deleted.', type: 'success' });
    } catch (err) {
      if (isTenantApiError(err) && err.code === 'TAXONOMY_ENTRY_IN_USE') {
        setDeleteError("This entry is in use and can't be deleted. Remove or reassign whatever references it first, then try again.");
      } else if (isTenantApiError(err) && err.code === 'TAXONOMY_ENTRY_NOT_FOUND') {
        setPendingDelete(null);
        toaster.create({ title: 'This entry was already removed.', type: 'info' });
        onRetry();
      } else {
        setDeleteError('Something went wrong. Please try again.');
      }
    } finally {
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <Box>
        <Text mb="2">We couldn&apos;t load this list. Try again.</Text>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Stack gap="4">
      {rows === null ? (
        <Stack gap="2">
          {[1, 2, 3].map((i) => (
            <Box key={i} h="10" bg="gray.100" borderRadius="md" />
          ))}
        </Stack>
      ) : rows.length === 0 ? (
        <Text color="gray.600">{emptyMessage}</Text>
      ) : (
        <Table.Root>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.id}>
                <Table.Cell>
                  {drillable ? (
                    <Text as="span" color="brand.fg" cursor="pointer" onClick={() => onRowClick?.(row)}>
                      {row.name} {'>'}
                    </Text>
                  ) : (
                    row.name
                  )}
                </Table.Cell>
                <Table.Cell textAlign="right">
                  {canDelete && (
                    <Button size="xs" variant="ghost" colorPalette="red" onClick={() => setPendingDelete(row)}>
                      Delete
                    </Button>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {canCreate && (
        <Box as="form" onSubmit={handleCreate}>
          <Stack direction="row" gap="2">
            <Input placeholder={placeholder} value={newName} onChange={(e) => setNewName(e.target.value)} disabled={creating} />
            <Button type="submit" colorPalette="brand" loading={creating}>
              Add
            </Button>
          </Stack>
          {createError && (
            <Text color="red.fg" fontSize="sm" mt="1">
              {createError}
            </Text>
          )}
        </Box>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete entry"
        message={`Delete '${pendingDelete?.name ?? ''}'? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
      />
      {deleteError && (
        <Text color="red.fg" fontSize="sm">
          {deleteError}
        </Text>
      )}
    </Stack>
  );
}
