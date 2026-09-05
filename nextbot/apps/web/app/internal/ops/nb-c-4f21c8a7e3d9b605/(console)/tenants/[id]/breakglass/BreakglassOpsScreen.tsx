"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@nextbot/ui/components/ui/card";
import { Button } from "@nextbot/ui/components/ui/button";
import { Label } from "@nextbot/ui/components/ui/label";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

interface ActiveGrantDto {
  grantId: string;
  reason: string;
  expiresAt: string;
}
interface ConversationListItemDto {
  id: string;
  channelType: string;
  status: string;
  recognizedGoal: string | null;
  startedAt: string;
}
interface EscalationListItemDto {
  id: string;
  conversationId: string;
  reason: string;
  status: string;
  waitSeconds: number;
}

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — Break-Glass Access
 * screen: shows whether this tenant currently consents to operator access, lets an
 * operator activate a diagnosis session against an active grant, and — only once
 * activated — browses the tenant's conversations/escalations read-only. There is no
 * write path anywhere on this screen; every list/detail call is gated server-side by
 * `requireActiveBreakglassTenantContext`, re-checked on every single call (a
 * mid-session revocation by the tenant takes effect immediately, not just at the next
 * page load).
 */
export function BreakglassOpsScreen({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<{ activeGrant: ActiveGrantDto | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [activated, setActivated] = useState(false);
  const [conversations, setConversations] = useState<ConversationListItemDto[] | null>(null);
  const [escalations, setEscalations] = useState<EscalationListItemDto[] | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationDetail, setConversationDetail] = useState<unknown>(null);

  const loadStatus = useCallback(async () => {
    setError(null);
    const result = await fetchJson<{ activeGrant: ActiveGrantDto | null }>(`/api/internal/ops/tenants/${tenantId}/breakglass/status`);
    if (result.kind === "forbidden" || result.kind === "error") return setError(result.message);
    setStatus(result.data);
  }, [tenantId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function activate() {
    setBusy(true);
    try {
      const result = await fetchJson(`/api/internal/ops/tenants/${tenantId}/breakglass/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (result.kind === "forbidden" || result.kind === "error") return toast.error(result.message);
      toast.success("Access activated. This session is recorded on both audit trails.");
      setActivated(true);
      await loadDiagnosisData();
    } finally {
      setBusy(false);
    }
  }

  async function loadDiagnosisData() {
    const convResult = await fetchJson<{ conversations: ConversationListItemDto[] }>(`/api/internal/ops/tenants/${tenantId}/breakglass/conversations`);
    if (convResult.kind === "ok") setConversations(convResult.data.conversations);
    const escResult = await fetchJson<{ escalations: EscalationListItemDto[] }>(`/api/internal/ops/tenants/${tenantId}/breakglass/escalations`);
    if (escResult.kind === "ok") setEscalations(escResult.data.escalations);
  }

  async function openConversation(id: string) {
    setSelectedConversationId(id);
    const result = await fetchJson(`/api/internal/ops/tenants/${tenantId}/breakglass/conversations/${id}`);
    if (result.kind === "ok") setConversationDetail((result.data as { conversation: unknown }).conversation);
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!status) {
    return <Skeleton className="h-8 w-64" role="status" aria-label="Loading break-glass status" />;
  }

  const showDiagnosisData = activated && status.activeGrant;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-lg font-semibold">Break-Glass Access</h1>

      <Card className="p-4">
        {status.activeGrant ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <Badge className="bg-emerald-700 text-white">Consent active</Badge>
              <span className="text-sm text-muted-foreground">Expires {new Date(status.activeGrant.expiresAt).toLocaleString()}</span>
            </div>
            <p className="mb-3 text-sm">Tenant's stated reason: {status.activeGrant.reason}</p>
            {!activated && (
              <div className="flex flex-col gap-3">
                <div>
                  <Label htmlFor="ops-breakglass-reason">Your diagnostic reason (recorded on both audit trails)</Label>
                  <Textarea id="ops-breakglass-reason" className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div>
                  <Button disabled={busy || reason.trim().length === 0} onClick={() => void activate()}>
                    Activate access
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <Badge variant="secondary">No active consent grant — access would be denied</Badge>
        )}
      </Card>

      {showDiagnosisData && (
        <>
          <Card className="p-4">
            <h2 className="mb-2 font-heading text-base font-semibold">Conversations</h2>
            {conversations === null ? (
              <Skeleton className="h-8 w-full" />
            ) : conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No conversations.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button className="text-primary underline-offset-4 hover:underline" onClick={() => void openConversation(c.id)}>
                      {c.channelType} — {c.recognizedGoal ?? "(no recognized goal)"} — {new Date(c.startedAt).toLocaleString()}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {selectedConversationId && conversationDetail !== null && (
            <Card className="p-4">
              <h2 className="mb-2 font-heading text-base font-semibold">Conversation detail</h2>
              <pre className="max-h-96 overflow-auto text-xs">{JSON.stringify(conversationDetail, null, 2)}</pre>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="mb-2 font-heading text-base font-semibold">Escalations</h2>
            {escalations === null ? (
              <Skeleton className="h-8 w-full" />
            ) : escalations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No escalations.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {escalations.map((e) => (
                  <li key={e.id}>
                    {e.reason} — {e.status} — waiting {e.waitSeconds}s
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
