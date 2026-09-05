"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  OPS_SESSION_COOKIE,
  extractClientIp,
  isPlatformOpsConfigured,
  isRequestFromAllowedNetwork,
  verifyOperatorToken,
} from "@/src/lib/platform-ops-auth";
import { checkRateLimit } from "@/src/lib/rate-limit";

export interface OpsLoginFormState {
  error?: string;
}

/**
 * `/internal/ops/login` Server Action (NFR-11 Platform Manager console). Re-validates
 * the submitted token against `NEXTBOT_OPS_OPERATOR_TOKEN` (the exact same
 * constant-time check `requirePlatformApi()` uses) and, on success, sets the
 * `/internal/ops`-scoped httpOnly session cookie.
 *
 * A caller with network+IP-allowlist access but no valid token must not get
 * unlimited guessing attempts — reuses this app's own existing
 * `apps/web/src/lib/rate-limit.ts` (the same fixed-window Redis counter already
 * backing the conversation-export endpoint), keyed per caller IP, fixed at 5
 * attempts/60s. Fails open on a Redis outage like every other use of that primitive
 * in this codebase (a transient cache blip must never lock every legitimate operator
 * out entirely).
 */
export async function opsLoginAction(_prev: OpsLoginFormState, formData: FormData): Promise<OpsLoginFormState> {
  const requestHeaders = await headers();

  // Mirrors requirePlatformApi()'s fail-closed stance: an unconfigured deployment or
  // a disallowed IP gets the exact same generic failure message as a wrong token —
  // this form must never leak *why* sign-in failed to a caller who has no business
  // even confirming the console's presence.
  if (!isPlatformOpsConfigured() || !isRequestFromAllowedNetwork(requestHeaders)) {
    return { error: "Sign-in failed." };
  }

  const ip = extractClientIp(requestHeaders);
  const rateLimit = await checkRateLimit(`ops-login:${ip}`, 5, 60);
  if (!rateLimit.allowed) {
    return { error: "Too many attempts. Please wait a minute and try again." };
  }

  const token = String(formData.get("token") ?? "");
  if (!verifyOperatorToken(token)) {
    return { error: "Invalid operator token." };
  }

  const store = await cookies();
  store.set(OPS_SESSION_COOKIE, token, {
    httpOnly: true,
    // Matches this codebase's existing SESSION_COOKIE convention (`session.ts`) —
    // `Secure` is enforced in production; local http-only dev still needs to be able
    // to exercise this flow without HTTPS.
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    // QA retry 1, Defect 3 fix: this cookie must be sent on both the
    // `/internal/ops/**` *pages* and the sibling `/api/internal/ops/**` *route
    // handlers* the console's own client-side code calls (see
    // `TenantListScreen.tsx`'s `fetchJson("/api/internal/ops/tenants")`). Per RFC
    // 6265, a cookie's `Path` only ever matches that exact path or one of its
    // *descendants* — `/internal/ops` and `/api/internal/ops` are siblings, not
    // parent/child, so the previous `path: "/internal/ops"` was never sent on the
    // API calls at all (confirmed live: login succeeded, cookie was set, but the
    // Tenant List screen's own fetch sent no cookie and got the guard's 404 — the
    // whole console was unusable through a real browser). `Path=/` is the smallest
    // common ancestor of both trees; the cookie's `httpOnly`/`Secure`/
    // `SameSite=Strict` attributes already keep it from being useful to any script
    // or cross-site request, so widening only the path scope (not the actual
    // exposure) is safe.
    path: "/",
  });
  redirect("/internal/ops/tenants");
}

/** Clears the ops session cookie and sends the caller back to the login form. */
export async function opsLogoutAction(): Promise<void> {
  const store = await cookies();
  // Must match the `path` the cookie was actually `set()` with (`Path=/`, see the
  // fix comment above) — `delete()` with a mismatched `path` silently no-ops rather
  // than clearing the cookie, per the underlying `Set-Cookie` semantics.
  store.delete({ name: OPS_SESSION_COOKIE, path: "/" });
  redirect("/internal/ops/login");
}
