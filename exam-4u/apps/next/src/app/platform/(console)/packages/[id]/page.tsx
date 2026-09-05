'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Heading,
  HStack,
  Input,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
} from '@chakra-ui/react';
import { toaster } from '@/components/ui/toaster';
import {
  getPackage,
  isPlatformApiError,
  listFeatures,
  replacePackageFeatures,
  updatePackage,
  type FeatureSummary,
  type PackageDetail,
} from '@/lib/platform-console';

type LoadState = 'loading' | 'loaded' | 'error' | 'not-found';

/** Per-row picker state — one entry per catalog feature, `checked` mirrors "is this feature configured
 * (enabled) for this package at all", `limitText` is the free-text limit input (`''` = unlimited). */
interface PickerRow {
  feature: FeatureSummary;
  checked: boolean;
  limitText: string;
}

/**
 * Package detail screen: an edit form (key/name/description/price/status/sort order) plus the
 * feature-association picker (`docs/design/UX_GUIDELINES.md`'s new §18.6 guidance, added this
 * dispatch) — a checkbox-per-catalog-feature matrix with an optional per-feature limit, submitted as
 * one atomic `PUT .../features` replace. This app's Chakra v3 re-derivation of
 * `legacy/web/src/app/features/platform/packages/package-form/**`.
 *
 * The two sections are deliberately two independent forms with two independent Save actions (not one
 * combined submit) — editing a package's price/name is a materially different, smaller-blast-radius
 * action than replacing its entire feature configuration, and keeping them separate means a mistaken
 * click on one never silently also resubmits the other's current (possibly stale) picker state. See
 * the UX guidelines addition for the full reasoning.
 */
