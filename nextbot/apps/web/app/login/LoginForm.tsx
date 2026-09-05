"use client";

import { useEffect, useRef, useState, useActionState, type CSSProperties } from "react";
import NextLink from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Card } from "@nextbot/ui/components/ui/card";
import { Separator } from "@nextbot/ui/components/ui/separator";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nextbot/ui/components/ui/tooltip";
import type { PublicTenantBrandingResponse } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";
import { loginAction, mfaChallengeAction, mfaEnrollmentConfirmAction, type LoginFormState } from "./actions";

/** Debounce window (ms) between the tenant-slug field losing focus and the
 * unauthenticated branding lookup firing — a real blur is already a natural
 * debounce point (the field only blurs once per visit-to-fill-in), but a short
 * extra delay absorbs a rapid tab-through (blur immediately followed by another
 * focus/blur cycle) without firing a lookup for every one of them. */
const BRANDING_LOOKUP_DEBOUNCE_MS = 300;

/** The graceful "no branding yet" default — the existing NextBot default look —
 * used both before the lookup resolves and whenever the tenant has no
 * white-labeled branding configured (FR-ADM-07 Part 2). */
const DEFAULT_LOGIN_BRANDING: PublicTenantBrandingResponse = {
  whiteLabelEnabled: false,
  primaryColor: null,
  accentForeground: null,
  logoUrl: null,
  tenantName: null,
};

/**
 * Login + MFA challenge/forced-enrollment (FR-ADM-01/02, FR-SEC-03), per
 * `docs/design/UX_GUIDELINES.md` §2: distinct error copy for incorrect-credentials
 * vs. lockout vs. zero-role, a password show/hide toggle, a "Forgot password?" link,
 * an honestly-inert SSO affordance, and a separate MFA-code/enrollment step.
 */
