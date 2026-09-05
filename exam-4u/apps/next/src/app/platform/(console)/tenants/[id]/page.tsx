'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge, Box, Button, DataList, Heading, HStack, NativeSelect, Skeleton, Stack, Text, VisuallyHidden } from '@chakra-ui/react';
import { BackToTenantsLink } from '@/components/platform/platform-shell';
import { StatusBadge } from '@/components/platform/status-badge';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { toaster } from '@/components/ui/toaster';
import {
  activateTenant,
  assignTenantAiModel,
  createTenantCheckoutSession,
  getTenant,
  getTenantBilling,
  isPlatformApiError,
  listAiModels,
  listPackages,
  reassignTenantSubscription,
  retryTenantProvisioning,
  softDeleteTenant,
  suspendTenant,
  unassignTenantAiModel,
  type ApprovedAiModelSummary,
  type PackageSummary,
  type TenantSubscriptionSummary,
  type TenantSummary,
} from '@/lib/platform-console';

type LoadState = 'loading' | 'loaded' | 'error' | 'not-found';
type ActionKind = 'suspend' | 'activate' | 'retry' | 'delete';

/**
 * Tenant detail screen (`docs/design/UX_GUIDELINES.md` §3.2) — full `TenantSummary` display plus the
 * state-changing actions (suspend/activate/retry-provisioning/soft-delete), each gated to the
 * tenant's current status.
 */