export default function PackageDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [state, setState] = useState<LoadState>('loading');
  const [pkg, setPkg] = useState<PackageDetail | null>(null);
  const [allFeatures, setAllFeatures] = useState<FeatureSummary[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceDollars, setPriceDollars] = useState('0.00');
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsBanner, setDetailsBanner] = useState<string | null>(null);

  const [rows, setRows] = useState<PickerRow[]>([]);
  const [savingFeatures, setSavingFeatures] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [detail, features] = await Promise.all([getPackage(id), listFeatures()]);
      setPkg(detail);
      setAllFeatures(features.items);
      setName(detail.name);
      setDescription(detail.description ?? '');
      setPriceDollars((detail.priceCents / 100).toFixed(2));
      setIsActive(detail.isActive);
      setSortOrder(String(detail.sortOrder));

      const configuredByFeatureId = new Map(detail.features.map((f) => [f.featureId, f.limit]));
      setRows(
        features.items.map((feature) => ({
          feature,
          checked: configuredByFeatureId.has(feature.id),
          limitText: configuredByFeatureId.get(feature.id)?.toString() ?? '',
        })),
      );
      setState('loaded');
    } catch (error) {
      setState(isPlatformApiError(error) && error.status === 404 ? 'not-found' : 'error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const referencedFeatureCount = useMemo(() => rows.filter((r) => r.checked).length, [rows]);

  async function handleSaveDetails(e: FormEvent) {
    e.preventDefault();
    if (savingDetails || !pkg) return;
    setDetailsBanner(null);

    const priceCents = Math.round(Number.parseFloat(priceDollars || '0') * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setDetailsBanner('Enter a valid, non-negative price.');
      return;
    }

    setSavingDetails(true);
    try {
      const updated = await updatePackage(id, {
        name,
        description,
        priceCents,
        isActive,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      });
      setPkg({ ...updated, features: pkg.features });
      toaster.create({ type: 'success', title: 'Package saved.' });
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'PACKAGE_KEY_EXISTS') {
        setDetailsBanner('A package with this key already exists.');
      } else {
        setDetailsBanner('Something went wrong while saving. Please try again.');
      }
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleSaveFeatures() {
    if (savingFeatures) return;
    setSavingFeatures(true);
    try {
      const items = rows
        .filter((r) => r.checked)
        .map((r) => ({ featureId: r.feature.id, limit: r.limitText.trim() === '' ? null : Number.parseInt(r.limitText, 10) }));
      const detail = await replacePackageFeatures(id, items);
      setPkg(detail);
      toaster.create({ type: 'success', title: 'Feature configuration saved.' });
    } catch {
      toaster.create({ type: 'error', title: 'Something went wrong while saving the feature configuration. Please try again.' });
    } finally {
      setSavingFeatures(false);
    }
  }

  const BackLink = () => (
    <Link href="/platform/packages">
      <Text color="brand.fg" fontWeight="medium" display="inline-block">
        ← Back to packages
      </Text>
    </Link>
  );

  if (state === 'loading') {
    return (
      <Stack gap="4" maxW="2xl" data-testid="package-detail-loading">
        <BackLink />
        <Skeleton height="8" width="48" />
        <Skeleton height="48" />
      </Stack>
    );
  }

  if (state === 'not-found') {
    return (
      <Stack gap="4">
        <BackLink />
        <Text>Package not found.</Text>
      </Stack>
    );
  }

  if (state === 'error' || !pkg) {
    return (
      <Stack gap="4">
        <BackLink />
        <Text>We couldn&apos;t load this package. Try again.</Text>
        <Button onClick={load} alignSelf="flex-start">
          Retry
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="8" maxW="2xl">
      <BackLink />
      <HStack justify="space-between" wrap="wrap" gap="3">
        <Heading size="lg">{pkg.name}</Heading>
        <Badge colorPalette={pkg.isActive ? 'green' : 'gray'} variant="subtle">
          {pkg.isActive ? 'Active' : 'Inactive'}
        </Badge>
      </HStack>

      <Box as="form" onSubmit={handleSaveDetails} borderWidth="1px" borderColor="gray.200" borderRadius="md" p="5">
        <Stack gap="5">
          <Heading size="md">Details</Heading>
          {detailsBanner && (
            <Box role="alert" aria-live="assertive" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm">
              {detailsBanner}
            </Box>
          )}

          <Field.Root>
            <Field.Label>Key</Field.Label>
            <Input value={pkg.key} disabled />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Name</Field.Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={savingDetails} />
          </Field.Root>

          <Field.Root>
            <Field.Label>Description</Field.Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={savingDetails} />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Price (USD/month)</Field.Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              disabled={savingDetails}
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>Sort order</Field.Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              disabled={savingDetails}
            />
          </Field.Root>

          <Checkbox.Root checked={isActive} onCheckedChange={(d) => setIsActive(!!d.checked)} disabled={savingDetails}>
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Active (offered as a new tenant assignment target)</Checkbox.Label>
          </Checkbox.Root>

          <Button type="submit" colorPalette="brand" loading={savingDetails} alignSelf="flex-start">
            Save details
          </Button>
        </Stack>
      </Box>

      <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="5">
        <Stack gap="4">
          <HStack justify="space-between" wrap="wrap">
            <Heading size="md">Feature configuration</Heading>
            <Text fontSize="sm" color="gray.600">
              {referencedFeatureCount} of {allFeatures.length} enabled
            </Text>
          </HStack>
          <Text fontSize="sm" color="gray.600">
            A feature left unchecked is disabled for this package by default — there is no separate
            &quot;disabled&quot; state to set.
          </Text>

          {allFeatures.length === 0 ? (
            <Text color="gray.600">No catalog features exist yet.</Text>
          ) : (
            <Table.Root variant="line" data-testid="package-feature-picker">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Enabled</Table.ColumnHeader>
                  <Table.ColumnHeader>Feature</Table.ColumnHeader>
                  <Table.ColumnHeader>Limit (blank = unlimited)</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((row, index) => (
                  <Table.Row key={row.feature.id}>
                    <Table.Cell>
                      <Checkbox.Root
                        checked={row.checked}
                        onCheckedChange={(d) =>
                          setRows((prev) => prev.map((r, i) => (i === index ? { ...r, checked: !!d.checked } : r)))
                        }
                        disabled={savingFeatures}
                        aria-label={`Enable ${row.feature.name} for this package`}
                      >
                        <Checkbox.HiddenInput />
                        <Checkbox.Control />
                      </Checkbox.Root>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontWeight="medium">{row.feature.name}</Text>
                      <Text fontSize="xs" color="gray.600" fontFamily="mono">
                        {row.feature.key}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        width="32"
                        placeholder="Unlimited"
                        value={row.limitText}
                        disabled={!row.checked || savingFeatures}
                        onChange={(e) =>
                          setRows((prev) => prev.map((r, i) => (i === index ? { ...r, limitText: e.target.value } : r)))
                        }
                        aria-label={`${row.feature.name} usage limit per ${row.feature.resetPeriod.toLowerCase()}`}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}

          <Button
            colorPalette="brand"
            loading={savingFeatures}
            disabled={allFeatures.length === 0}
            alignSelf="flex-start"
            onClick={handleSaveFeatures}
          >
            Save feature configuration
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
}
