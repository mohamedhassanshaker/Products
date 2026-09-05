"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Card } from "@nextbot/ui/components/ui/card";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue, WebhookEventCategoryValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface SubscriptionRow {
  id: string;
  targetUrl: string;
  eventCategories: string[];
  enabled: boolean;
  createdAt: string;
}

interface DeliveryRow {
  id: string;
  eventCategory: string;
  status: "Pending" | "Success" | "Failed" | "Exhausted";
  attemptCount: number;
  lastResponseCode: number | null;
  lastErrorMessage: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

const ALL_CATEGORIES: WebhookEventCategoryValue[] = ["EscalationCreated", "ApprovalPending", "GuardrailTripped", "DeploymentChanged", "DriftDetected"];

const STATUS_BADGE: Record<string, { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Success: { className: "bg-emerald-700 text-white" },
  Pending: { variant: "secondary" },
  Failed: { className: "bg-orange-800 text-white" },
  Exhausted: { variant: "destructive" },
};

/**
 * Settings → Webhooks (Target Architecture Blueprint Phase 18, BL-49, FR-API-02) —
 * subscription CRUD plus the per-subscription delivery log FR-API-02 requires for
 * debugging failed deliveries.
 */
export function WebhookSettings({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTargetUrl, setNewTargetUrl] = useState("");
  const [newCategories, setNewCategories] = useState<Set<WebhookEventCategoryValue>>(new Set());
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveriesById, setDeliveriesById] = useState<Record<string, DeliveryRow[]>>({});

  async function reload() {
    setError(null);
    const result = await fetchJson<{ subscriptions: SubscriptionRow[] }>("/api/v1/admin/webhooks");
    if (result.kind === "forbidden") return setForbidden(true);
    if (result.kind === "error") return setError(result.message);
    setSubscriptions(result.data.subscriptions);
  }

  useEffect(() => {
    void reload();
  }, []);

  function toggleCategory(category: WebhookEventCategoryValue) {
    setNewCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function createSubscription() {
    if (!newTargetUrl || newCategories.size === 0) return;
    const result = await fetchJson<{ signingSecret: string }>("/api/v1/admin/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetUrl: newTargetUrl, eventCategories: Array.from(newCategories) }),
    });
    if (result.kind === "error") return setError(result.message);
    if (result.kind === "ok") setIssuedSecret(result.data.signingSecret);
    setNewTargetUrl("");
    setNewCategories(new Set());
    await reload();
  }

  async function toggleEnabled(sub: SubscriptionRow) {
    await fetchJson(`/api/v1/admin/webhooks/${sub.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !sub.enabled }),
    });
    await reload();
  }

  async function deleteSubscription(id: string) {
    await fetchJson(`/api/v1/admin/webhooks/${id}`, { method: "DELETE" });
    await reload();
  }

  async function loadDeliveries(id: string) {
    const result = await fetchJson<{ deliveries: DeliveryRow[] }>(`/api/v1/admin/webhooks/${id}/deliveries`);
    if (result.kind === "ok") setDeliveriesById((prev) => ({ ...prev, [id]: result.data.deliveries }));
  }

  async function toggleExpanded(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    await loadDeliveries(id);
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Webhooks" />;
  if (subscriptions === null) {
    return (
      <div className="max-w-[880px] p-6">
        <h1 className="sr-only">Webhooks</h1>
        <Skeleton className="h-48 w-full" role="status" aria-label="Loading webhook subscriptions" />
      </div>
    );
  }

  return (
    <div className="max-w-[880px] p-6">
      <h1 className="mb-1 font-heading text-lg font-semibold">Webhooks</h1>
      <p className="mb-6 text-muted-foreground">
        Subscribe an endpoint to receive signed, at-least-once notifications for escalation, approval, guardrail,
        deployment, and MCP-drift events.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {issuedSecret && (
        <Alert className="mb-4">
          <AlertDescription>
            Copy this signing secret now — it will not be shown again: <code className="break-all">{issuedSecret}</code>
          </AlertDescription>
        </Alert>
      )}

      {canEdit && (
        <Card className="mb-6 p-4">
          <h2 className="mb-4 font-semibold">New subscription</h2>
          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="new-webhook-url">Target URL</Label>
              <Input
                id="new-webhook-url"
                className="mt-1"
                placeholder="https://example.com/webhooks/nextbot"
                value={newTargetUrl}
                onChange={(e) => setNewTargetUrl(e.target.value)}
              />
            </div>
            <div>
              <Label>Event categories</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {ALL_CATEGORIES.map((category) => (
                  <Button
                    key={category}
                    type="button"
                    size="sm"
                    variant={newCategories.has(category) ? "default" : "outline"}
                    onClick={() => toggleCategory(category)}
                  >
                    {category}
                  </Button>
                ))}
              </div>
            </div>
            <Button type="button" onClick={createSubscription} className="self-start">
              Create subscription
            </Button>
          </div>
        </Card>
      )}

      <ul className="flex flex-col gap-3">
        {subscriptions.map((sub) => (
          <Card key={sub.id} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="break-all font-medium">{sub.targetUrl}</p>
                <p className="text-sm text-muted-foreground">
                  {sub.eventCategories.join(", ")} · {sub.enabled ? "Enabled" : "Disabled"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => toggleExpanded(sub.id)}>
                  {expanded === sub.id ? "Hide log" : "Delivery log"}
                </Button>
                {canEdit && (
                  <>
                    <Button type="button" size="sm" variant="ghost" onClick={() => toggleEnabled(sub)}>
                      {sub.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => deleteSubscription(sub.id)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>

            {expanded === sub.id && (
              <div className="mt-4 border-t border-border pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Last response</TableHead>
                      <TableHead>Next/delivered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(deliveriesById[sub.id] ?? []).map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.eventCategory}</TableCell>
                        <TableCell>
                          <Badge {...(STATUS_BADGE[d.status] ?? {})}>{d.status}</Badge>
                        </TableCell>
                        <TableCell>{d.attemptCount}</TableCell>
                        <TableCell>{d.lastResponseCode ?? d.lastErrorMessage ?? "—"}</TableCell>
                        <TableCell>{d.deliveredAt ?? d.nextAttemptAt}</TableCell>
                      </TableRow>
                    ))}
                    {(deliveriesById[sub.id] ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No deliveries yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        ))}
        {subscriptions.length === 0 && <li className="text-sm text-muted-foreground">No webhook subscriptions yet.</li>}
      </ul>
    </div>
  );
}