export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [state, setState] = useState<LoadState>('loading');
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [actionInFlight, setActionInFlight] = useState<ActionKind | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [confirmAction, setConfirmAction] = useState<'suspend' | 'delete' | null>(null);

  // AI model assignment panel (FR-AI-3, migration plan Phase 2 sub-slice "2b") — `aiModels` is the
  // full allowlist (enabled + disabled, so an already-assigned-but-since-disabled model still shows
  // correctly in the "currently effective" line, per `AiModelResolver`'s own "disabling must not break
  // an already-configured tenant" rule); the assignment `<select>` itself only offers enabled models
  // as a *new* target.
  const [aiModels, setAiModels] = useState<ApprovedAiModelSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [aiModelSaving, setAiModelSaving] = useState(false);

  // Billing panel (FR-PKG-6/FR-PKG-4, migration plan Phase 2 sub-slice "2c") — `activePackages` only
  // ever offers a currently-active package as a *new* reassignment/checkout target (never the
  // tenant's own current package if it has since been deactivated — that package still displays via
  // `billing.subscription`, it's just not re-selectable), matching the AI-model panel's identical
  // "never offer a disabled option as a new target" rule.
  const [billing, setBilling] = useState<TenantSubscriptionSummary | null>(null);
  const [activePackages, setActivePackages] = useState<PackageSummary[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [reassignSaving, setReassignSaving] = useState(false);
  const [checkoutStarting, setCheckoutStarting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [result, models, billingResult, packagesResult] = await Promise.all([
        getTenant(id),
        listAiModels(true),
        getTenantBilling(id),
        listPackages(true),
      ]);
      setTenant(result);
      setAiModels(models.items);
      setSelectedModelId(result.assignedAiModelId ?? '');
      setBilling(billingResult.subscription);
      setActivePackages(packagesResult.items);
      setSelectedPackageId(billingResult.subscription?.packageId ?? '');
      setState('loaded');
    } catch (error) {
      setState(isPlatformApiError(error) && error.status === 404 ? 'not-found' : 'error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveAiModel() {
    if (!tenant || aiModelSaving) return;
    setAiModelSaving(true);
    try {
      if (selectedModelId === '') {
        await unassignTenantAiModel(tenant.id);
        toaster.create({ type: 'success', title: 'Reset to the platform default model.' });
      } else {
        await assignTenantAiModel(tenant.id, selectedModelId);
        toaster.create({ type: 'success', title: 'AI model assignment saved.' });
      }
      await load();
    } catch {
      toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
    } finally {
      setAiModelSaving(false);
    }
  }

  /** Direct (non-Stripe) package reassignment — "comp a tenant, or correct a mistake" (migration plan
   * Phase 2 sub-slice "2c"). No confirm dialog: reassigning a package is fully, immediately reversible
   * (pick a different package, save again) and has no destructive/time-bounded consequence, the same
   * reasoning that already keeps the AI-model assignment panel confirm-free. */
  async function handleReassignPackage() {
    if (!tenant || !selectedPackageId || reassignSaving) return;
    setReassignSaving(true);
    try {
      const result = await reassignTenantSubscription(tenant.id, selectedPackageId);
      setBilling(result.subscription);
      toaster.create({ type: 'success', title: 'Subscription reassigned.' });
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'PACKAGE_INACTIVE') {
        toaster.create({ type: 'error', title: 'That package is inactive and can no longer be assigned to a tenant.' });
      } else {
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
    } finally {
      setReassignSaving(false);
    }
  }

  /** Platform-Admin-initiated Stripe Checkout Session creation (FR-PKG-6). Opens the real,
   * Stripe-hosted redirect URL in a new tab — this dispatch's admin console never itself becomes a
   * payment page; Stripe's own hosted Checkout is where card details are actually collected. Creating
   * a session never itself grants access (the subscription only moves to `ACTIVE` once the
   * `checkout.session.completed` webhook fires), so this action does not update `billing` state itself
   * — an admin returning to this page after checkout completes sees the update via a normal reload. */
  async function handleStartCheckout() {
    if (!tenant || !selectedPackageId || checkoutStarting) return;
    setCheckoutStarting(true);
    try {
      const { url } = await createTenantCheckoutSession(tenant.id, selectedPackageId);
      window.open(url, '_blank', 'noopener,noreferrer');
      toaster.create({ type: 'info', title: 'Stripe Checkout opened in a new tab.' });
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'BILLING_NOT_CONFIGURED') {
        toaster.create({ type: 'error', title: 'Billing is not configured for this deployment.' });
      } else if (isPlatformApiError(error) && error.code === 'PACKAGE_INACTIVE') {
        toaster.create({ type: 'error', title: 'That package is inactive and can no longer be assigned to a tenant.' });
      } else {
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
    } finally {
      setCheckoutStarting(false);
    }
  }

  async function runAction(kind: ActionKind, call: () => Promise<TenantSummary>, successMessage: string) {
    setActionInFlight(kind);
    setLiveAnnouncement('Working…');
    try {
      await call();
      setLiveAnnouncement(successMessage);
      toaster.create({ type: 'success', title: successMessage });
      await load();
    } catch (error) {
      if (isPlatformApiError(error) && error.code === 'INVALID_TENANT_STATE') {
        setLiveAnnouncement("This tenant's status has changed. Refreshing…");
        toaster.create({ type: 'info', title: "This tenant's status has changed. Refreshing…" });
      } else {
        setLiveAnnouncement('Something went wrong.');
        toaster.create({ type: 'error', title: 'Something went wrong. Please try again.' });
      }
      await load();
    } finally {
      setActionInFlight(null);
    }
  }

  if (state === 'loading') {
    return (
      <Stack gap="4" maxW="2xl" data-testid="tenant-detail-loading">
        <BackToTenantsLink />
        <Skeleton height="8" width="48" />
        <Skeleton height="6" width="64" />
        <Skeleton height="32" />
      </Stack>
    );
  }

  if (state === 'not-found') {
    return (
      <Stack gap="4">
        <BackToTenantsLink />
        <Text>Tenant not found.</Text>
      </Stack>
    );
  }

  if (state === 'error' || !tenant) {
    return (
      <Stack gap="4">
        <BackToTenantsLink />
        <Text>We couldn&apos;t load this tenant. Try again.</Text>
        <Button onClick={load} alignSelf="flex-start">
          Retry
        </Button>
      </Stack>
    );
  }

  const canSuspend = tenant.status === 'Active';
  const canActivate = tenant.status === 'Suspended';
  const canRetry = tenant.status === 'Provisioning' || tenant.status === 'Failed';
  const canDelete = tenant.deletedAt === null;
  const anyActionInFlight = actionInFlight !== null;

  return (
    <Stack gap="6" maxW="2xl">
      <VisuallyHidden aria-live="polite">{liveAnnouncement}</VisuallyHidden>
      <BackToTenantsLink />

      <HStack justify="space-between" wrap="wrap" gap="3">
        <Heading size="lg">{tenant.name}</Heading>
        <StatusBadge status={tenant.status} />
      </HStack>

      {tenant.status === 'Failed' && tenant.provisioningError && (
        <Box borderWidth="1px" borderColor="red.200" bg="red.subtle" borderRadius="md" p="4">
          <Text fontWeight="bold" mb="1">
            Provisioning error:
          </Text>
          <Text whiteSpace="pre-wrap">{tenant.provisioningError}</Text>
        </Box>
      )}

      {tenant.deletedAt && (
        <Box borderWidth="1px" borderColor="orange.200" bg="orange.subtle" borderRadius="md" p="4">
          <Text>
            This tenant was deleted on {new Date(tenant.deletedAt).toLocaleString()} and is scheduled for permanent
            removal on {tenant.purgeAfterAt ? new Date(tenant.purgeAfterAt).toLocaleDateString() : 'unknown'}.
          </Text>
        </Box>
      )}

      <DataList.Root orientation="horizontal">
        <DataList.Item>
          <DataList.ItemLabel>Subdomain</DataList.ItemLabel>
          <DataList.ItemValue>{tenant.subdomainSlug}.examland.app</DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Schema name</DataList.ItemLabel>
          <DataList.ItemValue>{tenant.schemaName}</DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Email registration</DataList.ItemLabel>
          <DataList.ItemValue>
            <Badge colorPalette={tenant.allowEmailRegistration ? 'green' : 'gray'}>
              {tenant.allowEmailRegistration ? 'Allowed' : 'Disallowed'}
            </Badge>
          </DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Google sign-in</DataList.ItemLabel>
          <DataList.ItemValue>
            <Badge colorPalette={tenant.allowGoogleSignIn ? 'green' : 'gray'}>
              {tenant.allowGoogleSignIn ? 'Allowed' : 'Disallowed'}
            </Badge>
          </DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Created</DataList.ItemLabel>
          <DataList.ItemValue title={new Date(tenant.createdAt).toISOString()}>
            {new Date(tenant.createdAt).toLocaleString()}
          </DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Last updated</DataList.ItemLabel>
          <DataList.ItemValue title={new Date(tenant.updatedAt).toISOString()}>
            {new Date(tenant.updatedAt).toLocaleString()}
          </DataList.ItemValue>
        </DataList.Item>
      </DataList.Root>

      <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="5" data-testid="billing-panel">
        <Stack gap="4">
          <Heading size="md">Billing</Heading>

          {billing ? (
            <DataList.Root orientation="horizontal">
              <DataList.Item>
                <DataList.ItemLabel>Package</DataList.ItemLabel>
                <DataList.ItemValue>{billing.packageName}</DataList.ItemValue>
              </DataList.Item>
              <DataList.Item>
                <DataList.ItemLabel>Price</DataList.ItemLabel>
                <DataList.ItemValue>
                  {(billing.priceCents / 100).toFixed(2)} {billing.currency.toUpperCase()} / month
                </DataList.ItemValue>
              </DataList.Item>
              <DataList.Item>
                <DataList.ItemLabel>Status</DataList.ItemLabel>
                <DataList.ItemValue>
                  <Badge colorPalette={billing.status === 'ACTIVE' ? 'green' : billing.status === 'PAST_DUE' ? 'orange' : 'red'}>
                    {billing.status}
                  </Badge>
                </DataList.ItemValue>
              </DataList.Item>
              <DataList.Item>
                <DataList.ItemLabel>Stripe customer</DataList.ItemLabel>
                <DataList.ItemValue>{billing.hasProviderCustomer ? 'Created' : 'None yet'}</DataList.ItemValue>
              </DataList.Item>
            </DataList.Root>
          ) : (
            <Text fontSize="sm" color="gray.600">
              This tenant has no subscription on record.
            </Text>
          )}

          <NativeSelect.Root maxW="sm" disabled={reassignSaving || checkoutStarting}>
            <NativeSelect.Field
              aria-label="Reassign package"
              value={selectedPackageId}
              onChange={(e) => setSelectedPackageId(e.target.value)}
            >
              <option value="" disabled>
                Select a package…
              </option>
              {activePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>

          <HStack gap="3" wrap="wrap">
            <Button
              colorPalette="brand"
              loading={reassignSaving}
              disabled={!selectedPackageId || checkoutStarting}
              onClick={handleReassignPackage}
            >
              Reassign package
            </Button>
            <Button
              variant="outline"
              loading={checkoutStarting}
              disabled={!selectedPackageId || reassignSaving}
              onClick={handleStartCheckout}
            >
              Create checkout session
            </Button>
          </HStack>
          <Text fontSize="xs" color="gray.500">
            &ldquo;Reassign package&rdquo; changes the tenant&apos;s package immediately, without Stripe.
            &ldquo;Create checkout session&rdquo; opens a real Stripe-hosted payment page in a new tab — the
            package only takes effect once that checkout completes.
          </Text>
        </Stack>
      </Box>

      <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p="5">
        <Stack gap="4">
          <Heading size="md">AI model</Heading>
          {(() => {
            const assigned = tenant.assignedAiModelId ? aiModels.find((m) => m.id === tenant.assignedAiModelId) : undefined;
            const platformDefault = aiModels.find((m) => m.isPlatformDefault);
            const effective = assigned ?? platformDefault;
            return (
              <Text fontSize="sm" color="gray.600">
                Currently effective:{' '}
                <Text as="span" fontWeight="medium" color="gray.900">
                  {effective ? effective.displayName : 'None configured'}
                </Text>{' '}
                ({assigned ? 'explicitly assigned' : 'platform default'})
              </Text>
            );
          })()}

          <NativeSelect.Root maxW="sm" disabled={aiModelSaving}>
            <NativeSelect.Field
              aria-label="Assign AI model"
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
            >
              <option value="">Platform default</option>
              {aiModels
                .filter((m) => m.isEnabled)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>

          <Button colorPalette="brand" loading={aiModelSaving} alignSelf="flex-start" onClick={handleSaveAiModel}>
            Save assignment
          </Button>
        </Stack>
      </Box>

      <HStack gap="3" wrap="wrap">
        {canSuspend && (
          <Button
            variant="outline"
            loading={actionInFlight === 'suspend'}
            disabled={anyActionInFlight && actionInFlight !== 'suspend'}
            onClick={() => setConfirmAction('suspend')}
          >
            Suspend
          </Button>
        )}
        {canActivate && (
          <Button
            colorPalette="brand"
            loading={actionInFlight === 'activate'}
            disabled={anyActionInFlight && actionInFlight !== 'activate'}
            onClick={() => runAction('activate', () => activateTenant(tenant.id), 'Tenant activated.')}
          >
            Activate
          </Button>
        )}
        {canRetry && (
          <Button
            colorPalette="brand"
            loading={actionInFlight === 'retry'}
            disabled={anyActionInFlight && actionInFlight !== 'retry'}
            onClick={() => runAction('retry', () => retryTenantProvisioning(tenant.id), 'Provisioning retried.')}
          >
            Retry provisioning
          </Button>
        )}
        {canDelete && (
          <Button
            colorPalette="red"
            variant="outline"
            loading={actionInFlight === 'delete'}
            disabled={anyActionInFlight && actionInFlight !== 'delete'}
            onClick={() => setConfirmAction('delete')}
          >
            Delete tenant
          </Button>
        )}
      </HStack>

      <ConfirmDialog
        open={confirmAction === 'suspend'}
        title={`Suspend '${tenant.name}'?`}
        message="Users on this tenant will be unable to sign in until it is reactivated."
        confirmLabel="Suspend"
        loading={actionInFlight === 'suspend'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          setConfirmAction(null);
          await runAction('suspend', () => suspendTenant(tenant.id), 'Tenant suspended.');
        }}
      />

      {/*
       * Soft-delete deliberately gets a STRONGER confirmation than suspend (`docs/plans/
       * nextjs-rewrite-phase2-plan.md`'s "Decisions made" — this dispatch's own judgment call): a
       * suspend is fully reversible with one click ("Activate"); a soft-delete blocks all tenant
       * access outright and starts an irreversible-after-the-retention-window purge countdown. The
       * type-the-tenant-name confirmation (vs. a plain Cancel/Confirm dialog) reflects that materially
       * higher stakes, matching this project's own established "graduate the confirmation strength to
       * the action's actual reversibility" reasoning (see the plan doc for the full comparison against
       * this project's prior confirm-dialog precedent).
       */}
      <ConfirmDialog
        open={confirmAction === 'delete'}
        title={`Delete '${tenant.name}'?`}
        message="This tenant will lose all access immediately and will be permanently purged after the retention window. This is far harder to undo than a suspension."
        confirmLabel="Delete tenant"
        tone="danger"
        requireTypedConfirmation={tenant.name}
        loading={actionInFlight === 'delete'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          setConfirmAction(null);
          await runAction('delete', () => softDeleteTenant(tenant.id), 'Tenant deleted.');
          router.refresh();
        }}
      />
    </Stack>
  );
}
