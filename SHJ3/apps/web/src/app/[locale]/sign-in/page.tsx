import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { UnauthenticatedError } from "../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../modules/iam/adapters/inbound/next-request-context.js";
import { SignInForm } from "./sign-in-form.js";
import { completeTotpAction, signInAction, startOverAction } from "./actions.js";

/** The backoffice's own "home" — the first item `(backoffice)/layout.tsx`'s `navItems` lists. */
function defaultDestination(locale: string): string {
  return `/${locale}/command-centre`;
}

/**
 * Only a path that stays inside this app's own `{locale}` tree is honoured as a
 * post-sign-in redirect target — never an absolute URL or a protocol-relative
 * one (`//attacker.example`, which a browser resolves as an absolute URL to a
 * different host despite looking like a path). Every `?next=` value this app
 * itself generates (`SignInPrompt`'s call sites) is already exactly this shape;
 * this function's real job is refusing anything a visitor typed or forged by
 * hand into the URL bar.
 */
function sanitizeNextPath(next: string | undefined, locale: string): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (next !== `/${locale}` && !next.startsWith(`/${locale}/`)) return null;
  return next;
}

/**
 * `/{locale}/sign-in` — the real sign-in page this project's own doc comments
 * have named as missing since B-2 (`mint-session.ts`, `PrismaCredentialRepository`).
 * Deliberately outside the `(backoffice)` route group: that group's own layout
 * renders `AppShell` chrome assuming a signed-in visitor, and — per that layout's
 * own doc comment — carries no auth check of its own, so a page under it that
 * must be reachable while fully unauthenticated does not belong there.
 *
 * ## The two-step flow, and why both steps are the same route
 *
 * Password, then (when required) a TOTP code — api.md §3.2's own two endpoints
 * folded into one page with local step state, matching how `agents/new` already
 * uses one route for what is conceptually step 1 of a larger flow. The password
 * step's own partial-session cookie (`next-request-context.ts`'s
 * `signInWithPassword`) is what the TOTP step reads back — no client-held secret
 * crosses the two steps, only the opaque `challengeId` `SignInResult` itself
 * returns.
 *
 * ## Already signed in
 *
 * A visitor who already holds a valid session has no reason to see a login form
 * — redirected straight to `next` (or the backoffice home) instead, the same way
 * a real product's own `/login` route behaves.
 */
export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  const nextPath = sanitizeNextPath(next, locale);

  let alreadySignedIn = false;
  try {
    await withStaffAuth(async () => undefined);
    alreadySignedIn = true;
  } catch (error) {
    if (!(error instanceof UnauthenticatedError)) throw error;
  }
  if (alreadySignedIn) {
    redirect(nextPath ?? defaultDestination(locale));
  }

  const t = await getTranslations("signIn");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface-sunken p-4 text-foreground">
      {/*
       * The real brand mark for this one unauthenticated route (see this
       * file's own module comment on why `(backoffice)`'s AppShellLogo isn't
       * reachable here: no tenant/session context exists pre-login). A plain
       * text wordmark using real tokens — no fabricated logo asset — matching
       * this app's own "no fabricated assets" discipline. `dir="ltr"`
       * unconditionally, the same reasoning as `Input`'s `mono` variant: a
       * Latin brand mark must not be reordered by surrounding RTL prose on
       * `/ar/sign-in`.
       */}
      <span
        dir="ltr"
        className="text-2xl leading-tight font-bold text-primary"
        style={{ letterSpacing: "var(--tracking-tight)" }}
      >
        SHJ3
      </span>
      <SignInForm
        nextPath={nextPath ?? defaultDestination(locale)}
        translations={{
          pageTitle: t("pageTitle"),
          tagline: t("tagline"),
          emailLabel: t("emailLabel"),
          passwordLabel: t("passwordLabel"),
          submit: t("submit"),
          submitting: t("submitting"),
          totpHeading: t("totpHeading"),
          totpIntro: t("totpIntro"),
          totpCodeLabel: t("totpCodeLabel"),
          totpSubmit: t("totpSubmit"),
          totpSubmitting: t("totpSubmitting"),
          backToPassword: t("backToPassword"),
          errorInvalidCredentials: t("errors.invalidCredentials"),
          errorLocked: t("errors.locked"),
          errorTotpInvalid: t("errors.totpInvalid"),
          errorEnrolmentRequired: t("errors.enrolmentRequired"),
          errorUnknownSubject: t("errors.unknownSubject"),
          errorNetwork: t("errors.network"),
        }}
        actions={{
          signIn: signInAction,
          completeTotp: completeTotpAction,
          startOver: startOverAction,
        }}
      />
    </div>
  );
}
