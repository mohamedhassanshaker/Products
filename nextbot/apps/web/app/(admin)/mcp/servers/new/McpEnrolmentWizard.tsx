"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Card } from "@nextbot/ui/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";

const STEP_LABELS = [
  "Identify",
  "Transport & endpoint",
  "Authentication",
  "Discovery",
  "Classification",
  "Grouping",
  "Runtime policy",
  "Dry run",
  "Enrol",
];

const BACKEND_TYPES = ["Ticketing", "CRM", "ERP", "Billing", "HRIS", "KnowledgeBase", "Custom"] as const;
const CRITICALITIES = ["Low", "Medium", "High", "BusinessCritical"] as const;
const AUTH_METHODS = ["None", "APIKey", "BearerToken", "OAuth2", "CustomHeader", "mTLS"] as const;
const ENVIRONMENTS = ["Sandbox", "Staging", "Production"] as const;
type EnvironmentValue = (typeof ENVIRONMENTS)[number];

interface TransportBindingState {
  environment: EnvironmentValue;
  transport: "StreamableHTTP" | "StdioViaGateway";
  endpointUrl: string;
}
interface AuthBindingState {
  environment: EnvironmentValue;
  authMethod: (typeof AUTH_METHODS)[number];
  credentialPlaintext: string;
}
interface DiscoveredItem {
  kind: "Tool" | "Resource" | "Prompt";
  name: string;
  descriptionSource: string;
  schemaHash: string;
  suggestedIoClass: "Read" | "Write" | null;
  suggestedApprovalTier: "Tier1" | "Tier2" | "Tier3" | null;
  heuristicReason: string | null;
}
interface ClassifyState {
  ioClass: "Read" | "Write";
  approvalTier: "Tier1" | "Tier2" | "Tier3";
  enabled: boolean;
}

/**
 * The 9-step MCP enrolment wizard (Blueprint §6.3, FR-MCP-16+, LLD §14.3.4). The
 * server is authoritative and resumable — every "Continue" click PUTs/POSTs that
 * step's slice to `/api/v1/admin/mcp/enrolments/{draftId}/**` and only advances the
 * local step on a real 2xx response; a rejected step surfaces its message and stays
 * put, mirroring every other RHF-validated form in this console.
 *
 * Deliberately a single-page, section-by-section client component (no dedicated
 * `nexus-ux` dispatch this phase — the step shape, field grouping, and error
 * surfacing all come directly from FR-MCP-16's own enumerated steps and this
 * console's already-established form conventions, `ConnectorWizard.tsx`'s own
 * documented simplification precedent) rather than nine separate routes — the
 * `draftId` is carried in local state and each step's payload independently.
 */
