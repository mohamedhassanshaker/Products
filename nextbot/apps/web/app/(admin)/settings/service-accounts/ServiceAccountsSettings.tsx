"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Card } from "@nextbot/ui/components/ui/card";
import { RBAC_MODULES, type PermissionLevelValue, type PermissionMatrix, type RbacModuleValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface ServiceAccountRow {
  id: string;
  displayName: string;
  status: string;
  roles: Array<{ id: string; name: string }>;
}
interface RoleOption {
  id: string;
  name: string;
}
interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopeMatrix: PermissionMatrix | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/**
 * Settings → Service Accounts (Phase 4, BL-36, FR-SEC-10/FR-API-01) — create/
 * disable non-human, programmatic-access identities and issue/revoke their
 * scoped `nbk_…` API keys. A key's optional per-module scope can only NARROW
 * the account's own role-derived permissions (enforced server-side,
 * `service-account.ts`'s `assertScopeWithinAccountMatrix` — this screen doesn't
 * re-derive that check itself, only reflects the server's rejection).
 */
export function ServiceAccountsSettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [accounts, setAccounts] = useState<ServiceAccountRow[] | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState({ name: "", roleIds: [] as string[] });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [keysByAccount, setKeysByAccount] = useState<Record<string, ApiKeyRow[]>>({});
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState<Partial<Record<RbacModuleValue, PermissionLevelValue>>>({});

  async function reload() {
    setError(null);
    const [accountsResult, rolesResult] = await Promise.all([
      fetchJson<ServiceAccountRow[]>("/api/v1/admin/service-accounts"),
      fetchJson<{ roles: RoleOption[] }>("/api/v1/admin/roles"),
    ]);
    if (accountsResult.kind === "forbidden") return setForbidden(true);
    if (accountsResult.kind === "error") return setError(accountsResult.message);
    setAccounts(accountsResult.data);
    if (rolesResult.kind === "ok") setRoles(rolesResult.data.roles);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function createAccount() {
    if (!newAccount.name || newAccount.roleIds.length === 0) return;
    const result = await fetchJson("/api/v1/admin/service-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newAccount),
    });
    if (result.kind === "error") return setError(result.message);
    setNewAccount({ name: "", roleIds: [] });
    await reload();
  }

  async function disableAccount(id: string) {
    await fetchJson(`/api/v1/admin/service-accounts/${id}`, { method: "DELETE" });
    await reload();
  }

  async function loadKeys(accountId: string) {
    const result = await fetchJson<ApiKeyRow[]>(`/api/v1/admin/service-accounts/${accountId}/api-keys`);
    if (result.kind === "ok") setKeysByAccount((prev) => ({ ...prev, [accountId]: result.data }));
  }

  async function toggleExpanded(accountId: string) {
    if (expanded === accountId) {
      setExpanded(null);
      return;
    }
    setExpanded(accountId);
    await loadKeys(accountId);
  }

  async function issueKey(accountId: string) {
    if (!newKeyName) return;
    const scopeEntries = Object.entries(newKeyScope).filter(([, v]) => v && v !== "None");
    const result = await fetchJson<{ key: string }>(`/api/v1/admin/service-accounts/${accountId}/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newKeyName, scopeMatrix: scopeEntries.length > 0 ? Object.fromEntries(scopeEntries) : undefined }),
    });
    if (result.kind === "error") return setError(result.message);
    if (result.kind === "ok") setIssuedKey(result.data.key);
    setNewKeyName("");
    setNewKeyScope({});
    await loadKeys(accountId);
  }

  async function revokeKey(accountId: string, keyId: string) {
    await fetchJson(`/api/v1/admin/service-accounts/${accountId}/api-keys/${keyId}`, { method: "DELETE" });
    await loadKeys(accountId);
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Service Accounts" />;
  if (accounts === null) {
    return (
      <div className="max-w-[720px] p-6">
        <h1 className="sr-only">Service Accounts</h1>
        <Skeleton className="h-48 w-full" role="status" aria-label="Loading service accounts" />
      </div>
    );
  }

  return (
    <div className="max-w-[720px] p-6">
      <h1 className="mb-1 font-heading text-lg font-semibold">Service Accounts</h1>
      <p className="mb-6 text-muted-foreground">
        Non-human, programmatic-access identities. Each carries the same role-based permissions a real user would, and
        each API key can optionally be scoped to a narrower subset of that.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {issuedKey && (
        <Alert className="mb-4">
          <AlertDescription>Copy this key now — it will not be shown again: <code className="break-all">{issuedKey}</code></AlertDescription>
        </Alert>
      )}

      {canEdit && (
        <Card className="mb-6 p-4">
          <h2 className="mb-4 font-semibold">New service account</h2>
          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="new-sa-name">Name</Label>
              <Input id="new-sa-name" className="mt-1" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="new-sa-role">Role</Label>
              <Select
                value={newAccount.roleIds[0]}
                onValueChange={(v) => setNewAccount({ ...newAccount, roleIds: v ? [v] : [] })}
              >
                <SelectTrigger id="new-sa-role" className="mt-1">
                  <SelectValue placeholder="Choose a role" />
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
            <Button type="button" onClick={createAccount} className="self-start">
              Create
            </Button>
          </div>
        </Card>
      )}

      <ul className="flex flex-col gap-3">
        {accounts.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{a.displayName}</p>
                <p className="text-sm text-muted-foreground">
                  {a.status} · {a.roles.map((r) => r.name).join(", ") || "No role"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => toggleExpanded(a.id)}>
                  {expanded === a.id ? "Hide keys" : "API keys"}
                </Button>
                {canEdit && a.status !== "Disabled" && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => disableAccount(a.id)}>
                    Disable
                  </Button>
                )}
              </div>
            </div>

            {expanded === a.id && (
              <div className="mt-4 border-t border-border pt-4">
                <ul className="mb-4 flex flex-col gap-2">
                  {(keysByAccount[a.id] ?? []).map((k) => (
                    <li key={k.id} className="flex items-center justify-between text-sm">
                      <span>
                        {k.name} ({k.keyPrefix}…) {k.revokedAt ? "· Revoked" : ""}
                        {k.scopeMatrix ? " · Scoped" : ""}
                      </span>
                      {canEdit && !k.revokedAt && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => revokeKey(a.id, k.id)}>
                          Revoke
                        </Button>
                      )}
                    </li>
                  ))}
                  {(keysByAccount[a.id] ?? []).length === 0 && <li className="text-sm text-muted-foreground">No API keys yet.</li>}
                </ul>

                {canEdit && (
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-2">
                      <Input placeholder="Key name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
                      <Button type="button" onClick={() => issueKey(a.id)}>
                        Issue key
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Optional scope (leave all as "Inherit" to use the account&apos;s full role permissions):
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {RBAC_MODULES.map((module) => (
                        <div key={module} className="flex items-center gap-2 text-xs">
                          <span className="w-32">{module}</span>
                          <Select
                            value={newKeyScope[module] ?? "None"}
                            onValueChange={(v) => setNewKeyScope((prev) => ({ ...prev, [module]: v as PermissionLevelValue }))}
                          >
                            <SelectTrigger className="h-7 w-24 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="None">Inherit</SelectItem>
                              <SelectItem value="Read">Read</SelectItem>
                              <SelectItem value="Write">Write</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
        {accounts.length === 0 && <li className="text-sm text-muted-foreground">No service accounts yet.</li>}
      </ul>
    </div>
  );
}
