"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Card } from "@nextbot/ui/components/ui/card";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface SsoConnection {
  id: string;
  protocol: "Saml" | "Oidc";
  displayName: string;
  status: "Disabled" | "Active";
  jitProvisioningEnabled: boolean;
  defaultRoleId: string | null;
  groupClaimName: string | null;
  oidcIssuerUrl: string | null;
  oidcClientId: string | null;
  oidcClientSecretSet: boolean;
  samlEntryPoint: string | null;
  samlIssuer: string | null;
  samlIdpCertificateSet: boolean;
}
interface RoleOption {
  id: string;
  name: string;
}
interface GroupMapping {
  id: string;
  externalGroup: string;
  roleId: string;
}

const EMPTY_FORM = {
  protocol: "Oidc" as "Saml" | "Oidc",
  displayName: "",
  jitProvisioningEnabled: true,
  defaultRoleId: "",
  groupClaimName: "groups",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  samlEntryPoint: "",
  samlIssuer: "",
  samlIdpCertificate: "",
};

/**
 * Single Sign-On & SCIM console (Phase 4, BL-36, FR-SEC-10) — IdP connection
 * config (SAML/OIDC), group→role mapping, and the SCIM bearer-token lifecycle.
 * A connection saved via this screen is always `Disabled` until explicitly
 * activated (fail-closed — see `application/sso-connection.ts`'s doc), so this
 * screen exposes that as two distinct actions ("Save configuration" then
 * "Activate"), never one combined "Save & go live" button.
 */
