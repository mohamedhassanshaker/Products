import Link from "next/link";
import { Button } from "@/components/ui/button";

export interface SignInPromptProps {
  /** The page's own heading — usually the same `t("pageTitle")` the authenticated view renders. */
  readonly heading: React.ReactNode;
  /** Why signing in is required, in the page's own words. */
  readonly message: React.ReactNode;
  /** `/{locale}/sign-in?next=...` — already carries the page's own path as the post-sign-in destination. */
  readonly signInHref: string;
  readonly signInLabel: string;
}

/**
 * The unauthenticated-state content every gated backoffice/settings screen
 * renders when `withStaffAuth()` throws `UnauthenticatedError` — the same
 * heading + message shape every one of those ~14 pages already used before
 * `/sign-in` existed (a dead-end paragraph with nowhere to go), now also
 * carrying a real link there.
 *
 * Deliberately renders only the inner content (a `Fragment`, no wrapping
 * element) rather than owning a `<div>`/`<main>` container: every call site
 * already has its own wrapper (some `<div className="flex flex-col gap-4">`,
 * `settings/appearance/page.tsx`'s own `<main className="... p-6">`), and this
 * component's job is to keep the *content* mechanically consistent across all
 * of them without forcing a second, competing container choice onto pages that
 * already made one. `appearance/reset/page.tsx` is the one gated screen that
 * deliberately does NOT use this component — see that file's own doc comment on
 * why it renders every element as literal, token-independent inline styles.
 */
export function SignInPrompt({
  heading,
  message,
  signInHref,
  signInLabel,
}: SignInPromptProps): React.ReactElement {
  return (
    <>
      <h1 className="text-lg font-semibold text-foreground">{heading}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild className="self-start">
        <Link href={signInHref}>{signInLabel}</Link>
      </Button>
    </>
  );
}
