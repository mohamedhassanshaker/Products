import NextLink from "next/link";
import { Card } from "@nextbot/ui/components/ui/card";

/**
 * QA Defect U8: `docs/design/UX_GUIDELINES.md` §2.1 requires a "Forgot password?"
 * link on the login screen; a real self-service password-reset flow is out of
 * scope for this fix pass (not previously implemented, not a blocking/should-fix
 * defect in this pass), so this is an honest placeholder rather than a dead link or
 * a faked-working flow.
 *
 * Converted alongside the login screen in the shadcn/Tailwind cutover (Plan
 * Phase 1): the root layout no longer mounts a `ChakraProvider` at all (dropped in
 * `apps/web/app/layout.tsx`), and this page sits outside the `(admin)` route group
 * — which is the only place that still nests a temporary Chakra shim — so it would
 * otherwise render unstyled/untethered Chakra components with no theme context.
 */
export default function ForgotPasswordPage() {
  return (
    <Card className="mx-auto mt-20 max-w-sm p-8">
      <main role="main">
        <h1 className="mb-4 font-heading text-lg font-semibold">Forgot your password?</h1>
        <p className="mb-6 text-gray-600">
          Self-service password reset isn&apos;t available yet. Contact your tenant administrator to have your
          password reset.
        </p>
        <NextLink href="/login" className="font-semibold text-primary hover:underline">
          Back to sign in
        </NextLink>
      </main>
    </Card>
  );
}
