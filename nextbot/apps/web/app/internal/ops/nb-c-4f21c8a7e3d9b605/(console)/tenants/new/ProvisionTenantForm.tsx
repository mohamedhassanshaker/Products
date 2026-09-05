"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Card } from "@nextbot/ui/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import type { PlanTierValue, RegionValue } from "@nextbot/contracts";

const REGIONS: RegionValue[] = ["UAE", "EU", "US"];
const PLAN_TIERS: PlanTierValue[] = ["Starter", "Growth", "Enterprise"];

/**
 * Platform Manager console Provisioning form (NFR-11) — the first real UI wired to
 * `provisionTenant()` (previously only ever called from `scripts/seed.ts`/tests).
 * Submits directly to `POST /api/internal/ops/tenants`, whose body is validated
 * server-side against the existing `ProvisionTenantRequestSchema` — this form only
 * needs its own client-side `required`/pattern hints, never a second source of truth
 * for validation rules.
 *
 * Every field has an explicit associated `<Label htmlFor>` (this codebase's recurring
 * defect class across the shadcn migration) — audited specifically for this form per
 * the dispatch's own gotcha list.
 */
export function ProvisionTenantForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [region, setRegion] = useState<RegionValue>("US");
  const [planTier, setPlanTier] = useState<PlanTierValue>("Starter");
  const [defaultLanguage, setDefaultLanguage] = useState("en");
  const [indefiniteRetention, setIndefiniteRetention] = useState(true);
  const [transcriptsDays, setTranscriptsDays] = useState("365");
  const [toolPayloadsDays, setToolPayloadsDays] = useState("90");
  const [toolMetadataDays, setToolMetadataDays] = useState("365");
  const [piiDays, setPiiDays] = useState("30");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const retention = indefiniteRetention
      ? { mode: "indefinite" as const }
      : {
          transcriptsDays: Number(transcriptsDays),
          toolPayloadsDays: Number(toolPayloadsDays),
          toolMetadataDays: Number(toolMetadataDays),
          piiDays: Number(piiDays),
        };

    const res = await fetch("/api/internal/ops/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, slug, region, planTier, defaultLanguage, retention }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.title ?? "Failed to provision tenant.");
      return;
    }
    const created = await res.json();
    router.push(`/internal/ops/tenants/${created.id}`);
  }

  return (
    <Card className="max-w-lg p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">Provision new tenant</h1>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="provision-name">Tenant name</Label>
            <Input id="provision-name" required maxLength={200} className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provision-slug">Slug</Label>
            <Input
              id="provision-slug"
              required
              maxLength={63}
              // QA retry 2, Defect 3 fix: current Chromium compiles the HTML `pattern`
              // attribute's regex with the 'v' (unicodeSets) flag, not the legacy 'u'
              // flag — under 'v', an unescaped trailing `-` in a character class that
              // already contains a range (`[a-z0-9-]`) is a syntax error ("Invalid
              // character class"), because a bare `-` there is ambiguous with v-mode's
              // class-difference (`--`) operator syntax. Reproduced directly:
              // `new RegExp("[a-z0-9-]", "v")` throws; `new RegExp("[a-z0-9\\-]", "v")`
              // does not. Escaping the hyphen (`\-`) is valid and unambiguous under
              // both 'u' and 'v', so this is the one correct fix rather than
              // reordering the hyphen to a range boundary (which the QA report's own
              // "should be fine as written" note already ruled out as the actual
              // cause). Server-side validation (`ProvisionTenantRequestSchema`, a 409
              // on a bad slug) remains the authoritative check regardless — this only
              // restores the client-side hint.
              pattern="[a-z0-9\-]+"
              placeholder="acme-corp"
              className="mt-1"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="provision-region">Region</Label>
            <Select value={region} onValueChange={(v) => setRegion(v as RegionValue)}>
              <SelectTrigger id="provision-region" aria-label="Region" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="provision-plan-tier">Plan tier</Label>
            <Select value={planTier} onValueChange={(v) => setPlanTier(v as PlanTierValue)}>
              <SelectTrigger id="provision-plan-tier" aria-label="Plan tier" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_TIERS.map((tier) => (
                  <SelectItem key={tier} value={tier}>
                    {tier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="provision-default-language">Default language (ISO 639-1)</Label>
            <Input
              id="provision-default-language"
              required
              minLength={2}
              maxLength={2}
              className="mt-1 w-24"
              value={defaultLanguage}
              onChange={(e) => setDefaultLanguage(e.target.value)}
            />
          </div>

          <div className="rounded-none border p-3">
            <Label className="flex items-center gap-2">
              <Checkbox checked={indefiniteRetention} onCheckedChange={(v) => setIndefiniteRetention(Boolean(v))} />
              Indefinite retention (no automatic purge)
            </Label>
            {!indefiniteRetention && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="provision-retention-transcripts">Transcripts (days)</Label>
                  <Input
                    id="provision-retention-transcripts"
                    type="number"
                    min={1}
                    className="mt-1"
                    value={transcriptsDays}
                    onChange={(e) => setTranscriptsDays(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="provision-retention-tool-payloads">Tool payloads (days)</Label>
                  <Input
                    id="provision-retention-tool-payloads"
                    type="number"
                    min={1}
                    className="mt-1"
                    value={toolPayloadsDays}
                    onChange={(e) => setToolPayloadsDays(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="provision-retention-tool-metadata">Tool metadata (days)</Label>
                  <Input
                    id="provision-retention-tool-metadata"
                    type="number"
                    min={1}
                    className="mt-1"
                    value={toolMetadataDays}
                    onChange={(e) => setToolMetadataDays(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="provision-retention-pii">PII (days)</Label>
                  <Input
                    id="provision-retention-pii"
                    type="number"
                    min={1}
                    className="mt-1"
                    value={piiDays}
                    onChange={(e) => setPiiDays(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <Alert variant="destructive" aria-live="assertive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Provisioning…" : "Provision tenant"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
