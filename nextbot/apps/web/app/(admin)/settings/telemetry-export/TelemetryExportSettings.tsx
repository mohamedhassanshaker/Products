"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Switch } from "@nextbot/ui/components/ui/switch";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Card } from "@nextbot/ui/components/ui/card";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface OtelConfig {
  otlpEndpointUrl: string;
  enabled: boolean;
}
interface SiemConfig {
  endpointUrl: string;
  enabled: boolean;
}

/**
 * Settings → Telemetry Export (Target Architecture Blueprint Phase 18, BL-49,
 * FR-ADM-10) — tenant-scoped, opt-in OTel trace/metric export and audit-log SIEM
 * streaming. Both are ADDITIVE to (never a replacement for) the existing in-console
 * Runtime Traces and Audit Log Viewer screens, which this settings screen does not
 * change in any way.
 */
export function TelemetryExportSettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [otel, setOtel] = useState<OtelConfig | null>(null);
  const [siem, setSiem] = useState<SiemConfig | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function reload() {
    setError(null);
    const [otelResult, siemResult] = await Promise.all([
      fetchJson<{ config: OtelConfig | null }>("/api/v1/admin/telemetry-export/otel"),
      fetchJson<{ config: SiemConfig | null }>("/api/v1/admin/telemetry-export/siem"),
    ]);
    if (otelResult.kind === "forbidden" || siemResult.kind === "forbidden") return setForbidden(true);
    if (otelResult.kind === "error") return setError(otelResult.message);
    if (siemResult.kind === "error") return setError(siemResult.message);
    setOtel(otelResult.kind === "ok" ? (otelResult.data.config ?? { otlpEndpointUrl: "", enabled: false }) : { otlpEndpointUrl: "", enabled: false });
    setSiem(siemResult.kind === "ok" ? (siemResult.data.config ?? { endpointUrl: "", enabled: false }) : { endpointUrl: "", enabled: false });
  }

  useEffect(() => {
    void reload();
  }, []);

  async function saveOtel() {
    if (!otel) return;
    const result = await fetchJson("/api/v1/admin/telemetry-export/otel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(otel),
    });
    if (result.kind === "error") return setError(result.message);
    setSaved("otel");
    await reload();
  }

  async function saveSiem() {
    if (!siem) return;
    const result = await fetchJson("/api/v1/admin/telemetry-export/siem", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(siem),
    });
    if (result.kind === "error") return setError(result.message);
    setSaved("siem");
    await reload();
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Telemetry Export" />;
  if (otel === null || siem === null) {
    return (
      <div className="max-w-[640px] p-6">
        <h1 className="sr-only">Telemetry Export</h1>
        <Skeleton className="h-48 w-full" role="status" aria-label="Loading telemetry export settings" />
      </div>
    );
  }

  return (
    <div className="max-w-[640px] p-6">
      <h1 className="mb-1 font-heading text-lg font-semibold">Telemetry Export</h1>
      <p className="mb-6 text-muted-foreground">
        Opt in to forward a copy of your trace/metric telemetry and audit log to your own OpenTelemetry collector and
        SIEM endpoint. Both are additive — the in-console Runtime Traces and Audit Log screens are unaffected.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert className="mb-4">
          <AlertDescription>Saved.</AlertDescription>
        </Alert>
      )}

      <Card className="mb-4 p-4">
        <h2 className="mb-4 font-semibold">OpenTelemetry export</h2>
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="otel-endpoint">OTLP/HTTP collector endpoint</Label>
            <Input
              id="otel-endpoint"
              className="mt-1"
              placeholder="https://collector.example.com:4318"
              value={otel.otlpEndpointUrl}
              disabled={!canEdit}
              onChange={(e) => setOtel({ ...otel, otlpEndpointUrl: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="otel-enabled" checked={otel.enabled} disabled={!canEdit} onCheckedChange={(v) => setOtel({ ...otel, enabled: v })} />
            <Label htmlFor="otel-enabled">Enabled</Label>
          </div>
          {canEdit && (
            <Button type="button" onClick={saveOtel} className="self-start">
              Save
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-4 font-semibold">SIEM audit-log streaming</h2>
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="siem-endpoint">SIEM ingestion endpoint</Label>
            <Input
              id="siem-endpoint"
              className="mt-1"
              placeholder="https://siem.example.com/ingest"
              value={siem.endpointUrl}
              disabled={!canEdit}
              onChange={(e) => setSiem({ ...siem, endpointUrl: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="siem-enabled" checked={siem.enabled} disabled={!canEdit} onCheckedChange={(v) => setSiem({ ...siem, enabled: v })} />
            <Label htmlFor="siem-enabled">Enabled</Label>
          </div>
          {canEdit && (
            <Button type="button" onClick={saveSiem} className="self-start">
              Save
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
