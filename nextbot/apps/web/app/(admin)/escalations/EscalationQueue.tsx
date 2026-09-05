"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessDeniedState } from "@nextbot/ui";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";
import { PresenceToggle } from "./PresenceToggle";

interface EscalationQueueItem {
  id: string;
  conversationId: string;
  channelType: string | null;
  customerIdentifier: string | null;
  recognizedGoal: string | null;
  reason: string;
  waitSeconds: number;
  queueId: string;
  queueName: string | null;
  status: string;
  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — SLA aging indicator.
  slaDueAt: string | null;
  slaBreached: boolean;
}

const REASON_LABEL: Record<string, string> = {
  LowConfidence: "Low confidence",
  ToolFailure: "Tool failure",
  CustomerRequest: "Customer request",
  SensitiveTopic: "Sensitive topic",
};

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function waitVariant(seconds: number): "destructive" | "secondary" | "default" {
  if (seconds > 900) return "destructive";
  if (seconds > 300) return "secondary";
  return "default";
}

/**
 * B.5.1 Escalation Queue — active escalations awaiting human pickup, SLA-aware
 * sorted (longest wait first, per the API's own sort). "Take Over" navigates to the
 * Live Takeover Panel (B.5.2); "Return to Bot" is available directly from the queue
 * row too (FR-ESC-04 doesn't require a takeover first).
 */
export function EscalationQueue({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const router = useRouter();
  const [items, setItems] = useState<EscalationQueueItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canAct = permissionLevel === "Write";

  async function reload() {
    setError(null);
    const result = await fetchJson<{ items: EscalationQueueItem[] }>("/api/v1/admin/escalations");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    setItems(result.data.items);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function takeOver(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/escalations/${id}/claim`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.title ?? "Could not take over this escalation.");
        return;
      }
      router.push(`/escalations/${id}`);
    } finally {
      setBusyId(null);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Escalation Queue" />;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">Escalation Queue</h1>
      {canAct && <PresenceToggle />}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {items === null ? (
        <Skeleton className="h-32 w-full" role="status" aria-label="Loading escalation queue" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">No active escalations.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conversation</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Recognized goal</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Wait</TableHead>
              <TableHead>Queue</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid={`escalation-row-${item.id}`}>
                <TableCell className="font-mono text-xs">{item.conversationId.slice(0, 8)}…</TableCell>
                <TableCell>{item.channelType ?? "—"}</TableCell>
                <TableCell>{item.customerIdentifier ?? "—"}</TableCell>
                <TableCell>{item.recognizedGoal ?? "—"}</TableCell>
                <TableCell>{REASON_LABEL[item.reason] ?? item.reason}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Badge variant={waitVariant(item.waitSeconds)}>{formatWait(item.waitSeconds)}</Badge>
                    {/* Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — the
                        SLA sweep's own visual output: a breached item is visually
                        distinguishable rather than merely "waiting a long time". */}
                    {item.slaBreached && (
                      <Badge variant="destructive" data-testid={`sla-breached-${item.id}`}>
                        SLA breached
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{item.queueName ?? "—"}</TableCell>
                <TableCell>
                  {canAct ? (
                    <Button size="xs" disabled={busyId === item.id} onClick={() => takeOver(item.id)}>
                      {busyId === item.id ? "Taking over…" : "Take Over"}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Read-only</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
