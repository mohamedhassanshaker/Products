import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { OPS_SESSION_COOKIE, verifyOperatorToken } from "@/src/lib/platform-ops-auth";
import { OpsShell } from "./OpsShell";

/**
 * The authenticated half of the Platform Manager console (NFR-11): every page under
 * this `(console)` route group (a grouping-only folder — it doesn't appear in the URL,
 * so `/internal/ops/tenants` etc. are unaffected) requires a valid
 * `/internal/ops`-scoped session cookie, or redirects to `/internal/ops/login`.
 *
 * `assertOpsPageAllowed()` is re-applied here **before** the session check even though
 * `../layout.tsx` already applied it. That is not redundant: the App Router renders
 * layouts in parallel, so the root layout denying does not stop this one from running —
 * and when this one ran anyway, its `redirect()` serialized the literal
 * `NEXT_REDIRECT;replace;/internal/ops/login;307;` into the denied response's payload,
 * confirming that route exists to an unauthenticated caller on an unconfigured
 * deployment. Gating first means an unconfigured/network-disallowed caller throws the
 * shared not-found signal here too and never reaches the redirect. See
 * `src/lib/ops-page-gate.ts`'s doc comment for the full measured leak.
 *
 * The ordering is load-bearing: the not-found gate must come first, so that "the
 * console isn't turned on / you're not on an allowed network" can never be answered
 * with a redirect (a distinguishable response), only ever with the shared not-found.
 */
export default async function OpsConsoleLayout({ children }: { children: ReactNode }) {
  await assertOpsPageAllowed();

  const store = await cookies();
  const token = store.get(OPS_SESSION_COOKIE)?.value;
  if (!token || !verifyOperatorToken(token)) {
    redirect("/internal/ops/login");
  }

  return <OpsShell>{children}</OpsShell>;
}
