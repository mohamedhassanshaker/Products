'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Box, Button, Drawer, Flex, HStack, Heading, Menu, Portal, Text } from '@chakra-ui/react';
import { usePlatformAuthContext } from '@/lib/platform-console/auth-context';

/** "An honest reflection of current scope" (`docs/design/UX_GUIDELINES.md` §3.1: "don't pad it with
 * placeholder nav items for sections that don't exist yet"). Phase 2 sub-slice "2b" added Packages/
 * Features/AI Models; sub-slice "2c" added the tenant-detail Billing panel (no dedicated top-level nav
 * item — it lives on the existing tenant-detail screen, see §18.8). Sub-slice "2d" (this dispatch)
 * adds the last two Phase 2 nav items: Reliability (the cross-tenant outbox/file-cleanup/work-hint
 * dashboard, §18.9) and Audit Log (the paginated/filterable `platform.audit_log` viewer, §18.10) —
 * both placed last, matching this app's own "operational/read-mostly surfaces at the end of the nav"
 * convention (mirroring where legacy's own Angular console placed its equivalent ops tooling, §15). */
const NAV_ITEMS = [
  { href: '/platform/tenants', label: 'Tenants' },
  { href: '/platform/packages', label: 'Packages' },
  { href: '/platform/features', label: 'Features' },
  { href: '/platform/ai-models', label: 'AI Models' },
  { href: '/platform/reliability', label: 'Reliability' },
  { href: '/platform/audit-log', label: 'Audit Log' },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <Box as="nav" aria-label="Platform admin navigation">
      {NAV_ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate}>
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
      })}
    </Box>
  );
}

/**
 * The authenticated platform-console shell (`docs/design/UX_GUIDELINES.md` §3/`platform-shell` —
 * this app's Chakra-v3 port of legacy Angular's `platform-shell.component.ts`): a persistent sidebar
 * nav on desktop, collapsing to a hamburger-triggered `Drawer` on narrower viewports (§3.5's
 * "Mobile: sidebar becomes a full-drawer overlay"), a top bar with the authenticated admin's name and
 * a log-out action, and the routed page content.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const { admin, logout } = usePlatformAuthContext();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function handleLogout() {
    logout();
    router.replace('/platform/login');
  }

  return (
    <Flex minH="100dvh">
      {/* Desktop persistent sidebar (§3.5 "Desktop: sidebar nav persistently visible"). */}
      <Box
        as="aside"
        display={{ base: 'none', md: 'block' }}
        w="64"
        flexShrink={0}
        borderRightWidth="1px"
        borderColor="gray.200"
        py="6"
        px="3"
      >
        <Heading size="sm" px="3" mb="6" color="brand.700">
          ExamLand Platform Admin
        </Heading>
        <NavLinks />
      </Box>

      <Flex direction="column" flex="1" minW="0">
        <Flex
          as="header"
          align="center"
          justify="space-between"
          borderBottomWidth="1px"
          borderColor="gray.200"
          px="4"
          py="3"
        >
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
          {admin && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="ghost" aria-label="Account menu">
                  {admin.name}
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

      {/* Mobile overlay drawer nav (§3.5). */}
      <Drawer.Root open={drawerOpen} onOpenChange={(details) => setDrawerOpen(details.open)} placement="start">
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content>
              <Drawer.Header>
                <Drawer.Title>ExamLand Platform Admin</Drawer.Title>
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

/** Small helper re-exported for pages that need a "Back to tenants" breadcrumb-style link
 * (`docs/design/UX_GUIDELINES.md` §3.2 step 5). */
export function BackToTenantsLink() {
  return (
    <Link href="/platform/tenants">
      <Text color="brand.fg" fontWeight="medium" mb="4" display="inline-block">
        ← Back to tenants
      </Text>
    </Link>
  );
}