export function McpEnrolmentWizard() {
  const router = useRouter();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [backendType, setBackendType] = useState<(typeof BACKEND_TYPES)[number]>("Custom");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [criticality, setCriticality] = useState<(typeof CRITICALITIES)[number]>("Medium");

  // Step 2
  const [enabledEnvironments, setEnabledEnvironments] = useState<Record<EnvironmentValue, boolean>>({ Sandbox: true, Staging: false, Production: false });
  const [transportBindings, setTransportBindings] = useState<Record<EnvironmentValue, TransportBindingState>>({
    Sandbox: { environment: "Sandbox", transport: "StreamableHTTP", endpointUrl: "" },
    Staging: { environment: "Staging", transport: "StreamableHTTP", endpointUrl: "" },
    Production: { environment: "Production", transport: "StreamableHTTP", endpointUrl: "" },
  });

  // Step 3
  const [authBindings, setAuthBindings] = useState<Record<EnvironmentValue, AuthBindingState>>({
    Sandbox: { environment: "Sandbox", authMethod: "None", credentialPlaintext: "" },
    Staging: { environment: "Staging", authMethod: "None", credentialPlaintext: "" },
    Production: { environment: "Production", authMethod: "None", credentialPlaintext: "" },
  });

  // Step 4
  const [discoveredItems, setDiscoveredItems] = useState<DiscoveredItem[]>([]);
  const [emptyNotice, setEmptyNotice] = useState<string | null>(null);

  // Step 5/6
  const [classify, setClassify] = useState<Record<string, ClassifyState>>({});
  const [capabilityGroups, setCapabilityGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [grouping, setGrouping] = useState<Record<string, string | null>>({});

  // Step 7
  const [timeoutMs, setTimeoutMs] = useState(15000);
  const [retryMax, setRetryMax] = useState(1);
  const [circuitErrorRatePct, setCircuitErrorRatePct] = useState(5);
  const [circuitOpenSeconds, setCircuitOpenSeconds] = useState(60);

  // Step 8
  const [dryRunToolName, setDryRunToolName] = useState("");
  const [dryRunResult, setDryRunResult] = useState<unknown>(undefined);

  // Step 9
  const [enrolResult, setEnrolResult] = useState<{ serverId: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/admin/tools/capability-groups");
      if (res.ok) {
        const data = await res.json();
        setCapabilityGroups((data.capabilityGroups ?? []).map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })));
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/admin/mcp/enrolments", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDraftId(data.draft.id);
      } else {
        setError("Could not start a new enrolment draft.");
      }
    })();
  }, []);

  async function submitStep(path: string, method: "PUT" | "POST", body?: unknown) {
    if (!draftId) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/mcp/enrolments/${draftId}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.title ?? "This step failed. Please review and try again.");
        return null;
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  const activeEnvironments = ENVIRONMENTS.filter((e) => enabledEnvironments[e]);

  async function handleIdentify() {
    const data = await submitStep("/identify", "PUT", { name, description: description || undefined, backendType, ownerUserId, criticality });
    if (data) setStep(2);
  }

  async function handleTransport() {
    const bindings = activeEnvironments.map((e) => transportBindings[e]);
    const data = await submitStep("/transport", "PUT", { bindings });
    if (data) setStep(3);
  }

  async function handleAuth() {
    const bindings = activeEnvironments.map((e) => {
      const b = authBindings[e];
      return { environment: b.environment, authMethod: b.authMethod, credentialPlaintext: b.authMethod !== "None" ? b.credentialPlaintext : undefined };
    });
    const data = await submitStep("/auth", "PUT", { bindings });
    if (data) setStep(4);
  }

  async function handleDiscover() {
    const data = await submitStep("/discover", "POST");
    if (data) {
      setDiscoveredItems(data.items ?? []);
      setEmptyNotice(data.emptyNotice ?? null);
      const initialClassify: Record<string, ClassifyState> = {};
      for (const item of data.items ?? []) {
        initialClassify[`${item.kind}:${item.name}`] = {
          ioClass: item.suggestedIoClass ?? "Write",
          approvalTier: item.suggestedApprovalTier ?? "Tier3",
          enabled: false,
        };
      }
      setClassify(initialClassify);
      setStep(5);
    }
  }

  async function handleClassify() {
    const items = discoveredItems.map((item) => {
      const key = `${item.kind}:${item.name}`;
      const c = classify[key];
      return { kind: item.kind, name: item.name, ioClass: c?.ioClass, approvalTier: c?.approvalTier, enabled: c?.enabled ?? false };
    });
    const data = await submitStep("/classify", "PUT", { items });
    if (data) setStep(6);
  }

  async function handleGrouping() {
    const items = discoveredItems.map((item) => {
      const key = `${item.kind}:${item.name}`;
      return { kind: item.kind, name: item.name, capabilityGroupId: grouping[key] ?? null };
    });
    const data = await submitStep("/grouping", "PUT", { items });
    if (data) setStep(7);
  }

  async function handlePolicy() {
    const data = await submitStep("/policy", "PUT", {
      timeoutMs,
      retryMax,
      retryBackoff: "linear",
      circuitErrorRatePct,
      circuitOpenSeconds,
      egressAllowlist: [],
    });
    if (data) setStep(8);
  }

  async function handleDryRun() {
    const data = await submitStep("/dry-run", "POST", { toolName: dryRunToolName, environment: "Sandbox", args: {} });
    if (data) {
      setDryRunResult(data.rawResult);
      setStep(9);
    }
  }

  async function handleEnrol() {
    const data = await submitStep("/enrol", "POST");
    if (data) {
      setEnrolResult({ serverId: data.serverId });
    }
  }

  const eligibleDryRunTools = discoveredItems.filter((i) => i.kind === "Tool" && classify[`Tool:${i.name}`]?.ioClass === "Read" && classify[`Tool:${i.name}`]?.enabled);

  if (enrolResult) {
    return (
      <div className="max-w-xl">
        <Alert>
          <AlertDescription>
            Server enrolled successfully. It is now visible in the registry.
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => router.push(`/mcp/servers/${enrolResult.serverId}`)}>
          View server
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 font-heading text-lg font-semibold">Enrol an MCP server</h1>
      <p className="mb-6 text-sm text-muted-foreground" role="status">
        Step {step} of 9 — {STEP_LABELS[step - 1]}
      </p>

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 1 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <div className="flex items-center gap-1">
              <label htmlFor="mcp-name" className="text-sm font-medium">Name*</label>
              <FieldHint id="mcp-name-hint" content="A tenant-unique label for this MCP server, shown throughout the registry and drift review." />
            </div>
            <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="mcp-description" className="text-sm font-medium">Description</label>
            <Textarea id="mcp-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Backend type*</label>
            <Select value={backendType} onValueChange={(v) => setBackendType(v as (typeof BACKEND_TYPES)[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKEND_TYPES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <label htmlFor="mcp-owner" className="text-sm font-medium">Owner (user id)*</label>
              <FieldHint id="mcp-owner-hint" content="The named human accountable for reviewing drift on this server." />
            </div>
            <Input id="mcp-owner" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Business criticality*</label>
            <Select value={criticality} onValueChange={(v) => setCriticality(v as (typeof CRITICALITIES)[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRITICALITIES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={busy || !name || !ownerUserId} onClick={handleIdentify}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 2 && (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">
            One endpoint per environment — Sandbox and Production are always separate bindings, never the same connector row.
          </p>
          {ENVIRONMENTS.map((env) => (
            <div key={env} className="flex flex-col gap-2 rounded border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`env-enable-${env}`}
                  checked={enabledEnvironments[env]}
                  onCheckedChange={(checked) => setEnabledEnvironments((prev) => ({ ...prev, [env]: checked === true }))}
                />
                <label htmlFor={`env-enable-${env}`} className="text-sm font-medium">{env}</label>
              </div>
              {enabledEnvironments[env] && (
                <Input
                  placeholder="https://"
                  value={transportBindings[env].endpointUrl}
                  onChange={(e) => setTransportBindings((prev) => ({ ...prev, [env]: { ...prev[env], endpointUrl: e.target.value } }))}
                />
              )}
            </div>
          ))}
          <Button disabled={busy || activeEnvironments.length === 0} onClick={handleTransport}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 3 && (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">
            Sandbox and Production credentials are captured separately — sandbox testing can never reach a live system.
          </p>
          {activeEnvironments.map((env) => (
            <div key={env} className="flex flex-col gap-2 rounded border p-3">
              <label className="text-sm font-medium">{env} authentication method</label>
              <Select
                value={authBindings[env].authMethod}
                onValueChange={(v) => setAuthBindings((prev) => ({ ...prev, [env]: { ...prev[env], authMethod: v as (typeof AUTH_METHODS)[number] } }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUTH_METHODS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              {authBindings[env].authMethod !== "None" && (
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder={`${env} credential value`}
                  value={authBindings[env].credentialPlaintext}
                  onChange={(e) => setAuthBindings((prev) => ({ ...prev, [env]: { ...prev[env], credentialPlaintext: e.target.value } }))}
                />
              )}
            </div>
          ))}
          <Button disabled={busy} onClick={handleAuth}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 4 && (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">Connects to the Sandbox binding and enumerates its tools, resources, and prompts.</p>
          <Button disabled={busy} onClick={handleDiscover}>{busy ? "Discovering…" : "Run discovery"}</Button>
        </Card>
      )}

      {step === 5 && (
        <Card className="flex flex-col gap-4 p-6">
          {emptyNotice && <Alert><AlertDescription>{emptyNotice}</AlertDescription></Alert>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Read/Write</TableHead>
                <TableHead>Approval tier</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {discoveredItems.map((item) => {
                const key = `${item.kind}:${item.name}`;
                const c = classify[key];
                return (
                  <TableRow key={key}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell><Badge variant="secondary">{item.kind}</Badge></TableCell>
                    <TableCell>
                      <Select value={c?.ioClass} onValueChange={(v) => setClassify((prev) => ({ ...prev, [key]: { ...prev[key]!, ioClass: v as "Read" | "Write" } }))}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Read">Read</SelectItem>
                          <SelectItem value="Write">Write</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={c?.approvalTier} onValueChange={(v) => setClassify((prev) => ({ ...prev, [key]: { ...prev[key]!, approvalTier: v as "Tier1" | "Tier2" | "Tier3" } }))}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Tier1">Tier1</SelectItem>
                          <SelectItem value="Tier2">Tier2</SelectItem>
                          <SelectItem value="Tier3">Tier3</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Checkbox checked={c?.enabled ?? false} onCheckedChange={(checked) => setClassify((prev) => ({ ...prev, [key]: { ...prev[key]!, enabled: checked === true } }))} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground">Anything left disabled defaults to Tier3, disabled — fail-closed.</p>
          <Button disabled={busy} onClick={handleClassify}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 6 && (
        <Card className="flex flex-col gap-4 p-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Capability group</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {discoveredItems.map((item) => {
                const key = `${item.kind}:${item.name}`;
                return (
                  <TableRow key={key}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>
                      <Select value={grouping[key] ?? "__ungrouped__"} onValueChange={(v) => setGrouping((prev) => ({ ...prev, [key]: v === "__ungrouped__" ? null : v }))}>
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__ungrouped__">Ungrouped</SelectItem>
                          {capabilityGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Button disabled={busy} onClick={handleGrouping}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 7 && (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <label className="text-sm font-medium">Timeout (ms)</label>
            <Input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm font-medium">Retry max</label>
            <Input type="number" value={retryMax} onChange={(e) => setRetryMax(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm font-medium">Circuit-breaker error rate (%)</label>
            <Input type="number" value={circuitErrorRatePct} onChange={(e) => setCircuitErrorRatePct(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm font-medium">Circuit-open seconds</label>
            <Input type="number" value={circuitOpenSeconds} onChange={(e) => setCircuitOpenSeconds(Number(e.target.value))} />
          </div>
          <Button disabled={busy} onClick={handlePolicy}>{busy ? "Saving…" : "Continue"}</Button>
        </Card>
      )}

      {step === 8 && (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">
            Invokes one already-classified, enabled read-only tool against the Sandbox credential — never Production.
          </p>
          {eligibleDryRunTools.length === 0 ? (
            <Alert><AlertDescription>No tool is both classified Read and enabled yet — go back to step 5 to enable at least one.</AlertDescription></Alert>
          ) : (
            <Select value={dryRunToolName} onValueChange={(v) => setDryRunToolName(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Choose a tool" /></SelectTrigger>
              <SelectContent>
                {eligibleDryRunTools.map((t) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {dryRunResult !== undefined && (
            <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(dryRunResult, null, 2)}</pre>
          )}
          <Button disabled={busy || !dryRunToolName} onClick={handleDryRun}>{busy ? "Running…" : "Run dry run"}</Button>
          {dryRunResult !== undefined && <Button variant="secondary" onClick={() => setStep(9)}>Continue</Button>}
        </Card>
      )}

      {step === 9 && (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">
            This writes the server, its pinned manifest, per-environment bindings, and enabled tools — and records the enrolment in the audit log.
          </p>
          <Button disabled={busy} onClick={handleEnrol}>{busy ? "Enrolling…" : "Enrol"}</Button>
        </Card>
      )}
    </div>
  );
}
