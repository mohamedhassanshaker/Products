'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Box, Button, Heading, HStack, SimpleGrid, Skeleton, Text, VStack, chakra } from '@chakra-ui/react';
import * as billingApi from '@/lib/tenant-console/billing-api';
import * as usageApi from '@/lib/tenant-console/usage-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

/** Same currency-formatting convention as the Platform Admin Packages list
 * (`app/platform/(console)/packages/page.tsx`'s `formatPrice`) — reused verbatim rather than
 * inventing a second format for this screen (§17.1's own explicit instruction). */
function formatPrice(priceCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(priceCents / 100);
}

/** Subscription status badge — never color-only (WCAG 2.2 AA), mirrors `components/platform/status-badge.tsx`'s
 * "text label is the non-color differentiator" precedent (this app still has no icon library — see
 * that component's own doc comment for why). */
const STATUS_COLOR_PALETTE: Record<'ACTIVE' | 'PAST_DUE' | 'CANCELED', string> = {
  ACTIVE: 'green',
  PAST_DUE: 'orange',
  CANCELED: 'red',
};
const STATUS_LABEL: Record<'ACTIVE' | 'PAST_DUE' | 'CANCELED', string> = {
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  CANCELED: 'Canceled',
};

function StatusBadge({ status }: { status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' }) {
  return (
    <Badge colorPalette={STATUS_COLOR_PALETTE[status]} variant="subtle" size="lg" data-testid="subscription-status-badge">
      <HStack gap="1.5">
        <Text as="span" aria-hidden="true" lineHeight="1">
          ●
        </Text>
        <Text as="span">{STATUS_LABEL[status]}</Text>
      </HStack>
    </Badge>
  );
}

/** Bounded poll window/interval for the post-`?checkout=success` confirmation banner (§17.4/§17.9
 * flag #73) — this document's own reasonable defaults, not derived from real observed webhook
 * latency; tune once observed in practice. */
const POLL_INTERVAL_MS = 4000;
const POLL_WINDOW_MS = 45_000;

/**
 * Self-serve tenant billing screen (`/settings/billing`, migration plan Phase 9 sub-slice "9b",
 * FR-PKG-6), gated on `billing.read` (§17.0) — ported UX from legacy's `BillingSettingsComponent` /
 * `docs/design/UX_GUIDELINES.md` §17. Current-plan panel (status badge + persistent PAST_DUE/CANCELED
 * banner) above an active-package-only card grid; each card's action button reads
 * Upgrade/Downgrade/Resubscribe per direction/state (§17.1). `billing.manage` additionally gates the
 * action buttons themselves — a `billing.read`-only viewer sees every card but every button disabled
 * with helper text (§17.0's forward-defensive read-only treatment; no such split role exists yet in
 * this app's `seed-rbac.step.ts`, so this path is exercised only by a manually-constructed test grant
 * today — flagged, not urgently needed per §17.9 flag #74).
 *
 * Wrapped in `Suspense` because the inner component reads `useSearchParams()` (the `?checkout=...`
 * query param) — a Next.js App Router requirement for any Client Component using it (same pattern
 * `app/(tenant)/login/page.tsx` already establishes).
 */
export default function BillingSettingsPage() {
  return (
    <Suspense fallback={null}>
      <BillingSettingsForm />
    </Suspense>
  );
}

function BillingSettingsForm() {
  const { hasPermission } = useTenantAuthContext();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [state, setState] = useState<LoadState>('loading');
  const [plans, setPlans] = useState<billingApi.TenantPlansResponse | null>(null);
  // FR-PKG-5 (the post-Phase-10-e2e closure dispatch that ports `platform/usage`): a small, read-only
  // addition alongside the existing current-plan panel — never blocks/errors the rest of this screen if
  // it fails to load (usage/quota is supplementary information, not this screen's primary purpose).
  const [usageItems, setUsageItems] = useState<usageApi.FeatureUsageSnapshotItem[] | null>(null);
  const [pendingPackageId, setPendingPackageId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [raceSnackbar, setRaceSnackbar] = useState<string | null>(null);
  const [checkoutBanner, setCheckoutBanner] = useState<
    { tone: 'confirming' | 'success' | 'neutral' | 'canceled'; message: string } | null
  >(null);

  const bannerRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const canManage = hasPermission('billing.manage');
  const canView = hasPermission('billing.read');

  const fetchPlans = useCallback(async (): Promise<billingApi.TenantPlansResponse | null> => {
    try {
      const result = await billingApi.getPlans();
      setPlans(result);
      setState(result.packages.length === 0 ? 'empty' : 'loaded');
      return result;
    } catch {
      setState('error');
      return null;
    }
  }, []);

  // Initial load. Usage fetch failures are swallowed (leaving `usageItems` `null`, which the render
  // below simply omits the panel for) — a quota-snapshot fetch error must never block the rest of this
  // screen (the plan catalog/current-plan panel) from loading.
  useEffect(() => {
    if (!canView) return;
    fetchPlans();
    usageApi
      .getUsage()
      .then((res) => setUsageItems(res.features))
      .catch(() => setUsageItems(null));
  }, [canView, fetchPlans]);

  // §17.4: handle the post-checkout return. Always re-fetches regardless of which param is present,
  // strips the query param after handling it, and — for `?checkout=success` only — polls briefly for
  // webhook-driven confirmation rather than leaving the "confirming…" message stale indefinitely.
  useEffect(() => {
    if (!canView) return;
    const checkoutParam = searchParams.get('checkout');
    if (checkoutParam !== 'success' && checkoutParam !== 'cancel') return;

    // Strip the query param immediately so a page refresh doesn't re-trigger this banner indefinitely.
    router.replace('/settings/billing');

    if (checkoutParam === 'cancel') {
      setCheckoutBanner({ tone: 'canceled', message: 'No changes were made to your plan.' });
      return;
    }

    // `checkout=success` — start in the "confirming" tone; fetchPlans() above (the normal load effect)
    // already issued the standard re-fetch, so this effect only needs to *observe* the result and poll.
    setCheckoutBanner({
      tone: 'confirming',
      message:
        "Checkout complete — we're confirming your new plan now. This usually takes a few seconds, and " +
        'this page will update automatically once it’s active.',
    });
    pollDeadlineRef.current = Date.now() + POLL_WINDOW_MS;

    const poll = async () => {
      const result = await fetchPlans();
      if (result?.status === 'ACTIVE') {
        const activePkg = result.packages.find((p) => p.id === result.currentPackageId);
        setCheckoutBanner({
          tone: 'success',
          message: `Your plan has been upgraded to ${activePkg?.name ?? 'your new plan'}.`,
        });
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        return;
      }
      if (Date.now() >= pollDeadlineRef.current) {
        setCheckoutBanner({
          tone: 'neutral',
          message: 'Still confirming your new plan — refresh this page in a moment, or contact support if this persists.',
        });
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      }
    };

    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
    // Deliberately runs once per mount (checkout-return handling only applies to the landing navigation
    // itself) — `fetchPlans`/`router` are stable across renders (useCallback/Next's own router identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  // §17.5: focus management on redirect-back — move focus to the banner once it renders.
  useEffect(() => {
    if (checkoutBanner) bannerRef.current?.focus();
  }, [checkoutBanner]);

  async function handleSelectPlan(packageId: string) {
    setActionError(null);
    setPendingPackageId(packageId);
    try {
      const { url } = await billingApi.createCheckoutSession(packageId);
      // §17.2/§17.3: immediate full-page redirect, no intermediate confirm dialog — Stripe's own
      // hosted checkout page is itself the "are you sure" step.
      window.location.href = url;
    } catch (err) {
      setPendingPackageId(null);
      if (isTenantApiError(err)) {
        if (err.code === 'BILLING_NOT_CONFIGURED') {
          setActionError('Billing isn’t set up for this environment yet. Please contact support and try again later.');
          return;
        }
        if (err.status === 404 || err.code === 'PACKAGE_NOT_FOUND' || err.code === 'PACKAGE_INACTIVE') {
          setRaceSnackbar('This plan is no longer available. Refreshing options…');
          fetchPlans();
          return;
        }
      }
      setActionError('Something went wrong starting checkout. Please try again.');
    }
  }

  if (!canView) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Billing
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }

  return (
    <Box maxW="4xl">
      <Heading size="md" mb="2">
        Billing
      </Heading>
      <Text color="gray.600" mb="6" fontSize="sm">
        View your current plan and available plans below.
      </Text>

      {checkoutBanner && (
        <Box
          ref={bannerRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          mb="4"
          px="4"
          py="3"
          borderRadius="md"
          data-testid="checkout-return-banner"
          bg={checkoutBanner.tone === 'success' ? 'green.subtle' : checkoutBanner.tone === 'neutral' ? 'gray.100' : 'blue.subtle'}
          color={checkoutBanner.tone === 'success' ? 'green.fg' : 'inherit'}
        >
          <HStack justify="space-between">
            <Text fontSize="sm">{checkoutBanner.message}</Text>
            <Button size="xs" variant="ghost" onClick={() => setCheckoutBanner(null)} aria-label="Dismiss">
              ✕
            </Button>
          </HStack>
        </Box>
      )}

      {raceSnackbar && (
        <Box role="status" mb="4" px="4" py="2" borderRadius="md" bg="gray.100" fontSize="sm" data-testid="race-snackbar">
          {raceSnackbar}
        </Box>
      )}

      {state === 'loading' && (
        <VStack align="stretch" gap="4">
          <Skeleton height="24" />
          <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4">
            <Skeleton height="40" />
            <Skeleton height="40" />
            <Skeleton height="40" />
          </SimpleGrid>
        </VStack>
      )}

      {state === 'error' && (
        <Box role="alert" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3">
          <Text mb="2">We couldn&apos;t load your billing information.</Text>
          <Button size="sm" onClick={() => fetchPlans()}>
            Retry
          </Button>
        </Box>
      )}

      {state === 'empty' && (
        <Box borderRadius="md" px="4" py="3" bg="gray.50">
          <Text>No plans are currently available. Please contact support.</Text>
        </Box>
      )}

      {(state === 'loaded' || (state === 'empty' && plans)) && plans && (
        <VStack align="stretch" gap="8" data-testid="billing-form">
          <Box borderWidth="1px" borderRadius="md" p="4" data-testid="current-plan-panel">
            <chakra.dl display="grid" gridTemplateColumns="max-content 1fr" gap="2" alignItems="center">
              <chakra.dt fontWeight="medium" color="gray.600">
                Current plan
              </chakra.dt>
              <chakra.dd>
                {plans.currentPackageId
                  ? (plans.packages.find((p) => p.id === plans.currentPackageId)?.name ?? 'Unknown plan')
                  : 'No active plan'}
              </chakra.dd>
              <chakra.dt fontWeight="medium" color="gray.600">
                Status
              </chakra.dt>
              <chakra.dd>{plans.status ? <StatusBadge status={plans.status} /> : <Text color="gray.500">—</Text>}</chakra.dd>
            </chakra.dl>

            {plans.status === 'PAST_DUE' && (
              <Box role="alert" mt="4" px="3" py="2" borderRadius="md" bg="orange.subtle" color="orange.fg" fontSize="sm">
                Your payment is past due. Update your payment method or your plan may be downgraded/canceled.
              </Box>
            )}
            {plans.status === 'CANCELED' && (
              <Box role="alert" mt="4" px="3" py="2" borderRadius="md" bg="red.subtle" color="red.fg" fontSize="sm">
                Your subscription has been canceled. Choose a plan below to resubscribe.
              </Box>
            )}
          </Box>

          {usageItems && usageItems.length > 0 && (
            <Box borderWidth="1px" borderRadius="md" p="4" data-testid="usage-panel">
              <Heading size="sm" mb="3">
                Feature usage
              </Heading>
              <VStack align="stretch" gap="2">
                {usageItems.map((item) => (
                  <HStack key={item.featureKey} justify="space-between" fontSize="sm" data-testid={`usage-row-${item.featureKey}`}>
                    <Text color={item.enabled ? 'inherit' : 'gray.400'}>{item.featureName}</Text>
                    {!item.enabled && <Text color="gray.400">Not available on your plan</Text>}
                    {item.enabled && (
                      <Text>
                        {item.used}
                        {item.limit !== null ? ` / ${item.limit}` : ''} {item.unit}
                        {item.limit === null ? ' (unlimited)' : ''}
                      </Text>
                    )}
                  </HStack>
                ))}
              </VStack>
            </Box>
          )}

          <Box>
            <Heading size="sm" mb="4">
              Available plans
            </Heading>
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4">
              {plans.packages.map((pkg) => {
                const isCurrent = pkg.id === plans.currentPackageId;
                const currentPkg = plans.packages.find((p) => p.id === plans.currentPackageId);
                let verb = 'Upgrade to';
                if (plans.status === 'CANCELED') verb = 'Resubscribe to';
                else if (currentPkg && pkg.priceCents < currentPkg.priceCents) verb = 'Downgrade to';

                return (
                  <Box key={pkg.id} borderWidth="1px" borderRadius="md" p="4" data-testid={`plan-card-${pkg.key}`}>
                    <HStack justify="space-between" mb="2">
                      <Heading size="sm">{pkg.name}</Heading>
                      {isCurrent && (
                        <Badge colorPalette="brand" variant="solid" data-testid="current-plan-chip">
                          Current plan
                        </Badge>
                      )}
                    </HStack>
                    <Text fontWeight="semibold" mb="2">
                      {formatPrice(pkg.priceCents, pkg.currency)}/mo
                    </Text>
                    {pkg.description && (
                      <Text fontSize="sm" color="gray.600" mb="4">
                        {pkg.description}
                      </Text>
                    )}
                    <Button
                      colorPalette="brand"
                      size="sm"
                      width="full"
                      disabled={isCurrent || !canManage || pendingPackageId !== null}
                      loading={pendingPackageId === pkg.id}
                      onClick={() => handleSelectPlan(pkg.id)}
                      data-testid={`plan-action-${pkg.key}`}
                      title={!canManage && !isCurrent ? 'Only a Tenant Admin can change your plan.' : undefined}
                    >
                      {isCurrent ? 'Current plan' : `${verb} ${pkg.name}`}
                    </Button>
                    {isCurrent && (
                      <Text fontSize="xs" color="gray.500" mt="1">
                        This is your current plan.
                      </Text>
                    )}
                    {!isCurrent && !canManage && (
                      <Text fontSize="xs" color="gray.500" mt="1">
                        Only a Tenant Admin can change your plan.
                      </Text>
                    )}
                  </Box>
                );
              })}
            </SimpleGrid>
          </Box>

          {actionError && (
            <Box role="alert" px="4" py="3" borderRadius="md" bg="red.subtle" color="red.fg" fontSize="sm" data-testid="action-error">
              {actionError}
            </Box>
          )}
        </VStack>
      )}
    </Box>
  );
}