export function LoginForm() {
  const [loginState, loginFormAction, loginPending] = useActionState<LoginFormState, FormData>(loginAction, {});
  const [mfaState, mfaFormAction, mfaPending] = useActionState<LoginFormState, FormData>(
    mfaChallengeAction,
    {},
  );
  const [enrollState, enrollFormAction, enrollPending] = useActionState<LoginFormState, FormData>(
    mfaEnrollmentConfirmAction,
    {},
  );

  // QA Defect U1: `useState(loginState.mfaChallengeToken)` only evaluates its
  // initializer on the component's first render — once loginState updates after a
  // real server-action round trip, the stale `undefined` captured at mount never
  // changes, so the MFA challenge screen never renders. Deriving these directly
  // from the action states on every render (no `useState` wrapper for values that
  // are themselves derived from other state) fixes it.
  const challengeToken = mfaState.mfaChallengeToken ?? loginState.mfaChallengeToken;
  const enrollmentToken = enrollState.enrollmentToken ?? loginState.enrollmentToken;

  // Password show/hide is genuinely local, ephemeral UI state (not derived from any
  // server response), so a plain `useState` here is the correct tool — unlike the
  // bug above, there is no "server updated this and I never saw it" failure mode.
  const [showPassword, setShowPassword] = useState(false);

  // QA Defect D1: React 19's `useActionState` auto-resets the *entire* native form
  // (via `requestFormReset`) once the action settles — including uncontrolled inputs
  // like tenant/email — which wiped both fields on a failed login. UX_GUIDELINES.md
  // §2.1 requires only the password field to clear; tenant + email must survive a
  // failed attempt. Making tenant/email controlled fixes this: the DOM-level reset
  // still fires, but React reasserts the controlled `value` on the very next render,
  // so the field never visibly clears. The password field is intentionally left
  // uncontrolled — the default auto-reset behavior clearing it on failure is exactly
  // the desired outcome, so no compensation is needed there.
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");

  // FR-ADM-07 Part 2: the tenant isn't known server-side until the caller has
  // typed a tenant slug, so this screen's branding is looked up client-side once
  // the field blurs. Starts at the graceful "no branding yet" default (the
  // existing NextBot look) and only ever updates to a *resolved* lookup result —
  // never to a mid-flight/unknown state — so there is no flash of a stale
  // previous tenant's branding while a new lookup is in flight.
  const [branding, setBranding] = useState<PublicTenantBrandingResponse>(DEFAULT_LOGIN_BRANDING);
  const brandingLookupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const brandingLookupSeq = useRef(0);

  // Phase 4 (BL-36, FR-SEC-10): same debounced-on-blur lookup pattern as
  // branding, resolving whether THIS tenant has an Active SSO connection so the
  // previously-always-disabled "Sign in with SSO" affordance (QA Defect U8)
  // becomes a real link once a tenant that has configured SSO is entered —
  // never enabled by default/optimistically.
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const ssoLookupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ssoLookupSeq = useRef(0);

  // Cancels any pending debounce timer on unmount so a lookup never tries to
  // `setState` after this component is gone.
  useEffect(() => {
    return () => {
      if (brandingLookupTimer.current) clearTimeout(brandingLookupTimer.current);
      if (ssoLookupTimer.current) clearTimeout(ssoLookupTimer.current);
    };
  }, []);

  /** Debounced (see `BRANDING_LOOKUP_DEBOUNCE_MS`) unauthenticated branding
   * lookup, fired on tenant-slug field blur. A blank/whitespace-only slug never
   * fires a request (nothing to look up) and just resets to the default look. */
  function scheduleBrandingLookup(slug: string) {
    if (brandingLookupTimer.current) clearTimeout(brandingLookupTimer.current);
    const trimmed = slug.trim();
    if (!trimmed) {
      setBranding(DEFAULT_LOGIN_BRANDING);
      return;
    }
    // Guards against an in-flight lookup for a stale slug resolving *after* a
    // newer one (e.g. user blurs, edits again, blurs again) and clobbering the
    // newer result — only the most recently *scheduled* lookup's response is
    // ever applied.
    const seq = ++brandingLookupSeq.current;
    brandingLookupTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await fetchJson<PublicTenantBrandingResponse>(
            `/api/v1/public/tenant-branding/${encodeURIComponent(trimmed)}`,
          );
          if (seq !== brandingLookupSeq.current) return; // superseded by a newer lookup
          setBranding(result.kind === "ok" ? result.data : DEFAULT_LOGIN_BRANDING);
        } catch {
          // A network failure (fetch() itself rejecting, not just a non-2xx
          // response — `fetchJson` only guards the latter) must never leave this
          // screen half-branded or throw into the render tree — falls back to the
          // same graceful default look as a "not white-labeled" response.
          if (seq === brandingLookupSeq.current) setBranding(DEFAULT_LOGIN_BRANDING);
        }
      })();
    }, BRANDING_LOOKUP_DEBOUNCE_MS);
  }

  /** Debounced SSO-availability lookup, fired alongside the branding lookup on
   * tenant-slug blur (same debounce window, same "never trust a stale response"
   * sequencing guard). */
  function scheduleSsoStatusLookup(slug: string) {
    if (ssoLookupTimer.current) clearTimeout(ssoLookupTimer.current);
    const trimmed = slug.trim();
    if (!trimmed) {
      setSsoEnabled(false);
      return;
    }
    const seq = ++ssoLookupSeq.current;
    ssoLookupTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await fetchJson<{ enabled: boolean }>(`/api/v1/public/sso-status/${encodeURIComponent(trimmed)}`);
          if (seq !== ssoLookupSeq.current) return;
          setSsoEnabled(result.kind === "ok" && result.data.enabled);
        } catch {
          if (seq === ssoLookupSeq.current) setSsoEnabled(false);
        }
      })();
    }, BRANDING_LOOKUP_DEBOUNCE_MS);
  }

  // Applied to the card wrapping every step of this flow (login / MFA challenge /
  // MFA enrollment) so the same lookup, done once on the initial login step,
  // keeps the accent consistent through the whole sign-in flow. Reuses the exact
  // `--brand-accent`/`--brand-accent-foreground` tokens from Part 1 (never a
  // third token name) — set as a scoped inline style on this card only, never on
  // `:root`, since this is a client-side lookup applied to one component, not the
  // server-rendered whole-document override the Admin Console shell uses.
  const brandCardStyle = branding.whiteLabelEnabled
    ? ({
        "--brand-accent": branding.primaryColor,
        "--brand-accent-foreground": branding.accentForeground,
      } as CSSProperties)
    : undefined;
  const brandButtonStyle = branding.whiteLabelEnabled
    ? { backgroundColor: "var(--brand-accent)", color: "var(--brand-accent-foreground)" }
    : undefined;

  // QA Defect U9: lockout must be visually and behaviorally distinct from a wrong
  // password — a `warning`-tier alert (not `error`/`destructive`-tier) and every
  // control disabled for the cooldown window (re-enabled on next page load/retry
  // per the UX guidelines' explicit "no live countdown" rule).
  const isLockedOut = loginState.errorKind === "locked";

  // QA Defect D2: a failed action must move focus to the error `Alert` so
  // screen-reader users get an unambiguous signal an error occurred (UX_GUIDELINES.md
  // §2.1) — `role="alert"` alone is not a reliable substitute for an explicit focus
  // move on every combination of screen reader/browser. Each of the three forms below
  // (login / MFA challenge / MFA enrollment confirm) gets its own ref + effect pair
  // since each renders its own independent error `Alert`.
  const loginErrorRef = useRef<HTMLDivElement>(null);
  const mfaErrorRef = useRef<HTMLDivElement>(null);
  const enrollErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loginState.error) loginErrorRef.current?.focus();
  }, [loginState.error]);
  useEffect(() => {
    if (mfaState.error) mfaErrorRef.current?.focus();
  }, [mfaState.error]);
  useEffect(() => {
    if (enrollState.error) enrollErrorRef.current?.focus();
  }, [enrollState.error]);

  // QA Defect B3: a role requiring MFA forces enrollment before login completes.
  // The QR/setup URI and backup codes are shown exactly once, at this step.
  if (enrollmentToken) {
    return (
      <Card className="mx-auto mt-16 max-w-md p-8" style={brandCardStyle}>
        <main role="main">
          <h1 className="mb-4 font-heading text-lg font-semibold">Set up multi-factor authentication</h1>
          <p className="mb-4 text-muted-foreground">
            Your role requires multi-factor authentication. Scan this setup key in your authenticator app (Google
            Authenticator, 1Password, etc.):
          </p>
          {loginState.otpauthUri && (
            <code className="mb-4 block overflow-hidden rounded-none border bg-muted p-3 text-xs break-all whitespace-pre-wrap">
              {loginState.otpauthUri}
            </code>
          )}
          <p className="mb-2 font-bold">Save these one-time backup codes now — they will not be shown again:</p>
          <ul className="mb-6 font-mono text-sm">
            {loginState.backupCodes?.map((code) => <li key={code}>{code}</li>)}
          </ul>
          <form action={enrollFormAction}>
            <input type="hidden" name="enrollmentToken" value={enrollmentToken} />
            <div className="flex flex-col gap-4">
              <div>
                <Label htmlFor="enroll-code">Enter the 6-digit code from your authenticator app to confirm</Label>
                <Input
                  id="enroll-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  required
                  className="mt-1"
                />
              </div>
              {enrollState.error && (
                <Alert ref={enrollErrorRef} tabIndex={-1} variant="destructive" aria-live="assertive">
                  <AlertDescription>{enrollState.error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={enrollPending} style={brandButtonStyle}>
                Confirm &amp; sign in
              </Button>
            </div>
          </form>
        </main>
      </Card>
    );
  }

  if (challengeToken) {
    return (
      <Card className="mx-auto mt-20 max-w-sm p-8" style={brandCardStyle}>
        <main role="main">
          <h1 className="mb-6 font-heading text-lg font-semibold">Verify your identity</h1>
          <form action={mfaFormAction}>
            <input type="hidden" name="challengeToken" value={challengeToken} />
            <div className="flex flex-col gap-4">
              <div>
                <Label htmlFor="mfa-code">6-digit authenticator code (or a backup code)</Label>
                <Input
                  id="mfa-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  required
                  className="mt-1"
                />
              </div>
              {mfaState.error && (
                <Alert ref={mfaErrorRef} tabIndex={-1} variant="destructive" aria-live="assertive">
                  <AlertDescription>{mfaState.error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={mfaPending} style={brandButtonStyle}>
                Verify
              </Button>
            </div>
          </form>
        </main>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-20 max-w-sm p-8" style={brandCardStyle}>
      <main role="main">
        {/* FR-ADM-07 Part 2: the tenant's logo replaces the NextBot wordmark once
            the branding lookup resolves for a white-labeled tenant — falling back
            to the plain "Sign in to NextBot" heading (this project's existing
            default look) before the lookup resolves or for an unbranded/nonexistent
            tenant slug. The <h1> landmark itself is always present (never dropped)
            so screen-reader users get the same page-title structure either way —
            only its visible content swaps. A plain <img>, matching AdminShell's own
            logo rendering (Base UI's AvatarImage never resolves for a
            synchronously-decoded image in a test/jsdom environment — see that
            file's identical comment). */}
        <h1 className="mb-6 flex items-center gap-2 font-heading text-lg font-semibold">
          {branding.whiteLabelEnabled && branding.logoUrl ? (
            <>
              <img src={branding.logoUrl} alt="Company logo" className="size-8 rounded-full object-cover" />
              {`Sign in to ${branding.tenantName ?? "your account"}`}
            </>
          ) : (
            "Sign in to NextBot"
          )}
        </h1>
        <form action={loginFormAction}>
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="login-tenant">Tenant</Label>
              <Input
                id="login-tenant"
                name="tenantSlug"
                placeholder="your-company"
                autoComplete="organization"
                disabled={isLockedOut}
                required
                className="mt-1"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                onBlur={(e) => {
                  scheduleBrandingLookup(e.target.value);
                  scheduleSsoStatusLookup(e.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                disabled={isLockedOut}
                required
                className="mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="login-password">Password</Label>
              {/* QA Defect U8: password show/hide toggle, a real button with
                  aria-pressed, not a bare icon div. */}
              <div className="relative mt-1">
                <Input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  disabled={isLockedOut}
                  required
                  className="pe-9"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  disabled={isLockedOut}
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute end-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-none text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <HugeiconsIcon icon={showPassword ? ViewOffIcon : ViewIcon} size={16} strokeWidth={2} />
                </button>
              </div>
            </div>

            <NextLink href="/forgot-password" className="self-start text-sm underline-offset-4 hover:underline">
              Forgot password?
            </NextLink>

            {loginState.error && (
              <Alert
                ref={loginErrorRef}
                tabIndex={-1}
                variant={isLockedOut ? "warning" : "destructive"}
                aria-live="assertive"
              >
                <AlertDescription>{loginState.error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loginPending || isLockedOut} style={brandButtonStyle}>
              Sign in
            </Button>

            <Separator />

            {/* Phase 4 (BL-36, FR-SEC-10): once `scheduleSsoStatusLookup` resolves
                `ssoEnabled` for the entered tenant, this becomes a real link to the
                SP-initiated SSO flow (`/api/sso/{slug}/login`) — full page
                navigation (not a client fetch), since it's a redirect to the IdP.
                Until then (or for a tenant with no Active SSO connection), QA
                Defect U8's "honestly inert" disabled affordance is preserved
                unchanged so its eventual presence is never a surprise. */}
            {ssoEnabled && tenantSlug.trim() ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                render={<a href={`/api/sso/${encodeURIComponent(tenantSlug.trim())}/login`}>Sign in with SSO</a>}
              />
            ) : (
              <Tooltip>
                {/* QA Defect D3: without an explicit `id`, Base UI's `useBaseUiId()`
                    falls back to `React.useId()`, which is only guaranteed stable
                    across the server render and the client hydration render when the
                    surrounding tree shape matches exactly on both passes. Pinning a
                    literal, hardcoded id here removes that dependency entirely so
                    there's no possible server/client divergence — the safest fix
                    since this trigger is a singleton on the page (no risk of a
                    duplicate-id collision). */}
                <TooltipTrigger
                  id="login-sso-tooltip-trigger"
                  render={
                    <span className="inline-block w-full" tabIndex={0}>
                      <Button type="button" variant="outline" disabled aria-disabled="true" className="w-full">
                        Sign in with SSO
                      </Button>
                    </span>
                  }
                />
                <TooltipContent>SSO isn&apos;t configured for your organization yet</TooltipContent>
              </Tooltip>
            )}
          </div>
        </form>
      </main>
    </Card>
  );
}
