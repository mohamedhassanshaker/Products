'use client';

import { Badge, HStack, Text } from '@chakra-ui/react';
import type { TenantStatus } from '@/lib/platform-console/tenants-api';

/**
 * Tenant status badge (`docs/design/UX_GUIDELINES.md` §3.1a) — the first status-badge component in
 * this app, established as a project-wide `components/platform` pattern rather than a one-off
 * per-screen treatment (used identically on the tenant list's rows and the tenant detail header).
 *
 * **Never color-only** (§3.1a / WCAG 2.2 AA "don't convey meaning by color alone"): every badge pairs
 * a `colorPalette` with a distinct text label — there is no icon library in this app yet (Phase 0/1
 * added none, and adding one for a single badge component isn't justified this dispatch — see
 * `docs/plans/nextjs-rewrite-phase2-plan.md`'s "Decisions made"), so the *text label itself* is the
 * non-color differentiator here, which already satisfies the accessibility requirement (a screen
 * reader reads "Active"/"Suspended"/etc. regardless of color, and a colorblind sighted user reads the
 * same word) without a rendering icon dependency.
 */
const STATUS_COLOR_PALETTE: Record<TenantStatus, string> = {
  Provisioning: 'blue',
  Active: 'green',
  Suspended: 'orange',
  Failed: 'red',
};

export function StatusBadge({ status }: { status: TenantStatus }) {
  return (
    <Badge colorPalette={STATUS_COLOR_PALETTE[status]} variant="subtle" size="lg" data-testid="status-badge">
      <HStack gap="1.5">
        <Text as="span" aria-hidden="true" lineHeight="1">
          ●
        </Text>
        <Text as="span">{status}</Text>
      </HStack>
    </Badge>
  );
}
