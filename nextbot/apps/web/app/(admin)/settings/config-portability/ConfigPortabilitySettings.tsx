"use client";

import { useRef, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface RestoreOutcome {
  kind: string;
  name: string;
  action: "createdNewIdentity" | "createdNewDraftVersion" | "skipped" | "failed";
  reason?: string;
  newIdentityId?: string;
  newVersionId?: string;
}

interface ManifestEntry {
  kind: string;
  id: string;
  name: string;
  version: string | number | null;
}

interface ConfigBundleShape {
  schemaVersion: number;
  exportedAt: string;
  tenantId: string;
  tenantName: string;
  manifest: ManifestEntry[];
  [key: string]: unknown;
}

const ACTION_VARIANT: Record<RestoreOutcome["action"], "default" | "secondary" | "outline" | "destructive"> = {
  createdNewIdentity: "default",
  createdNewDraftVersion: "default",
  skipped: "secondary",
  failed: "destructive",
};

/**
 * Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — Configuration Export
 * and Restore screen. Export is a plain download link (the endpoint itself sets
 * `Content-Disposition: attachment`, matching this codebase's existing Conversation
 * List CSV/JSON export convention). Restore is a two-step flow — a bundle is parsed
 * client-side and previewed (zero writes, `mode: "preview"`) before an explicit
 * "Confirm restore" action performs the real write (`mode: "confirm"`) — never a
 * silent black-box restore.
 */
export function ConfigPortabilitySettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canRestore = permissionLevel === "Write";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<ConfigBundleShape | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewOutcomes, setPreviewOutcomes] = useState<RestoreOutcome[] | null>(null);
  const [confirmOutcomes, setConfirmOutcomes] = useState<RestoreOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFileSelected(file: File) {
    setParseError(null);
    setPreviewOutcomes(null);
    setConfirmOutcomes(null);
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ConfigBundleShape;
      setBundle(parsed);
      await runPreview(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? `This file is not a valid configuration bundle: ${err.message}` : "This file is not a valid configuration bundle.");
      setBundle(null);
    }
  }

  async function runPreview(candidate: ConfigBundleShape) {
    setBusy(true);
    try {
      const result = await fetchJson<{ mode: string; outcomes: RestoreOutcome[] }>("/api/v1/admin/config-portability/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle: candidate, mode: "preview" }),
      });
      if (result.kind === "forbidden" || result.kind === "error") {
        setError(result.kind === "error" ? result.message : "You don't have access to restore configuration.");
        return;
      }
      setPreviewOutcomes(result.data.outcomes);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!bundle) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchJson<{ mode: string; outcomes: RestoreOutcome[] }>("/api/v1/admin/config-portability/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle, mode: "confirm" }),
      });
      if (result.kind === "forbidden" || result.kind === "error") {
        setError(result.kind === "error" ? result.message : "You don't have access to restore configuration.");
        return;
      }
      setConfirmOutcomes(result.data.outcomes);
    } finally {
      setBusy(false);
    }
  }

  function resetRestoreFlow() {
    setBundle(null);
    setPreviewOutcomes(null);
    setConfirmOutcomes(null);
    setParseError(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (permissionLevel === "None") return <AccessDeniedState moduleLabel="Configuration Export & Restore" />;

  return (
    <div className="max-w-[900px] p-6">
      <h1 className="mb-2 font-heading text-lg font-semibold">Configuration Export & Restore</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Export the tenant&apos;s current agent/skill/workflow/team/model-route/connector configuration as a versioned
        bundle, and restore from a prior export. Restoring NEVER overwrites anything in place — every restored
        artifact lands as a brand-new Draft that must go through the normal promotion gate before it takes effect.
      </p>

      <section className="mb-8 rounded-none border p-4">
        <h2 className="mb-2 font-heading text-sm font-semibold">Export</h2>
        <p className="mb-3 text-sm text-muted-foreground">Downloads the current state of every included artifact as one JSON file.</p>
        {/* Content-Disposition on the response makes this a real download, not a
            navigation — same convention as the Conversation List's CSV/JSON export
            links. */}
        <a href="/api/v1/admin/config-portability/export">
          <Button size="sm">Export configuration</Button>
        </a>
      </section>

      <section className="rounded-none border p-4">
        <h2 className="mb-2 font-heading text-sm font-semibold">Restore</h2>
        {!canRestore ? (
          <p className="text-sm text-muted-foreground">You have read-only access — restoring requires Write permission.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">Select a previously exported bundle file to preview what a restore would create.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              aria-label="Configuration bundle file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFileSelected(file);
              }}
              className="mb-3 block text-sm"
            />
            {parseError && (
              <Alert variant="destructive" className="mb-3">
                <AlertDescription>{parseError}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="mb-3">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {bundle && (
              <p className="mb-2 text-xs text-muted-foreground">
                Bundle from tenant &quot;{bundle.tenantName}&quot;, exported {new Date(bundle.exportedAt).toLocaleString()} —{" "}
                {bundle.manifest.length} item(s).
              </p>
            )}
            {previewOutcomes && !confirmOutcomes && (
              <>
                <h3 className="mb-1 text-xs font-bold">Preview — nothing has been written yet</h3>
                <OutcomeTable outcomes={previewOutcomes} />
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={confirmRestore}>
                    {busy ? "Restoring…" : "Confirm restore"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={resetRestoreFlow}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
            {confirmOutcomes && (
              <>
                <h3 className="mb-1 text-xs font-bold">Restore complete — every created artifact is a new Draft requiring the normal promotion gate</h3>
                <OutcomeTable outcomes={confirmOutcomes} />
                <Button size="sm" variant="outline" className="mt-3" onClick={resetRestoreFlow}>
                  Restore another bundle
                </Button>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function OutcomeTable({ outcomes }: { outcomes: RestoreOutcome[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kind</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {outcomes.map((o, i) => (
          <TableRow key={`${o.kind}-${o.name}-${i}`}>
            <TableCell>{o.kind}</TableCell>
            <TableCell>{o.name}</TableCell>
            <TableCell>
              <Badge variant={ACTION_VARIANT[o.action]}>{o.action}</Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{o.reason ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
