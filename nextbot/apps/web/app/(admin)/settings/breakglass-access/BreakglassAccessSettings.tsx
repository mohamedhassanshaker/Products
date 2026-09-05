"use client";

import { useCallback, useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Card } from "@nextbot/ui/components/ui/card";
import { Button } from "@nextbot/ui/components/ui/button";
import { Label } from "@nextbot/ui/components/ui/label";
import { Input } from "@nextbot/ui/components/ui/input";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@nextbot/ui/components/ui/alert-dialog";
import { toast } from "@nextbot/ui/lib/toast";
import { BREAKGLASS_MAX_GRANT_HOURS, type PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface BreakglassGrantDto {
  id: string;
  grantedByUserId: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

const MAX_HOURS = BREAKGLASS_MAX_GRANT_HOURS;

function isActive(grant: BreakglassGrantDto, now: number): boolean {
  return grant.revokedAt === null && new Date(grant.expiresAt).getTime() > now;
}

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — Break-Glass Access
 * consent screen. There is NO other way for a NextBot Platform Operator to gain
 * scoped, time-boxed, read-only access to this tenant's data for incident diagnosis:
 * a grant must exist here, be unexpired, and be unrevoked, or the platform-ops side
 * denies the request outright, fail-closed. The tenant may revoke an active grant at
 * any time.
 */
export function BreakglassAccessSettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [grants, setGrants] = useState<BreakglassGrantDto[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [expiresInHours, setExpiresInHours] = useState(4);
  const [busy, setBusy] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    const result = await fetchJson<{ grants: BreakglassGrantDto[] }>("/api/v1/admin/breakglass-grants");
    if (result.kind === "forbidden") return setForbidden(true);
    if (result.kind === "error") return setError(result.message);
    setGrants(result.data.grants);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createGrant() {
    setBusy(true);
    try {
      const result = await fetchJson("/api/v1/admin/breakglass-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, expiresInHours }),
      });
      if (result.kind === "error") return toast.error(result.message);
      toast.success("Break-glass access grant created.");
      setReason("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!confirmRevokeId) return;
    setBusy(true);
    try {
      const result = await fetchJson(`/api/v1/admin/breakglass-grants/${confirmRevokeId}/revoke`, { method: "POST" });
      if (result.kind === "error") return toast.error(result.message);
      toast.success("Grant revoked.");
      await reload();
    } finally {
      setBusy(false);
      setConfirmRevokeId(null);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Break-Glass Access" />;
  if (error) {
    return (
      <div className="max-w-[700px] p-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (grants === null) {
    return (
      <div className="max-w-[700px] p-6">
        <h1 className="sr-only">Break-Glass Access</h1>
        <Skeleton className="h-32 w-full" role="status" aria-label="Loading break-glass access settings" />
      </div>
    );
  }

  const now = Date.now();
  const active = grants.find((g) => isActive(g, now)) ?? null;
  const history = grants.filter((g) => g.id !== active?.id);

  return (
    <div className="max-w-[700px] p-6">
      <h1 className="mb-2 font-heading text-lg font-semibold">Break-Glass Access</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Grant a NextBot Platform Operator time-boxed, read-only access to this tenant&apos;s conversations and escalations for
        incident diagnosis. There is no other way for an operator to see this tenant&apos;s data — a grant must exist here, be
        unexpired, and be unrevoked. Every activation is recorded both in NextBot&apos;s own operator audit trail and in this
        tenant&apos;s own Audit Log.
      </p>

      {active ? (
        <Card className="mb-4 p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="font-heading text-base font-semibold">Active grant</h2>
            <Badge className="bg-emerald-700 text-white">Active</Badge>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Reason</dt>
            <dd>{active.reason}</dd>
            <dt className="text-muted-foreground">Granted</dt>
            <dd>{new Date(active.createdAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{new Date(active.expiresAt).toLocaleString()}</dd>
          </dl>
          {canEdit && (
            <Button variant="destructive" className="mt-3" disabled={busy} onClick={() => setConfirmRevokeId(active.id)}>
              Revoke access now
            </Button>
          )}
        </Card>
      ) : (
        canEdit && (
          <Card className="mb-4 p-4">
            <h2 className="mb-2 font-heading text-base font-semibold">Grant access</h2>
            <div className="flex flex-col gap-3">
              <div>
                <Label htmlFor="breakglass-reason">Reason / scope</Label>
                <Textarea
                  id="breakglass-reason"
                  className="mt-1"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Investigating a reported delivery failure with our support team."
                />
              </div>
              <div className="w-40">
                <Label htmlFor="breakglass-hours">Expires in (hours)</Label>
                <Input
                  id="breakglass-hours"
                  type="number"
                  min={1}
                  max={MAX_HOURS}
                  className="mt-1"
                  value={expiresInHours}
                  onChange={(e) => setExpiresInHours(Number(e.target.value))}
                />
                <p className="mt-1 text-xs text-muted-foreground">Maximum {MAX_HOURS} hours.</p>
              </div>
              <div>
                <Button disabled={busy || reason.trim().length === 0} onClick={() => void createGrant()}>
                  Grant break-glass access
                </Button>
              </div>
            </div>
          </Card>
        )
      )}

      {history.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-heading text-base font-semibold">History</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {history.map((g) => (
              <li key={g.id} className="border-b border-border pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant={g.revokedAt ? "secondary" : "outline"}>{g.revokedAt ? "Revoked" : "Expired"}</Badge>
                  <span className="text-muted-foreground">{new Date(g.createdAt).toLocaleString()}</span>
                </div>
                <p>{g.reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AlertDialog open={confirmRevokeId !== null} onOpenChange={(open) => !open && setConfirmRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke break-glass access?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately ends operator access, even if a diagnosis session is in progress. A new grant will be required for
              any future access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevokeId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmRevoke()} disabled={busy}>
              Revoke now
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
