"use client";

import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";

/**
 * FR-ADM-02: "SSO group mapping can auto-assign roles." The `sso_group_mapping`
 * table (LLD §3.3) and its RBAC-role foreign key already exist — schema-ready — but
 * no real SAML/OAuth2 identity-provider integration exists in this codebase (same
 * disclosed-limitation class as the login screen's inert "Sign in with SSO" button,
 * QA Defect U8). Faking a working SAML/OAuth2 provider-config form here would create
 * a UI that appears functional but silently does nothing end-to-end, so this section
 * is an honest, clearly-labeled "not yet configured" placeholder rather than a
 * fabricated config screen — consistent with the Git-connect and MFA-SMS-stub
 * precedents already established elsewhere in this codebase.
 */
export function SsoGroupMappingSection() {
  return (
    <div>
      <h2 className="mb-3 font-heading text-base font-semibold">SSO &amp; Group Mapping</h2>
      <Alert>
        <AlertDescription>
          SSO (SAML/OAuth2) isn&apos;t configured for this tenant yet. Once an identity provider is connected, group-to-role
          mapping will appear here so IdP groups can auto-assign Admin Console roles on login.
        </AlertDescription>
      </Alert>
    </div>
  );
}
