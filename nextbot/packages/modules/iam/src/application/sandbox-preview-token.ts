import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { SandboxPreviewInvalidError } from "@nextbot/contracts";

/**
 * Phase 6 (client-feedback-batch item 9) — the Admin Console -> Gateway Plane
 * authorization hand-off for the "test in sandbox before promoting" chat preview.
 *
 * **Why this exists as its own signed token, rather than the widget simply trusting
 * a `previewVersionId` field on its session-init request**: the widget's own session
 * endpoint (`apps/gateway`'s `POST /widget/sessions`) is deliberately anonymous and
 * pre-auth (LLD §5.3) — any real customer's page can call it. If that endpoint
 * honored a bare `previewVersionId` override with no independent proof, anyone who
 * discovered the query parameter could view an unpromoted Draft version's
 * instructions/guardrails, a real information-disclosure risk this project's own
 * conventions require treating as an auth boundary, not a convenience shortcut.
 *
 * This token is minted by `apps/web` (the Admin Console's own composition root, the
 * only place that can call `requireApi("agent_platform", "Write")` against the
 * caller's real `nb_session` cookie) and handed to the browser, which threads it
 * through the widget iframe's config into its session-init call. `apps/gateway`'s
 * session route (a *different* app, but the only place both `@nextbot/conversations`
 * and `@nextbot/iam` may be imported together — LLD §2.3's module allow-list has no
 * `conversations -> iam` edge, so this verification cannot live inside the
 * `conversations` module itself) verifies it there, independently, before ever
 * honoring the override — see `create-widget-session.ts`'s doc for the full chain.
 *
 * Entirely distinct signing purpose from every other token this module issues
 * (`SessionClaims`, `MfaChallengeClaims`) — same shared `NEXTBOT_SESSION_SECRET`
 * signing key (this *is* an Admin Console credential, unlike the separately-secreted
 * anonymous `WidgetSessionClaims`), but a `purpose` claim checked on every verify so
 * none of these token kinds can ever be replayed as one of the others even if a
 * caller obtains one and tries it against the wrong endpoint.
 */
export interface SandboxPreviewClaims extends JWTPayload {
  purpose: "sandbox_preview";
  tenantId: string;
  userId: string;
  /** The exact `agent_definition_version.id` this token authorizes previewing —
   * checked for an exact match against the widget session request's own
   * `previewVersionId`, never treated as "any version this tenant owns." */
  versionId: string;
}

const ALG = "HS256";
/** Short-lived by design: this token only needs to survive the round trip from
 * "operator clicks Test in Sandbox" to "the preview iframe's first session-init
 * call" — a few seconds in practice. 15 minutes covers a slow page load/retry
 * without leaving a long-lived privileged credential sitting in the DOM/URL. */
const SANDBOX_PREVIEW_TTL_SECONDS = 15 * 60;

function getSigningKey(): Uint8Array {
  const secret = process.env.NEXTBOT_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "NEXTBOT_SESSION_SECRET must be set to a string of at least 32 characters (startup config failure, per LLD §11.10).",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Issues a sandbox-preview token. Callers **must** have already independently
 * verified the caller's Admin Console session and `agent_platform: Write`
 * permission (`requireApi`) and that `versionId` genuinely belongs to `tenantId`
 * (e.g. via `handleGetVersion`, which is itself tenant-scoped via RLS) before calling
 * this — this function performs no authorization of its own, it only signs the
 * already-authorized claim.
 */
export async function issueSandboxPreviewToken(tenantId: string, userId: string, versionId: string): Promise<string> {
  return new SignJWT({ purpose: "sandbox_preview", tenantId, userId, versionId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${SANDBOX_PREVIEW_TTL_SECONDS}s`)
    .sign(getSigningKey());
}

/**
 * Verifies and decodes a sandbox-preview token.
 * @throws {SandboxPreviewInvalidError} on any verification failure — expired,
 *   tampered, malformed, or issued for a different purpose. Deliberately the *same*
 *   error for every failure mode (never distinguishes "expired" from "tampered" in
 *   the response) so a probing caller learns nothing about why a guess failed.
 */
export async function verifySandboxPreviewToken(token: string): Promise<SandboxPreviewClaims> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), { algorithms: [ALG] });
    if (payload.purpose !== "sandbox_preview") throw new Error("wrong purpose");
    return payload as SandboxPreviewClaims;
  } catch {
    throw new SandboxPreviewInvalidError();
  }
}
