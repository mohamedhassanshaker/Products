"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { fetchJson } from "../../../../../../src/lib/fetch-json";

interface DriftEvent {
  id: string;
  changeKind: "ItemAdded" | "ItemRemoved" | "SchemaChanged";
  itemKind: "Tool" | "Resource" | "Prompt";
  itemName: string;
  resolution: "Pending" | "Accepted" | "Rejected";
}

/** `/mcp/servers/{id}/drift` — reuses Phase 0's existing drift-event data/reconciler
 * unchanged; this screen is new UI over that already-shipped backend. */
export function McpDriftReview({ serverId, canWrite }: { serverId: string; canWrite: boolean }) {
  const [events, setEvents] = useState<DriftEvent[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "Accept" | "Reject">>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const result = await fetchJson<{ driftEvents: DriftEvent[] }>(`/api/v1/admin/mcp/servers/${serverId}/drift`);
    if (result.kind === "ok") setEvents(result.data.driftEvents ?? []);
  }

  useEffect(() => {
    void load();
  }, [serverId]);

  async function handleSubmit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const decisionList = Object.entries(decisions).map(([driftEventId, action]) => ({ driftEventId, action, enabled: false }));
      const res = await fetch(`/api/v1/admin/mcp/servers/${serverId}/drift/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions: decisionList }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.title ?? "Drift review failed.");
      } else {
        setMessage(`Accepted ${data.accepted}, rejected ${data.rejected}.`);
        setDecisions({});
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!events) return <Skeleton className="h-32 w-full" role="status" aria-label="Loading drift events" />;

  return (
    <div>
      <h1 className="mb-6 font-heading text-lg font-semibold">Drift review</h1>
      {message && <p className="mb-4" role="status">{message}</p>}
      {events.length === 0 ? (
        <p className="text-muted-foreground">No pending drift.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Change</TableHead>
                {canWrite && <TableHead>Decision</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.itemName}</TableCell>
                  <TableCell><Badge variant="secondary">{e.itemKind}</Badge></TableCell>
                  <TableCell>{e.changeKind}</TableCell>
                  {canWrite && (
                    <TableCell>
                      <Select value={decisions[e.id] ?? ""} onValueChange={(v) => setDecisions((prev) => ({ ...prev, [e.id]: v as "Accept" | "Reject" }))}>
                        <SelectTrigger className="w-32"><SelectValue placeholder="Choose" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Accept">Accept</SelectItem>
                          <SelectItem value="Reject">Reject</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canWrite && (
            <div className="mt-4">
              <Alert className="mb-3">
                <AlertDescription>
                  Any accepted item defaults to Tier3, disabled, until reviewed further on the server&apos;s Manifest tab.
                </AlertDescription>
              </Alert>
              <Button disabled={submitting || Object.keys(decisions).length === 0} onClick={handleSubmit}>
                {submitting ? "Submitting…" : "Submit decisions"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
