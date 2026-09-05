"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Switch } from "@nextbot/ui/components/ui/switch";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface ConnectorSummary {
  id: string;
  name: string;
}

interface AlertRule {
  id: string;
  connectorId: string;
  metric: "LatencyMs" | "ErrorRatePct" | "OfflineMinutes";
  thresholdValue: number;
  destinationKind: "Email" | "Slack" | "InApp";
  destinationEmail: string | null;
  destinationCredentialId: string | null;
  enabled: boolean;
}

/**
 * B.3A.4 Alert Configuration screen (QA fix UI-D5) — per-connector threshold
 * rule authoring: metric (latency/error-rate/offline-minutes), threshold value,
 * destination (email/Slack/in-app), enabled toggle. Calls the pre-existing
 * `/api/v1/admin/connector-alert-rules` API route (built in an earlier dispatch
 * with no UI in front of it).
 *
 * Plan Phase 3 (client-feedback-batch item 11): relocated here from a standalone
 * `/settings/connector-alerts` screen — B.3A.4 places Alert Configuration as a
 * panel/tab of MCP Health, not a separate Settings entry (its real spec home;
 * the standalone page was a reactive QA patch, not a deliberate design choice).
 * Internals are unchanged by the move — only the host page
 * (`mcp-health/page.tsx`) and import path changed. The old URL still resolves
 * via a redirect (`settings/connector-alerts/page.tsx`) rather than 404ing.
 *
 * **Delivery note (same precedent as the MFA SMS/email stub)**: actually
 * *sending* an email/Slack alert has no real provider wired up yet
 * (`@nextbot/connectors`'s `dispatchAlert` logs server-side instead) — this
 * screen is the real, working authoring surface FR requires; delivery itself
 * stays honestly stubbed until a provider is adopted.
 */
