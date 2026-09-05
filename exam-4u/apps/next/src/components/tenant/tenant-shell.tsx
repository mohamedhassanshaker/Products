'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Box, Button, Drawer, Flex, HStack, Heading, Menu, Portal, Text } from '@chakra-ui/react';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

/**
 * Nav items, each gated by the permission that actually authorizes the underlying route (never a
 * role-name check) — `docs/design/UX_GUIDELINES.md` §19's IA: "Curriculum" is a top-level peer item
 * (core content, not settings), "Taxonomy" lives under a "Settings" grouping (tenant-configuration
 * data). Both are the *only* nav items this phase's scope needs — this shell is deliberately as small
 * as taxonomy/curricula requires (no dashboard/users/profile items yet; every later tenant-realm phase
 * extends this same shell exactly as `platform-shell.tsx` grew across Phase 2's own sub-slices).
 */
const NAV_ITEMS: { href: string; label: string; permission: string; group?: string }[] = [
  // Phase 9 sub-slice "9c" — the tenant dashboard, at the shell's own root/index route (`/`). No
  // permission gates this item's *visibility* — an empty `permission` string is `NavLinks`' own signal
  // for "always visible to any authenticated tenant user" (see below); the page itself self-gates each
  // content section individually (`app/(tenant)/(shell)/page.tsx`'s own doc comment).
  { href: '/', label: 'Dashboard', permission: '' },
  { href: '/curricula', label: 'Curriculum', permission: 'curricula.manage_own' },
  // Gated on `exams.read` (not `exams.create`) — matches legacy's own `ExamTypeListComponent`, where
  // the list route (and therefore the nav link to it) only needs read access; `exams.create`/
  // `exams.delete` separately gate the Create button/row-delete action within the page itself.
  { href: '/exam-types', label: 'Exam Types', permission: 'exams.read' },
  // Phase 7 — learner-facing exam discovery, a deliberately distinct route/nav item from "Exam Types"
  // above (admin authoring/management vs. a Member browsing what they can attempt) — see
  // `app/(tenant)/(shell)/exams/page.tsx`'s own doc comment for the full route-naming judgment call.
  { href: '/exams', label: 'Exams', permission: 'attempts.take' },
  { href: '/attempts', label: 'My Attempts', permission: 'attempts.read_own' },
  // Phase 8 — live Prompt Practice (FR-CUR-5), gated on `curricula.manage_own` (the same permission
  // `POST /api/practice/prompt` itself requires — Prompt Practice generates against a Curriculum the
  // caller manages, matching legacy's own reuse of this grant rather than a new permission). Lesson
  // Practice/Full-Bank Assessment ship backend-only this phase (no nav item/page) — see
  // `docs/plans/nextjs-rewrite-phase8-plan.md`'s "Decisions made" for the documented scope choice.
  { href: '/practice', label: 'Practice', permission: 'curricula.manage_own' },
  // Phase 6 sub-slice "6a" — gated on `pdf.upload` (the same "trigger AI generation work" permission
  // `POST /api/pdf-processing/upload` itself requires); `pdf.review` separately gates the status/list
  // read surfaces this same nav item leads to.
  { href: '/pdf-processing', label: 'PDF Import', permission: 'pdf.upload' },
  { href: '/settings/taxonomy', label: 'Taxonomy', permission: 'taxonomy.read', group: 'Settings' },
  // Phase 6 sub-slice "6d" — read-only analytics dashboard, gated on `pdf.review` (the same
  // permission the review screen itself requires; nothing about this page writes anything).
  { href: '/settings/confidence-calibration', label: 'Confidence calibration', permission: 'pdf.review', group: 'Settings' },
  // Phase 9 sub-slice "9a" — gated on `tenant.settings.manage` (the same permission
  // `GET`/`PATCH /api/tenant/branding` itself require).
  { href: '/settings/branding', label: 'Branding', permission: 'tenant.settings.manage', group: 'Settings' },
  // Phase 9 sub-slice "9b" — gated on `billing.read` (view-only; `billing.manage` additionally gates
  // the Upgrade/Downgrade/Resubscribe actions within the page itself — `docs/design/UX_GUIDELINES.md`
  // §17.0's "gate visibility on read, actions on manage" split), positioned after "Branding" per §17.0's
  // own nav-order instruction.
  { href: '/settings/billing', label: 'Billing', permission: 'billing.read', group: 'Settings' },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { hasPermission } = useTenantAuthContext();
  // An empty `permission` string means "always visible to any authenticated tenant user" (the
  // Dashboard item — its own page self-gates content section-by-section instead, see that page's own
  // doc comment) rather than a real permission grant to check.
  const visible = NAV_ITEMS.filter((item) => item.permission === '' || hasPermission(item.permission));

  // Group by `group` (undefined -> ungrouped, rendered first) while preserving NAV_ITEMS' own order —
  // small and fixed enough this phase that a full grouping data structure isn't warranted yet.
  const ungrouped = visible.filter((item) => !item.group);
  const grouped = visible.filter((item) => item.group);

  return (
    <Box as="nav" aria-label="Tenant navigation">
      {ungrouped.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
      {grouped.length > 0 && (
        <Box mt="4">
          <Text px="4" fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" mb="1">
            Settings
          </Text>
          {grouped.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function NavLink({ item, pathname, onNavigate }: { item: (typeof NAV_ITEMS)[number]; pathname: string | null; onNavigate?: () => void }) {
  // `/` (the Dashboard item) must match only the exact root route — every other route also
  // "starts with" `/`, which would otherwise highlight Dashboard as active everywhere.
  const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
  return (
    <Link href={item.href} onClick={onNavigate}>
      <Box
        px="4"
        py="2.5"
        borderRadius="md"
        fontWeight="medium"
        bg={active ? 'brand.subtle' : 'transparent'}
        color={active ? 'brand.fg' : 'gray.700'}
        _hover={{ bg: 'brand.subtle' }}
      >
        {item.label}
      </Box>
    </Link>
  );
}

/**
 * The authenticated tenant-realm shell (`docs/design/UX_GUIDELINES.md` §4.0/§19 — this app's Chakra v3
 * port, mirroring `components/platform/platform-shell.tsx`'s exact structural pattern): a persistent
 * sidebar nav on desktop, collapsing to a hamburger-triggered `Drawer` on narrower viewports, a top bar
 * with the authenticated user's name and a log-out action, and the routed page content.
 */
export function TenantShell({ children }: { children: ReactNode }) {
  const { user, logout } = useTenantAuthContext();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  return (
    <Flex minH="100dvh">
      <Box as="aside" display={{ base: 'none', md: 'block' }} w="64" flexShrink={0} borderRightWidth="1px" borderColor="gray.200" py="6" px="3">
        <Heading size="sm" px="3" mb="6" color="brand.700">
          ExamLand
        </Heading>
        <NavLinks />
      </Box>

      <Flex direction="column" flex="1" minW="0">
        <Flex as="header" align="center" justify="space-between" borderBottomWidth="1px" borderColor="gray.200" px="4" py="3">
          <HStack gap="2">
            <Button
              aria-label="Toggle navigation menu"
              variant="ghost"
              display={{ base: 'inline-flex', md: 'none' }}
              onClick={() => setDrawerOpen(true)}
            >
              Menu
            </Button>
          </HStack>
          {user && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="ghost" aria-label="Account menu">
                  {user.firstName} {user.lastName}
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content>
                    <Menu.Item value="logout" onClick={handleLogout}>
                      Log out
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          )}
        </Flex>

        <Box as="main" flex="1" p={{ base: '4', md: '6' }}>
          {children}
        </Box>
      </Flex>

      <Drawer.Root open={drawerOpen} onOpenChange={(details) => setDrawerOpen(details.open)} placement="start">
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content>
              <Drawer.Header>
                <Drawer.Title>ExamLand</Drawer.Title>
              </Drawer.Header>
              <Drawer.Body>
                <NavLinks onNavigate={() => setDrawerOpen(false)} />
              </Drawer.Body>
              <Drawer.CloseTrigger aria-label="Close navigation menu" />
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    </Flex>
  );
}
