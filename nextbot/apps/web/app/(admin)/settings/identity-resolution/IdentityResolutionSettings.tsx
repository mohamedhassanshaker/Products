"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Label } from "@nextbot/ui/components/ui/label";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface IdentityResolutionPolicy {
  enabled: boolean;
}

/**
 * Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — Cross-Channel Identity
 * Linking settings screen. OFF by default; enabling it is an explicit, deliberate
 * admin action (never a default, never inferred) — the copy on this screen says so
 * plainly, matching FR-OC-08's own hard requirement that incorrectly merging two
 * different customers is a worse failure than not merging them.
 */
export function IdentityResolutionSettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [policy, setPolicy] = useState<IdentityResolutionPolicy | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setError(null);
    const result = await fetchJson<{ policy: IdentityResolutionPolicy }>("/api/v1/admin/settings/identity-resolution-policy");
    if (result.kind === "forbidden") return setForbidden(true);
    if (result.kind === "error") return setError(result.message);
    setPolicy(result.data.policy);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function toggle(enabled: boolean) {
    setBusy(true);
    setSaved(false);
    try {
      const result = await fetchJson("/api/v1/admin/settings/identity-resolution-policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (result.kind === "error") return setError(result.message);
      setSaved(true);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Cross-Channel Identity Linking" />;
  if (policy === null)
    return (
      <div className="max-w-[600px] p-6">
        <h1 className="sr-only">Cross-Channel Identity Linking</h1>
        <Skeleton className="h-32 w-full" role="status" aria-label="Loading cross-channel identity linking settings" />
      </div>
    );

  return (
    <div className="max-w-[600px] p-6">
      <h1 className="mb-2 font-heading text-lg font-semibold">Cross-Channel Identity Linking</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        When enabled, NextBot treats two conversations across different channels (e.g. a WhatsApp conversation and a
        web-widget session) as the same customer for context continuity, but ONLY when both conversations carry the
        EXACT same recorded customer identifier — never an automatic or inferred match. This is OFF by default:
        incorrectly linking two different customers is a worse failure than not linking them at all.
      </p>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert role="status" className="mb-4">
          <AlertDescription>Saved.</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id="identity-resolution-enabled"
          checked={policy.enabled}
          disabled={!canEdit || busy}
          onCheckedChange={(checked) => void toggle(checked === true)}
        />
        <Label htmlFor="identity-resolution-enabled">Enable cross-channel identity linking for this tenant</Label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Currently {policy.enabled ? "enabled" : "disabled (default)"}.</p>
    </div>
  );
}
