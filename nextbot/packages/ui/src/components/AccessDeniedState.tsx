import NextLink from "next/link";
import { Card, CardContent, CardHeader } from "@nextbot/ui/components/ui/card";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { buttonVariants } from "@nextbot/ui/components/ui/button";
import { cn } from "@nextbot/ui/lib/utils";

/**
 * QA Defect U3 (FR-ADM-02 fail-closed deep-link guard, `docs/design/UX_GUIDELINES.md`
 * §2.3): "Attempting to deep-link (URL) directly to a module with None access
 * renders a full-page 'You don't have access to this section' state (not a 404, not
 * a silent redirect) with a link back to Dashboard Home." Pure/presentational (no
 * Next.js server dependency beyond `next/link`) so it can be reused from any
 * page-level guard — every RSC page in `app/(admin)/**` renders this directly as
 * its own return value on a `None`-access check.
 *
 * Plan Phase 4 rebuild (QA finding, Batch D): the prior Chakra version rendered its
 * own `<Box as="main" role="main">` wrapper. Every call site is itself rendered as
 * `{children}` inside `AdminShell.tsx`'s own `<main role="main">` (the page content
 * region for the whole admin shell), so a second `role="main"` here produced a real
 * duplicate-landmark a11y defect on every RBAC-denied screen app-wide (axe-core's
 * `landmark-unique`/multiple-`main`-landmarks class of finding). This version is a
 * plain, non-landmark `<div>` — the accessible name/structure other assistive-tech
 * users need (a heading + a link) doesn't require a second landmark, since the
 * parent `<main>` already scopes "this is the page's main content."
 *
 * Public prop surface (`moduleLabel`/`homeHref`) is unchanged from the pre-migration
 * version so the ~15+ call sites across every RBAC-gated screen need no changes.
 */
export function AccessDeniedState({
  moduleLabel,
  homeHref = "/dashboard",
}: {
  moduleLabel?: string;
  homeHref?: string;
}) {
  return (
    <div className="mx-auto mt-20 max-w-lg px-6 text-center">
      <Card>
        <CardHeader>
          {/* A real `h1`, not `Card`'s own `CardTitle` (which renders a plain
              `div` — this state needs a genuine heading-one for
              `page-has-heading-one` compliance on every screen it's the sole
              content of). */}
          <h1 className="font-heading text-lg font-semibold">
            You don&apos;t have access to this section
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <Alert>
            <AlertDescription>
              {moduleLabel
                ? `Your role doesn't grant access to ${moduleLabel}. Contact your administrator if you believe this is a mistake.`
                : "Your role doesn't grant access to this part of the Admin Console. Contact your administrator if you believe this is a mistake."}
            </AlertDescription>
          </Alert>
          <NextLink href={homeHref} className={cn(buttonVariants({ variant: "link" }))}>
            Back to Dashboard Home
          </NextLink>
        </CardContent>
      </Card>
    </div>
  );
}
