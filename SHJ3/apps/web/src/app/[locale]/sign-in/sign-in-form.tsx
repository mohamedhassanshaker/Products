"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import type {
  CompleteTotpActionInput,
  CompleteTotpActionResult,
  SignInActionInput,
  SignInActionResult,
} from "./actions.js";

export interface SignInFormTranslations {
  readonly pageTitle: string;
  readonly tagline: string;
  readonly emailLabel: string;
  readonly passwordLabel: string;
  readonly submit: string;
  readonly submitting: string;
  readonly totpHeading: string;
  readonly totpIntro: string;
  readonly totpCodeLabel: string;
  readonly totpSubmit: string;
  readonly totpSubmitting: string;
  readonly backToPassword: string;
  readonly errorInvalidCredentials: string;
  readonly errorLocked: string;
  readonly errorTotpInvalid: string;
  readonly errorEnrolmentRequired: string;
  readonly errorUnknownSubject: string;
  readonly errorNetwork: string;
}

export interface SignInFormActions {
  readonly signIn: (input: SignInActionInput) => Promise<SignInActionResult>;
  readonly completeTotp: (input: CompleteTotpActionInput) => Promise<CompleteTotpActionResult>;
  readonly startOver: () => Promise<void>;
}

export interface SignInFormProps {
  /** Already validated same-app path (`page.tsx`'s `sanitizeNextPath`) — where a successful sign-in lands. */
  readonly nextPath: string;
  readonly translations: SignInFormTranslations;
  readonly actions: SignInFormActions;
}

type Step = { readonly kind: "password" } | { readonly kind: "totp"; readonly challengeId: string };

/**
 * The real two-step sign-in form: email + password (api.md §3.2's password
 * step), then — only when `signInAction` reports `totp_required` — a 6-digit
 * authenticator code (the second factor). Both steps post to the same real
 * `SignIn`/`CompleteTotpChallenge` use cases via `page.tsx`'s Server Actions;
 * there is no mock branch and no client-side credential check of any kind — a
 * wrong password or a wrong code only ever comes back as a real rejection from
 * the real identity provider.
 *
 * Local `useState` step machine rather than the App Router's own navigation,
 * matching `new-agent-form.tsx`'s established convention for a short, linear,
 * client-only flow: the TOTP step's own `challengeId` lives in React state, not
 * the URL, so it is never bookmarked, logged, or replayable from browser history.
 */
export function SignInForm({
  nextPath,
  translations: t,
  actions,
}: SignInFormProps): React.ReactElement {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>({ kind: "password" });
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handlePasswordSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setPending(true);
    setError(null);

    void actions
      .signIn({ identifier: email, secret: password })
      .then((result) => {
        switch (result.kind) {
          case "signed_in":
            router.push(nextPath);
            return;
          case "totp_required":
            setStep({ kind: "totp", challengeId: result.challengeId });
            setPending(false);
            return;
          case "rejected":
            setError(result.reason === "locked" ? t.errorLocked : t.errorInvalidCredentials);
            setPending(false);
            return;
          case "enrolment_required":
            setError(t.errorEnrolmentRequired);
            setPending(false);
            return;
          case "unknown_subject":
            setError(t.errorUnknownSubject);
            setPending(false);
            return;
        }
      })
      .catch(() => {
        setError(t.errorNetwork);
        setPending(false);
      });
  }

  function handleTotpSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (step.kind !== "totp") return;
    setPending(true);
    setError(null);

    void actions
      .completeTotp({ challengeId: step.challengeId, code })
      .then((result) => {
        if (result.kind === "signed_in") {
          router.push(nextPath);
          return;
        }
        // One honest, undifferentiated reason (matches `CompleteTotpChallenge`'s own doc
        // comment) — wrong code, replayed code, or an expired/burned challenge all read
        // identically here, and "start over" below is the correct escape hatch for all of them.
        setError(t.errorTotpInvalid);
        setCode("");
        setPending(false);
      })
      .catch(() => {
        setError(t.errorNetwork);
        setPending(false);
      });
  }

  function handleStartOver(): void {
    setError(null);
    setCode("");
    setPassword("");
    setStep({ kind: "password" });
    void actions.startOver();
  }

  return (
    <Card
      className="w-full"
      // `max-w-sm` was a dead class, not a design choice: this bridge's own
      // reset clears Tailwind v4's `--container-*` namespace and never
      // re-maps it (tailwind-theme.ts, ADR-0007 "replace, not extend") — a
      // confirmed-empty gap this codebase already documents at
      // `diagnostics-rail.tsx` and already works around the identical way at
      // `settings/appearance/reset/page.tsx`'s own `CARD_STYLE.maxWidth`. A
      // real Playwright screenshot caught the card rendering at full
      // viewport width before this fix — `max-w-sm`'s own real value
      // (24rem/384px) is reproduced here as a literal `rem`, unaffected by
      // the token gate's `px|pt|em`-only length pattern, the same as
      // `tooltip.tsx`/`dialog.tsx`'s un-tokenised content widths.
      //
      // A full-page auth screen also has nothing else competing for depth,
      // so the card's own default `shadow-sm` (design-system.md §4.8's
      // "card, KPI tile" elevation, tuned for a card sitting among many
      // others in a list) reads as too flat here — `--shadow-lg` ("docked
      // widget shell, sheet") is the reasoned bump for the one surface on
      // the entire screen. `--space-6` gives the roomier padding a
      // standalone auth card warrants over a list-row card's
      // `--card-padding` default. Both are real tokens, overridden the same
      // way card.tsx's own doc comment prescribes (its inline `style`
      // pattern).
      style={{
        maxWidth: "24rem",
        padding: "var(--space-6)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <CardHeader>
        <CardTitle level={1} className="text-xl leading-tight">
          {t.pageTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground" style={{ marginBottom: "var(--space-4)" }}>
          {t.tagline}
        </p>

        {error ? (
          <InlineAlert variant="destructive" style={{ marginBottom: "var(--space-4)" }}>
            {error}
          </InlineAlert>
        ) : null}

        {step.kind === "password" ? (
          <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit}>
            <FormField label={t.emailLabel}>
              {(field) => (
                <Input
                  {...field}
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={pending}
                  required
                />
              )}
            </FormField>
            <FormField label={t.passwordLabel}>
              {(field) => (
                <Input
                  {...field}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={pending}
                  required
                />
              )}
            </FormField>
            <Button
              type="submit"
              loading={pending}
              disabled={email.trim().length === 0 || password.length === 0}
            >
              {pending ? t.submitting : t.submit}
            </Button>
          </form>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleTotpSubmit}>
            <h2 className="text-sm font-semibold text-foreground">{t.totpHeading}</h2>
            <p className="text-sm text-muted-foreground">{t.totpIntro}</p>
            <FormField label={t.totpCodeLabel}>
              {(field) => (
                <Input
                  {...field}
                  variant="mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={pending}
                  required
                />
              )}
            </FormField>
            <Button type="submit" loading={pending} disabled={code.length !== 6}>
              {pending ? t.totpSubmitting : t.totpSubmit}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleStartOver}
              disabled={pending}
            >
              {t.backToPassword}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
