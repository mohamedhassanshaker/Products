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
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface DataPolicy {
  retentionTranscriptsDays: number;
  retentionToolPayloadsDays: number;
  retentionToolMetadataDays: number;
  retentionPiiDays: number;
  residencyRegion: "UAE" | "EU" | "US";
  allowOutOfRegionInference: boolean;
  purgeLastRunAt: string | null;
}

/** B.8.4 Retention & Residency — extends the Phase 1 `tenant_data_policy` row
 * (residency region, retention periods with the "0/unset invalid" rule, and
 * out-of-region inference opt-in). A field left at `-1` is Indefinite; the UI
 * exposes that via a checkbox rather than letting an operator type `-1` directly. */
export function DataPolicySettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [policy, setPolicy] = useState<DataPolicy | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function reload() {
    setError(null);
    const result = await fetchJson<{ policy: DataPolicy }>("/api/v1/admin/data-policy");
    if (result.kind === "forbidden") return setForbidden(true);
    if (result.kind === "error") return setError(result.message);
    setPolicy(result.data.policy);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function save() {
    if (!policy) return;
    setSaved(false);
    const result = await fetchJson("/api/v1/admin/data-policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        retentionTranscriptsDays: policy.retentionTranscriptsDays,
        retentionTranscriptsIndefinite: policy.retentionTranscriptsDays === -1,
        residencyRegion: policy.residencyRegion,
        allowOutOfRegionInference: policy.allowOutOfRegionInference,
      }),
    });
    if (result.kind === "error") return setError(result.message);
    setSaved(true);
    await reload();
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Retention & Residency" />;
  if (policy === null)
    return (
      <div className="max-w-[600px] p-6">
        {/* axe-core's `page-has-heading-one` rule (Batch A a11y audit): see the
            matching comment in RoutingConfig.tsx's identical loading-return
            pattern. */}
        <h1 className="sr-only">Retention & Residency</h1>
        <Skeleton className="h-48 w-full" role="status" aria-label="Loading retention & residency settings" />
      </div>
    );

  return (
    <div className="max-w-[600px] p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">Retention & Residency</h1>
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
      <div className="flex flex-col items-start gap-4">
        <div>
          <div className="flex items-center gap-1">
            <Label htmlFor="data-policy-transcript-retention" className="font-bold">
              Transcript retention (days)
            </Label>
            <FieldHint
              id="data-policy-transcript-retention-hint"
              content="How long transcripts are kept before the nightly retention purge job deletes them — ignored while Indefinite is checked, which stores -1 and exempts them from purge entirely."
            />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Input
              id="data-policy-transcript-retention"
              type="number"
              value={policy.retentionTranscriptsDays === -1 ? "" : policy.retentionTranscriptsDays}
              disabled={!canEdit || policy.retentionTranscriptsDays === -1}
              onChange={(e) => setPolicy({ ...policy, retentionTranscriptsDays: Number(e.target.value) })}
              className="max-w-[120px]"
            />
            <div className="flex items-center gap-1">
              <Checkbox
                id="data-policy-transcript-indefinite"
                disabled={!canEdit}
                checked={policy.retentionTranscriptsDays === -1}
                onCheckedChange={(checked) => setPolicy({ ...policy, retentionTranscriptsDays: checked ? -1 : 30 })}
              />
              <Label htmlFor="data-policy-transcript-indefinite" className="flex items-center gap-2">
                Indefinite
              </Label>
              <FieldHint
                id="data-policy-transcript-indefinite-hint"
                content="Exempts transcripts from the retention purge job entirely by storing -1 instead of a day count — overrides whatever value is in the days field to the left."
              />
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1">
            <Label htmlFor="data-policy-region" className="font-bold">
              Storage region
            </Label>
            <FieldHint
              id="data-policy-region-hint"
              content="Which regional data center stores this tenant's data at rest — also determines which model providers count as in-region for the out-of-region inference setting below."
            />
          </div>
          <Select
            value={policy.residencyRegion}
            onValueChange={(v) => setPolicy({ ...policy, residencyRegion: v as DataPolicy["residencyRegion"] })}
            disabled={!canEdit}
          >
            <SelectTrigger id="data-policy-region" className="mt-1 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UAE">UAE</SelectItem>
              <SelectItem value="EU">EU</SelectItem>
              <SelectItem value="US">US</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Checkbox
            id="data-policy-allow-out-of-region"
            disabled={!canEdit}
            checked={policy.allowOutOfRegionInference}
            onCheckedChange={(checked) => setPolicy({ ...policy, allowOutOfRegionInference: checked === true })}
          />
          <Label htmlFor="data-policy-allow-out-of-region" className="flex items-center gap-2">
            Allow out-of-region model inference
          </Label>
          <FieldHint
            id="data-policy-allow-out-of-region-hint"
            content="When off, model inference calls are restricted to providers in the storage region selected above; enabling this permits calls to out-of-region providers too."
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Last retention purge run: {policy.purgeLastRunAt ? new Date(policy.purgeLastRunAt).toLocaleString() : "never"}
        </p>
        {canEdit && <Button onClick={() => void save()}>Save</Button>}
      </div>
    </div>
  );
}
