"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Separator } from "@nextbot/ui/components/ui/separator";
import { opsLogoutAction } from "../login/actions";

const NAV_ITEMS = [
  { href: "/internal/ops/tenants", label: "Tenants" },
  { href: "/internal/ops/plan-tiers", label: "Plan Tiers" },
  { href: "/internal/ops/health", label: "Health" },
];

/**
 * Genuinely separate, minimal shell for the Platform Manager console (NFR-11) — NOT
 * `AdminShell` with its tenant-scoped nav/branding props toggled off. Deliberately a
 * distinct, much smaller component (a plain top bar + one-level nav, no
 * breadcrumbs, no tenant branding, no RBAC nav-item filtering) built from the same
 * shadcn primitives (`packages/ui/src/components/ui/*`) so "this is not
 * tenant-scoped" stays structurally obvious to anyone editing either shell later,
 * rather than something a future prop change could silently blur.
 */
export function OpsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-6">
          <span className="font-heading text-base font-semibold">Platform Manager</span>
          <nav aria-label="Platform Manager sections" className="flex items-center gap-4">
            {NAV_ITEMS.map((item) => (
              <NextLink
                key={item.href}
                href={item.href}
                aria-current={pathname?.startsWith(item.href) ? "page" : undefined}
                className={
                  pathname?.startsWith(item.href)
                    ? "font-semibold underline underline-offset-4"
                    : "text-muted-foreground hover:text-foreground hover:underline"
                }
              >
                {item.label}
              </NextLink>
            ))}
          </nav>
        </div>
        <form action={opsLogoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <Separator />
      <main role="main" className="p-6">
        {children}
      </main>
    </div>
  );
}