export function ConnectorAlertConfig({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [connectors, setConnectors] = useState<ConnectorSummary[] | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>("");
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [metric, setMetric] = useState<AlertRule["metric"]>("ErrorRatePct");
  const [thresholdValue, setThresholdValue] = useState("10");
  const [destinationKind, setDestinationKind] = useState<AlertRule["destinationKind"]>("InApp");
  const [destinationEmail, setDestinationEmail] = useState("");
  const [enabled, setEnabled] = useState(true);

  async function loadConnectors() {
    const r = await fetchJson<{ connectors: ConnectorSummary[] }>("/api/v1/admin/connectors");
    if (r.kind === "forbidden") return setForbidden(true);
    if (r.kind === "error") return setError(r.message);
    setConnectors(r.data.connectors);
    if (r.data.connectors.length > 0 && !selectedConnectorId) setSelectedConnectorId(r.data.connectors[0]!.id);
  }

  async function loadRules(connectorId: string) {
    if (!connectorId) return setRules([]);
    const r = await fetchJson<{ rules: AlertRule[] }>(`/api/v1/admin/connector-alert-rules?connectorId=${connectorId}`);
    if (r.kind === "forbidden") return setForbidden(true);
    if (r.kind === "error") return setError(r.message);
    setRules(r.data.rules);
  }

  useEffect(() => {
    void loadConnectors();

  }, []);

  useEffect(() => {
    if (selectedConnectorId) void loadRules(selectedConnectorId);

  }, [selectedConnectorId]);

  async function submit() {
    setError(null);
    if (!selectedConnectorId) return setError("Select a connector first.");
    const r = await fetchJson<AlertRule>("/api/v1/admin/connector-alert-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectorId: selectedConnectorId,
        metric,
        thresholdValue: Number(thresholdValue),
        destinationKind,
        destinationEmail: destinationKind === "Email" ? destinationEmail : undefined,
        enabled,
      }),
    });
    if (r.kind === "error" || r.kind === "forbidden") return setError(r.kind === "forbidden" ? r.message : r.message);
    await loadRules(selectedConnectorId);
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Connector Alerts" />;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">Connector Alert Configuration</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {connectors === null ? (
        <Skeleton className="h-24 w-full" role="status" aria-label="Loading connectors" />
      ) : (
        <div className="flex flex-col items-stretch gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="connector-alert-connector" className="min-w-[140px]">
              Connector
            </Label>
            <FieldHint
              id="connector-alert-connector-hint"
              content="Which connector this alert rule set applies to — rules are authored and listed one connector at a time, switching this selector loads that connector's own existing rules below."
            />
            <Select value={selectedConnectorId} onValueChange={(v) => setSelectedConnectorId(v as string)}>
              <SelectTrigger id="connector-alert-connector" className="w-[320px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connectors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {canEdit && (
            <div className="rounded-none border p-4">
              <h2 className="mb-3 font-heading text-sm font-semibold">New alert rule</h2>
              <div className="flex flex-col items-stretch gap-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="connector-alert-metric" className="min-w-[140px]">
                    Metric
                  </Label>
                  <FieldHint
                    id="connector-alert-metric-hint"
                    content="Which of this connector's health signals the rule watches — the Threshold field below is compared against this metric's current value to decide when the alert fires."
                  />
                  <Select value={metric} onValueChange={(v) => setMetric(v as AlertRule["metric"])}>
                    <SelectTrigger id="connector-alert-metric" className="w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ErrorRatePct">Error rate (%)</SelectItem>
                      <SelectItem value="LatencyMs">Latency (ms, p95)</SelectItem>
                      <SelectItem value="OfflineMinutes">Offline (minutes)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="connector-alert-threshold" className="min-w-[140px]">
                    Threshold
                  </Label>
                  <FieldHint
                    id="connector-alert-threshold-hint"
                    content="The value the selected metric must cross before this alert fires — its unit depends on the chosen metric (percent for Error rate, milliseconds for Latency, minutes for Offline)."
                  />
                  <Input
                    id="connector-alert-threshold"
                    type="number"
                    value={thresholdValue}
                    onChange={(e) => setThresholdValue(e.target.value)}
                    className="max-w-[160px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="connector-alert-destination" className="min-w-[140px]">
                    Destination
                  </Label>
                  <FieldHint
                    id="connector-alert-destination-hint"
                    content="Where this alert is delivered when it fires — In-app and Slack post directly, Email reveals a required address field below (delivery itself is currently stubbed server-side, per this screen's own note)."
                  />
                  <Select value={destinationKind} onValueChange={(v) => setDestinationKind(v as AlertRule["destinationKind"])}>
                    <SelectTrigger id="connector-alert-destination" className="w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="InApp">In-app</SelectItem>
                      <SelectItem value="Email">Email</SelectItem>
                      <SelectItem value="Slack">Slack</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {destinationKind === "Email" && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="connector-alert-email" className="min-w-[140px]">
                      Email address
                    </Label>
                    <FieldHint
                      id="connector-alert-email-hint"
                      content="The mailbox this rule sends its alert to once fired — required only because Email is the chosen destination, ignored/omitted from the saved rule otherwise."
                    />
                    <Input
                      id="connector-alert-email"
                      value={destinationEmail}
                      onChange={(e) => setDestinationEmail(e.target.value)}
                      placeholder="ops@tenant.com"
                      className="max-w-[320px]"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Label htmlFor="connector-alert-enabled" className="min-w-[140px]">
                    Enabled
                  </Label>
                  <FieldHint
                    id="connector-alert-enabled-hint"
                    content="Whether this rule is actually evaluated — an existing rule can be authored and saved but left switched off here without deleting it."
                  />
                  <Switch id="connector-alert-enabled" checked={enabled} onCheckedChange={setEnabled} />
                </div>
                <Button onClick={() => void submit()} className="self-start">
                  Save rule
                </Button>
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-2 font-heading text-sm font-semibold">Existing rules for this connector</h2>
            {rules === null ? (
              <Skeleton className="h-16 w-full" role="status" aria-label="Loading alert rules" />
            ) : rules.length === 0 ? (
              <p className="text-muted-foreground">No alert rules configured for this connector yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Threshold</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>{rule.metric}</TableCell>
                      <TableCell>{rule.thresholdValue}</TableCell>
                      <TableCell>
                        {rule.destinationKind}
                        {rule.destinationEmail ? ` (${rule.destinationEmail})` : ""}
                      </TableCell>
                      <TableCell>{rule.enabled ? "Yes" : "No"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