export function SsoSettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [connection, setConnection] = useState<SsoConnection | null | undefined>(undefined);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [mappings, setMappings] = useState<GroupMapping[]>([]);
  const [scimActive, setScimActive] = useState(false);
  const [issuedScimToken, setIssuedScimToken] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newMapping, setNewMapping] = useState({ externalGroup: "", roleId: "" });

  async function reload() {
    setError(null);
    const [connResult, rolesResult, mappingResult, scimResult] = await Promise.all([
      fetchJson<SsoConnection | null>("/api/v1/admin/sso/connection"),
      fetchJson<{ roles: RoleOption[] }>("/api/v1/admin/roles"),
      fetchJson<GroupMapping[]>("/api/v1/admin/sso/group-mappings"),
      fetchJson<{ active: boolean }>("/api/v1/admin/scim-token"),
    ]);
    if (connResult.kind === "forbidden") return setForbidden(true);
    if (connResult.kind === "error") return setError(connResult.message);
    setConnection(connResult.data);
    if (connResult.data) {
      setForm({
        protocol: connResult.data.protocol,
        displayName: connResult.data.displayName,
        jitProvisioningEnabled: connResult.data.jitProvisioningEnabled,
        defaultRoleId: connResult.data.defaultRoleId ?? "",
        groupClaimName: connResult.data.groupClaimName ?? "",
        oidcIssuerUrl: connResult.data.oidcIssuerUrl ?? "",
        oidcClientId: connResult.data.oidcClientId ?? "",
        oidcClientSecret: "",
        samlEntryPoint: connResult.data.samlEntryPoint ?? "",
        samlIssuer: connResult.data.samlIssuer ?? "",
        samlIdpCertificate: "",
      });
    }
    if (rolesResult.kind === "ok") setRoles(rolesResult.data.roles);
    if (mappingResult.kind === "ok") setMappings(mappingResult.data);
    if (scimResult.kind === "ok") setScimActive(scimResult.data.active);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function saveConnection() {
    setSaved(false);
    setError(null);
    const result = await fetchJson("/api/v1/admin/sso/connection", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol: form.protocol,
        displayName: form.displayName,
        jitProvisioningEnabled: form.jitProvisioningEnabled,
        defaultRoleId: form.defaultRoleId || undefined,
        groupClaimName: form.groupClaimName || undefined,
        oidcIssuerUrl: form.protocol === "Oidc" ? form.oidcIssuerUrl : undefined,
        oidcClientId: form.protocol === "Oidc" ? form.oidcClientId : undefined,
        oidcClientSecret: form.protocol === "Oidc" && form.oidcClientSecret ? form.oidcClientSecret : undefined,
        samlEntryPoint: form.protocol === "Saml" ? form.samlEntryPoint : undefined,
        samlIssuer: form.protocol === "Saml" ? form.samlIssuer : undefined,
        samlIdpCertificate: form.protocol === "Saml" && form.samlIdpCertificate ? form.samlIdpCertificate : undefined,
      }),
    });
    if (result.kind === "error") return setError(result.message);
    if (result.kind === "forbidden") return setForbidden(true);
    setSaved(true);
    await reload();
  }

  async function setStatus(status: "Active" | "Disabled") {
    setError(null);
    const result = await fetchJson("/api/v1/admin/sso/connection/status", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (result.kind === "error") return setError(result.message);
    await reload();
  }

  async function addMapping() {
    if (!newMapping.externalGroup || !newMapping.roleId) return;
    const result = await fetchJson("/api/v1/admin/sso/group-mappings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newMapping),
    });
    if (result.kind === "error") return setError(result.message);
    setNewMapping({ externalGroup: "", roleId: "" });
    await reload();
  }

  async function removeMapping(id: string) {
    await fetchJson(`/api/v1/admin/sso/group-mappings/${id}`, { method: "DELETE" });
    await reload();
  }

  async function rotateScimToken() {
    const result = await fetchJson<{ token: string }>("/api/v1/admin/scim-token", { method: "POST" });
    if (result.kind === "error") return setError(result.message);
    if (result.kind === "ok") setIssuedScimToken(result.data.token);
    await reload();
  }

  async function revokeScimToken() {
    await fetchJson("/api/v1/admin/scim-token", { method: "DELETE" });
    setIssuedScimToken(null);
    await reload();
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Single Sign-On" />;
  if (connection === undefined) {
    return (
      <div className="max-w-[720px] p-6">
        <h1 className="sr-only">Single Sign-On &amp; SCIM</h1>
        <Skeleton className="h-64 w-full" role="status" aria-label="Loading SSO settings" />
      </div>
    );
  }

  return (
    <div className="max-w-[720px] p-6">
      <h1 className="mb-1 font-heading text-lg font-semibold">Single Sign-On &amp; SCIM</h1>
      <p className="mb-6 text-muted-foreground">
        Configure SAML or OIDC single sign-on, IdP group-to-role mapping, and SCIM 2.0 provisioning. Requires the
        Enterprise plan tier.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert className="mb-4">
          <AlertDescription>
            Configuration saved. The connection is Disabled until you activate it below.
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Identity provider</h2>
          {connection && (
            <span className={connection.status === "Active" ? "text-sm text-green-700" : "text-sm text-muted-foreground"}>
              {connection.status}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="sso-protocol">Protocol</Label>
            <Select
              value={form.protocol}
              onValueChange={(v) => setForm({ ...form, protocol: v as "Saml" | "Oidc" })}
              disabled={!canEdit}
            >
              <SelectTrigger id="sso-protocol" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Oidc">OIDC</SelectItem>
                <SelectItem value="Saml">SAML</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="sso-display-name">Display name</Label>
            <Input
              id="sso-display-name"
              className="mt-1"
              value={form.displayName}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="sso-jit"
              checked={form.jitProvisioningEnabled}
              disabled={!canEdit}
              onCheckedChange={(v) => setForm({ ...form, jitProvisioningEnabled: v === true })}
            />
            <Label htmlFor="sso-jit">Automatically create an account on first SSO login (JIT provisioning)</Label>
          </div>
          <FieldHint
            id="sso-jit-hint"
            content="When off, a user must already have an invited account with a matching email — SSO cannot create new accounts."
          />

          <div>
            <Label htmlFor="sso-default-role">Default role for new SSO users</Label>
            <Select value={form.defaultRoleId || undefined} onValueChange={(v) => setForm({ ...form, defaultRoleId: v ?? "" })} disabled={!canEdit}>
              <SelectTrigger id="sso-default-role" className="mt-1">
                <SelectValue placeholder="No default role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="sso-group-claim">Group claim name</Label>
            <Input
              id="sso-group-claim"
              className="mt-1"
              value={form.groupClaimName}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, groupClaimName: e.target.value })}
            />
          </div>

          {form.protocol === "Oidc" ? (
            <>
              <div>
                <Label htmlFor="oidc-issuer">Issuer / discovery URL</Label>
                <Input id="oidc-issuer" className="mt-1" value={form.oidcIssuerUrl} disabled={!canEdit} onChange={(e) => setForm({ ...form, oidcIssuerUrl: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="oidc-client-id">Client ID</Label>
                <Input id="oidc-client-id" className="mt-1" value={form.oidcClientId} disabled={!canEdit} onChange={(e) => setForm({ ...form, oidcClientId: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="oidc-client-secret">
                  Client secret {connection?.oidcClientSecretSet && <span className="text-muted-foreground">(set — leave blank to keep)</span>}
                </Label>
                <Input
                  id="oidc-client-secret"
                  type="password"
                  className="mt-1"
                  value={form.oidcClientSecret}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, oidcClientSecret: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="saml-entry-point">IdP SSO URL (entry point)</Label>
                <Input id="saml-entry-point" className="mt-1" value={form.samlEntryPoint} disabled={!canEdit} onChange={(e) => setForm({ ...form, samlEntryPoint: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="saml-issuer">SP entity ID (issuer)</Label>
                <Input id="saml-issuer" className="mt-1" value={form.samlIssuer} disabled={!canEdit} onChange={(e) => setForm({ ...form, samlIssuer: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="saml-cert">
                  IdP signing certificate (PEM) {connection?.samlIdpCertificateSet && <span className="text-muted-foreground">(set — leave blank to keep)</span>}
                </Label>
                <textarea
                  id="saml-cert"
                  className="mt-1 w-full rounded-none border border-border bg-background p-2 font-mono text-xs"
                  rows={5}
                  value={form.samlIdpCertificate}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, samlIdpCertificate: e.target.value })}
                />
              </div>
            </>
          )}

          {canEdit && (
            <div className="flex gap-2">
              <Button type="button" onClick={saveConnection}>
                Save configuration
              </Button>
              {connection && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStatus(connection.status === "Active" ? "Disabled" : "Active")}
                >
                  {connection.status === "Active" ? "Deactivate" : "Activate"}
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className="mb-6 p-4">
        <h2 className="mb-4 font-semibold">Group → role mapping</h2>
        <ul className="mb-4 flex flex-col gap-2">
          {mappings.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {m.externalGroup} → {roles.find((r) => r.id === m.roleId)?.name ?? m.roleId}
              </span>
              {canEdit && (
                <Button type="button" size="sm" variant="ghost" onClick={() => removeMapping(m.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
          {mappings.length === 0 && <li className="text-sm text-muted-foreground">No group mappings yet.</li>}
        </ul>
        {canEdit && (
          <div className="flex gap-2">
            <Input
              placeholder="External group name"
              value={newMapping.externalGroup}
              onChange={(e) => setNewMapping({ ...newMapping, externalGroup: e.target.value })}
            />
            <Select value={newMapping.roleId || undefined} onValueChange={(v) => setNewMapping({ ...newMapping, roleId: v ?? "" })}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" onClick={addMapping}>
              Add
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 font-semibold">SCIM provisioning</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Bearer token endpoint: <code>/api/scim/v2/{"{your tenant slug}"}/Users</code>. Status:{" "}
          {scimActive ? "Active" : "No active token"}.
        </p>
        {issuedScimToken && (
          <Alert className="mb-4">
            <AlertDescription>
              Copy this token now — it will not be shown again: <code className="break-all">{issuedScimToken}</code>
            </AlertDescription>
          </Alert>
        )}
        {canEdit && (
          <div className="flex gap-2">
            <Button type="button" onClick={rotateScimToken}>
              {scimActive ? "Rotate token" : "Generate token"}
            </Button>
            {scimActive && (
              <Button type="button" variant="outline" onClick={revokeScimToken}>
                Revoke
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
