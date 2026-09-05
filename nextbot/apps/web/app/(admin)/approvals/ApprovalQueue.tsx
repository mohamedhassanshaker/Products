"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { AccessDeniedState } from "@nextbot/ui";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { cn } from "@nextbot/ui/lib/utils";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface ApprovalQueueItem {
  id: string;
  toolCallId: string;
  conversationId: string;
  toolName: string;
  backendName: string | null;
  actionSummary: string;
  channelType: string | null;
  requestedAt: string;
  waitSeconds: number;
  status: string;
}

interface ApprovalDetail extends ApprovalQueueItem {
  inputArgsMasked: Record<string, unknown> | null;
  riskSummary: Record<string, unknown>;
  transcriptExcerpt: Array<{ sender: string; text: string; at: string }>;
  recognizedGoal: string | null;
  customerIdentifier: string | null;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function waitVariant(seconds: number): "destructive" | "secondary" | "default" {
  if (seconds > 3600) return "destructive";
  if (seconds > 900) return "secondary";
  return "default";
}

/**
 * B.3.6 Approval Queue — pending Tier-3 approvals list (timestamp, tool, backend,
 * conversation link, requested action, channel, wait time) + approve/reject/
 * request-more-info detail panel (FR-ADM-04, LLD §6.5).
 */
export function ApprovalQueue({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const [items, setItems] = useState<ApprovalQueueItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const canDecide = permissionLevel === "Write";

  async function reload() {
    setError(null);
    const result = await fetchJson<{ items: ApprovalQueueItem[] }>("/api/v1/admin/approvals");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    // Longest-waiting first (SLA-aware sort, B.3.6).
    setItems([...result.data.items].sort((a, b) => b.waitSeconds - a.waitSeconds));
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void (async () => {
      const result = await fetchJson<ApprovalDetail>(`/api/v1/admin/approvals/${selectedId}`);
      if (result.kind === "ok") setDetail(result.data);
    })();
  }, [selectedId]);

  async function decide(decision: "Approved" | "Rejected" | "MoreInfoRequested") {
    if (!detail) return;
    if ((decision === "Rejected" || decision === "MoreInfoRequested") && !note.trim()) {
      setError("A note is required to reject or request more information.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/approvals/${detail.toolCallId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.title ?? "That decision could not be processed.");
        return;
      }
      setSelectedId(null);
      setNote("");
      await reload();
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Approval Queue" />;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">Approval Queue</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-start gap-6">
        <div className="flex-1">
          {items === null ? (
            <Skeleton className="h-32 w-full" role="status" aria-label="Loading approval queue" />
          ) : items.length === 0 ? (
            <p className="text-muted-foreground">No pending approvals.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Backend</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Wait</TableHead>
                  <TableHead>Conversation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={cn("cursor-pointer", selectedId === item.id && "bg-muted/50")}
                    data-testid={`approval-row-${item.id}`}
                  >
                    <TableCell>{new Date(item.requestedAt).toLocaleString()}</TableCell>
                    <TableCell>{item.toolName}</TableCell>
                    {/* QA Final Review minor item: Backend/action-summary columns
                        (B.3.6's own required columns) were still missing from a
                        previous incomplete fix. */}
                    <TableCell>{item.backendName ?? "—"}</TableCell>
                    <TableCell>{item.actionSummary}</TableCell>
                    <TableCell>{item.channelType ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={waitVariant(item.waitSeconds)}>{formatWait(item.waitSeconds)}</Badge>
                    </TableCell>
                    <TableCell>
                      <NextLink
                        href={`/conversations/${item.conversationId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        View
                      </NextLink>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {detail && (
          <div className="min-w-[320px] flex-1 rounded-none border p-4">
            <h2 className="mb-2 font-heading text-sm font-semibold">{detail.toolName}</h2>
            <p className="mb-1 text-sm text-muted-foreground">Recognized goal: {detail.recognizedGoal ?? "—"}</p>
            <p className="mb-1 text-sm text-muted-foreground">Customer: {detail.customerIdentifier ?? "—"}</p>
            <p className="mt-3 mb-1 text-sm font-bold">Requested action (args)</p>
            <pre className="overflow-x-auto rounded-none bg-muted p-2 text-xs">{JSON.stringify(detail.inputArgsMasked, null, 2)}</pre>
            <p className="mt-3 mb-1 text-sm font-bold">Transcript excerpt</p>
            <div className="mb-3 flex max-h-[200px] flex-col gap-1 overflow-y-auto">
              {detail.transcriptExcerpt.map((m, i) => (
                <p key={i} className="text-xs">
                  <b>{m.sender}:</b> {m.text}
                </p>
              ))}
            </div>

            {canDecide ? (
              <>
                <Textarea
                  aria-label="Decision note"
                  placeholder="Note (required for Reject / Request More Info)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mb-2"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={!!busy} onClick={() => decide("Approved")}>
                    {busy === "Approved" ? "Approving…" : "Approve"}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => decide("Rejected")}>
                    {busy === "Rejected" ? "Rejecting…" : "Reject"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => decide("MoreInfoRequested")}>
                    {busy === "MoreInfoRequested" ? "Requesting…" : "Request More Info"}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">You have read-only access to this queue.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
