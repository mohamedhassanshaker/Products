"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Card } from "@nextbot/ui/components/ui/card";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { fetchJson } from "@/src/lib/fetch-json";

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}
interface TenantSessionRow extends SessionRow {
  userEmail: string;
  userDisplayName: string;
}

/**
 * Settings → Sessions (Phase 4, BL-36, FR-SEC-10). Personal "active sessions"
 * (every user) plus, for a caller with `users_roles` access, a tenant-wide
 * admin table. Revoking a session here takes effect on that session's very
 * next request (`isSessionActive` is checked fresh on every request, never
 * cached) — see `packages/modules/iam/README.md`'s Phase 4 decision log.
 */
export function SessionsSettings({
  canViewTenantSessions,
  canRevokeTenantSessions,
}: {
  canViewTenantSessions: boolean;
  canRevokeTenantSessions: boolean;
}) {
  const [mine, setMine] = useState<SessionRow[] | null>(null);
  const [tenantSessions, setTenantSessions] = useState<TenantSessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    const mineResult = await fetchJson<SessionRow[]>("/api/v1/admin/sessions");
    if (mineResult.kind === "ok") setMine(mineResult.data);
    if (mineResult.kind === "error") setError(mineResult.message);

    if (canViewTenantSessions) {
      const tenantResult = await fetchJson<TenantSessionRow[]>("/api/v1/admin/sessions/tenant");
      if (tenantResult.kind === "ok") setTenantSessions(tenantResult.data);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function revokeMine(id: string) {
    await fetchJson(`/api/v1/admin/sessions/${id}`, { method: "DELETE" });
    await reload();
  }

  async function revokeAllMine() {
    await fetchJson("/api/v1/admin/sessions", { method: "DELETE" });
    await reload();
  }

  async function revokeTenant(id: string) {
    await fetchJson(`/api/v1/admin/sessions/tenant/${id}`, { method: "DELETE" });
    await reload();
  }

  if (mine === null) {
    return (
      <div className="max-w-[720px] p-6">
        <h1 className="sr-only">Sessions</h1>
        <Skeleton className="h-48 w-full" role="status" aria-label="Loading sessions" />
      </div>
    );
  }

  return (
    <div className="max-w-[720px] p-6">
      <h1 className="mb-1 font-heading text-lg font-semibold">Sessions</h1>
      <p className="mb-6 text-muted-foreground">Review and revoke your active Admin Console sessions.</p>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-6 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">My sessions</h2>
          {mine.length > 1 && (
            <Button type="button" variant="outline" size="sm" onClick={revokeAllMine}>
              Sign out everywhere
            </Button>
          )}
        </div>
        <ul className="flex flex-col gap-2">
          {mine.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {s.ip ?? "Unknown IP"} · {s.userAgent ?? "Unknown device"} · last seen {new Date(s.lastSeenAt).toLocaleString()}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => revokeMine(s.id)}>
                Revoke
              </Button>
            </li>
          ))}
          {mine.length === 0 && <li className="text-sm text-muted-foreground">No active sessions.</li>}
        </ul>
      </Card>

      {canViewTenantSessions && tenantSessions && (
        <Card className="p-4">
          <h2 className="mb-4 font-semibold">All tenant sessions</h2>
          <ul className="flex flex-col gap-2">
            {tenantSessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {s.userDisplayName} ({s.userEmail}) · {s.ip ?? "Unknown IP"} · last seen {new Date(s.lastSeenAt).toLocaleString()}
                </span>
                {canRevokeTenantSessions && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => revokeTenant(s.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
            {tenantSessions.length === 0 && <li className="text-sm text-muted-foreground">No active sessions.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}
