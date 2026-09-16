"use server";

/**
 * Server Actions backing `SignInForm` — the thin, client-facing translation of
 * `next-request-context.ts`'s real `signInWithPassword`/
 * `completeTotpChallengeFromCookie`/`clearStaffSessionCookie` into the small
 * result shapes a Client Component actually needs.
 *
 * Deliberately does **not** re-export the raw `SignInResult`/
 * `CompleteTotpChallengeResult` unions to the client: those carry
 * `sessionId`/`partialSessionId`, which already live in the (`httpOnly`, so
 * client-JS-unreadable) cookie the underlying functions set — sending them to
 * the browser again would be a value with no honest use, and the one field the
 * client genuinely needs across the two steps (`challengeId`, `SignInResult`'s
 * own `totp_required` case) is threaded through explicitly instead.
 */

import {
  clearStaffSessionCookie,
  completeTotpChallengeFromCookie,
  signInWithPassword,
  signOutCurrentSession,
} from "../../../modules/iam/adapters/inbound/next-request-context.js";

export type SignInActionResult =
  | { readonly kind: "signed_in" }
  | { readonly kind: "totp_required"; readonly challengeId: string }
  | { readonly kind: "rejected"; readonly reason: "invalid_credentials" | "locked" }
  | { readonly kind: "enrolment_required" }
  | { readonly kind: "unknown_subject" };

export interface SignInActionInput {
  readonly identifier: string;
  readonly secret: string;
}

export async function signInAction(input: SignInActionInput): Promise<SignInActionResult> {
  const result = await signInWithPassword(input);

  switch (result.kind) {
    case "signed_in":
      return { kind: "signed_in" };
    case "totp_required":
      return { kind: "totp_required", challengeId: result.challengeId };
    case "rejected":
      return { kind: "rejected", reason: result.reason };
    case "enrolment_required":
      return { kind: "enrolment_required" };
    case "unknown_subject":
      return { kind: "unknown_subject" };
  }
}

export type CompleteTotpActionResult =
  { readonly kind: "signed_in" } | { readonly kind: "rejected" };

export interface CompleteTotpActionInput {
  readonly challengeId: string;
  readonly code: string;
}

export async function completeTotpAction(
  input: CompleteTotpActionInput,
): Promise<CompleteTotpActionResult> {
  const result = await completeTotpChallengeFromCookie(input);
  return result.kind === "signed_in" ? { kind: "signed_in" } : { kind: "rejected" };
}

/** Restart at the password step — clears the partial-session cookie the TOTP step was reading. */
export async function startOverAction(): Promise<void> {
  await clearStaffSessionCookie();
}

/**
 * A real sign-out — the `(backoffice)` and `(platform-admin)` shells' own "Sign out"
 * control. Passed down from each layout (a Server Component) to its client shell as a
 * plain function reference; Next.js lets a Server Action cross that boundary this way.
 */
export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();
}
