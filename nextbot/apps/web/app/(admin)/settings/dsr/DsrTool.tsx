"use client";

import { useEffect, useState } from "react";
import { AccessDeniedState } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface DsrRequest {
  id: string;
  requestType: "Search" | "Export" | "Delete";
  customerIdentifier: string;
  status: "Pending" | "InProgress" | "Completed" | "Failed";
  createdAt: string;
}

/** Shape of `DsrOutcome.data` (`apps/web/src/lib/dsr-service.ts`) — the actual
 * matching records a Search/Export response now returns (QA fix UI-D3), not
 * just a count. */
interface CustomerDataAggregate {
  conversations: Array<{ id: string; status: string; language: string; startedAt: string }>;
  messages: Array<{ id: string; conversationId: string; sender: string; createdAt: string }>;
  escalations: Array<{ id: string; conversationId: string; status: string }>;
  toolCalls: Array<{ id: string; conversationId: string; toolName: string; status: string }>;
  auditEntries: Array<{ id: string; actionType: string; occurredAt: string }>;
}

interface DsrOutcome {
  conversationsFound: number;
  messagesFound: number;
  escalationsFound: number;
  toolCallsFound: number;
  auditEntriesFound: number;
  conversationsDeleted?: number;
  toolCallsDeleted?: number;
  escalationsDeleted?: number;
  data?: CustomerDataAggregate;
}

/** B.8.4's GDPR-style "Process Data Subject Request" tool — search/export/delete
 * by customer identifier across all tenant data. Delete is a genuinely destructive
 * action: gated behind an explicit confirm dialog before the request is sent. */
export function DsrTool({ permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const canEdit = permissionLevel === "Write";
  const [requests, setRequests] = useState<DsrRequest[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [requestType, setRequestType] = useState<"Search" | "Export" | "Delete">("Search");
  const [result, setResult] = useState<string | null>(null);
  const [viewedData, setViewedData] = useState<CustomerDataAggregate | null>(null);

  async function reload() {
    const r = await fetchJson<{ requests: DsrRequest[] }>("/api/v1/admin/dsr");
    if (r.kind === "forbidden") return setForbidden(true);
    if (r.kind === "ok") setRequests(r.data.requests);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function submit() {
    setError(null);
    setResult(null);
    if (requestType === "Delete") {
      const confirmed = window.confirm(
        `This will permanently delete every conversation for customer identifier "${identifier}". This cannot be undone. Continue?`,
      );
      if (!confirmed) return;
    }
    setViewedData(null);
    const r = await fetchJson<{ requestId: string; outcome: DsrOutcome } | CustomerDataAggregate>("/api/v1/admin/dsr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestType, customerIdentifier: identifier }),
    });
    if (r.kind === "error" || r.kind === "forbidden") return setError(r.kind === "forbidden" ? r.message : r.message);

    // QA fix (UI-D3): "Search" now returns the same aggregated-data shape
    // "Export" does (`DsrOutcome.data`/the raw export payload) — render it so an
    // admin can inspect the actual matching records before deciding to
    // export/delete, per the spec's explicit three-distinct-actions design.
    if (requestType === "Export") {
      setViewedData(r.data as CustomerDataAggregate);
      setResult(null);
    } else if ("outcome" in r.data) {
      setResult(JSON.stringify(r.data.outcome, null, 2));
      setViewedData(r.data.outcome.data ?? null);
    } else {
      setResult(JSON.stringify(r.data, null, 2));
    }
    await reload();
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Data Subject Requests" />;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-lg font-semibold">Data Subject Requests</h1>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {canEdit && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="dsr-identifier">Customer identifier</Label>
              <FieldHint
                id="dsr-identifier-hint"
                content="The email or phone number used to match this customer's conversations, messages, escalations, tool calls, and audit entries across the tenant."
              />
            </div>
            <Input
              id="dsr-identifier"
              placeholder="Customer identifier (email/phone)"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="max-w-[280px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="dsr-request-type">Request type</Label>
              <FieldHint
                id="dsr-request-type-hint"
                content="Search previews matching records without changing anything; Export returns the full data set; Delete permanently removes every matching conversation after an extra confirmation step."
              />
            </div>
            <Select value={requestType} onValueChange={(v) => setRequestType(v as typeof requestType)}>
              <SelectTrigger id="dsr-request-type" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Search">Search</SelectItem>
                <SelectItem value="Export">Export</SelectItem>
                <SelectItem value="Delete">Delete</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => void submit()}
            variant={requestType === "Delete" ? "destructive" : "default"}
          >
            Submit
          </Button>
        </div>
      )}
      {result && (
        <pre className="mb-4 max-w-full overflow-x-auto rounded-none bg-muted p-2 text-xs">{result}</pre>
      )}

      {viewedData && (
        <div className="mb-6 rounded-none border p-4">
          <h2 className="mb-2 font-heading text-sm font-semibold">Matching records</h2>
          <Table className="mb-3">
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Conversations</TableCell>
                <TableCell>{viewedData.conversations.length}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Messages</TableCell>
                <TableCell>{viewedData.messages.length}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Escalations</TableCell>
                <TableCell>{viewedData.escalations.length}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Tool calls</TableCell>
                <TableCell>{viewedData.toolCalls.length}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Audit entries</TableCell>
                <TableCell>{viewedData.auditEntries.length}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {viewedData.conversations.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conversation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewedData.conversations.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.id}</TableCell>
                    <TableCell>{c.status}</TableCell>
                    <TableCell>{c.language}</TableCell>
                    <TableCell>{new Date(c.startedAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {requests === null ? (
        <Skeleton className="h-24 w-full" role="status" aria-label="Loading data subject requests" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.requestType}</TableCell>
                <TableCell>{r.customerIdentifier}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
