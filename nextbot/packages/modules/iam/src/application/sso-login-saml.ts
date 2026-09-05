import { SAML } from "@node-saml/node-saml";
import { SsoAuthenticationFailedError, SsoNotConfiguredError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { getSsoConnection, type SsoConnectionRow } from "../infrastructure/sso-connection-repository.js";

/**
 * SAML SSO (FR-SEC-10) via `@node-saml/node-saml` (MIT, maintained fork of
 * `passport-saml`, used standalone here rather than through Passport middleware
 * — this module needs exactly two operations, "build the redirect" and "validate
 * the POSTed response," both of which the `SAML` class exposes directly).
 *
 * `wantAssertionsSigned: true` is non-negotiable: it is the library's own
 * signature-verification gate — without it, a crafted, unsigned assertion could
 * be accepted as if it came from the real IdP. This is the exact adversarial
 * case the security review calls out.
 */
function buildSamlClient(connection: SsoConnectionRow, callbackUrl: string): SAML {
  if (!connection.samlEntryPoint || !connection.samlIdpCertificate || !connection.samlIssuer) {
    throw new SsoNotConfiguredError();
  }
  return new SAML({
    entryPoint: connection.samlEntryPoint,
    idpCert: connection.samlIdpCertificate,
    issuer: connection.samlIssuer,
    callbackUrl,
    wantAssertionsSigned: true,
    // The library defaults `audience` to `issuer` when unset, which is exactly
    // this SP's own entity id — an assertion issued for a different SP audience
    // is rejected by the library's own `checkAudienceValidityError`.
  });
}

async function loadActiveSamlConnection(ctx: TenantContext): Promise<SsoConnectionRow> {
  const connection = await getSsoConnection(ctx);
  if (!connection || connection.protocol !== "Saml" || connection.status !== "Active") {
    throw new SsoNotConfiguredError();
  }
  return connection;
}

/** Builds the IdP-bound redirect URL that starts the SAML flow (SP-initiated). */
export async function buildSamlAuthorizeUrl(ctx: TenantContext, callbackUrl: string, relayState: string): Promise<string> {
  const connection = await loadActiveSamlConnection(ctx);
  const saml = buildSamlClient(connection, callbackUrl);
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

export interface SamlCallbackResult {
  nameId: string;
  email: string | null;
  groups: string[];
  connection: SsoConnectionRow;
}

/**
 * Validates a POSTed SAML response (the ACS endpoint's job). Any failure —
 * invalid/missing signature, expired assertion, audience mismatch, malformed
 * XML — is collapsed to the single generic `SsoAuthenticationFailedError`,
 * exactly like the OIDC callback path, so neither protocol leaks which specific
 * validation step failed.
 *
 * @throws {SsoAuthenticationFailedError} on any validation failure.
 */
export async function completeSamlCallback(
  ctx: TenantContext,
  callbackUrl: string,
  body: Record<string, string>,
): Promise<SamlCallbackResult> {
  try {
    const connection = await loadActiveSamlConnection(ctx);
    const saml = buildSamlClient(connection, callbackUrl);
    const { profile, loggedOut } = await saml.validatePostResponseAsync(body);
    if (loggedOut || !profile?.nameID) throw new Error("no valid profile in SAML response");

    const attrs = profile as unknown as Record<string, unknown>;
    const groupAttr = connection.groupClaimName ? attrs[connection.groupClaimName] : undefined;
    const groups = Array.isArray(groupAttr)
      ? groupAttr.filter((g): g is string => typeof g === "string")
      : typeof groupAttr === "string"
        ? [groupAttr]
        : [];

    return {
      nameId: profile.nameID,
      email: typeof attrs.email === "string" ? attrs.email : (profile.nameID.includes("@") ? profile.nameID : null),
      groups,
      connection,
    };
  } catch (err) {
    if (err instanceof SsoNotConfiguredError) throw err;
    throw new SsoAuthenticationFailedError();
  }
}
