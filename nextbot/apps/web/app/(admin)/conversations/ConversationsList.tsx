"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { AccessDeniedState } from "@nextbot/ui";
import { Button, buttonVariants } from "@nextbot/ui/components/ui/button";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import type { ChannelTypeValue, ConversationStatusValue, PermissionLevelValue } from "@nextbot/contracts";
import { fetchJson } from "@/src/lib/fetch-json";

interface ConversationListItem {
  id: string;
  channelId: string;
  channelType: ChannelTypeValue;
  status: ConversationStatusValue;
  recognizedGoal: string | null;
  resolutionType: string | null;
  language: string;
  startedAt: string;
  endedAt: string | null;
  totalCostUsd: string;
  customerIdentifier: string | null;
  lastMessagePreview: string | null;
}

const STATUS_VARIANT: Record<ConversationStatusValue, "default" | "secondary" | "outline" | "destructive"> = {
  Active: "default",
  Resolved: "secondary",
  Escalated: "destructive",
  Abandoned: "outline",
};

// Compact per-channel-type glyph so the list is scannable without a full text label
// in every row — kept intentionally small/emoji-based rather than pulling in an icon
// library just for this column.
const CHANNEL_ICON: Record<ChannelTypeValue, string> = {
  WebWidget: "\u{1F310}", // globe
  WhatsApp: "\u{1F4AC}",
  Messenger: "\u{1F4AC}",
  Instagram: "\u{1F4F7}",
  Voice: "\u{1F4DE}",
  Email: "\u{2709}\u{FE0F}",
  Sms: "\u{1F4F1}",
  Slack: "\u{1F4AC}",
  Teams: "\u{1F4AC}",
};

/** U1 fix (QA fix pass) — same masking convention as elsewhere in this admin console
 * (Channels screen's credential display): show only the last 4 characters of a
 * customer identifier, never the raw value, in a list of rows an operator scans. */
function maskCustomerIdentifier(identifier: string | null): string {
  if (!identifier) return "—";
  if (identifier.length <= 4) return identifier;
  return `••••${identifier.slice(-4)}`;
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

const RESOLUTION_VARIANT: Record<string, "default" | "secondary" | "outline"> = { AI: "default", Human: "secondary", Abandoned: "outline" };

interface Filters {
  channelId: string;
  status: string;
  recognizedGoal: string;
  language: string;
  startedAfter: string;
  startedBefore: string;
}

const EMPTY_FILTERS: Filters = { channelId: "", status: "", recognizedGoal: "", language: "", startedAfter: "", startedBefore: "" };

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.channelId) params.set("channelId", filters.channelId);
  if (filters.status) params.set("status", filters.status);
  if (filters.recognizedGoal) params.set("recognizedGoal", filters.recognizedGoal);
  if (filters.language) params.set("language", filters.language);
  if (filters.startedAfter) params.set("startedAfter", new Date(filters.startedAfter).toISOString());
  if (filters.startedBefore) params.set("startedBefore", new Date(filters.startedBefore).toISOString());
  return params.toString();
}

/**
 * Conversation List admin screen (Phase 13, BL-06, screen inventory B.4.1) — filter
 * by status/date/recognized task/language, paginate, and export CSV/JSON.
 *
 * Two filters are deliberately absent, disclosed rather than silently cut (U7, QA fix
 * pass): `backend` (which connector backend handled a conversation's tool calls) and
 * `channelId` (which channel a conversation came in on) — neither has a queryable
 * source yet. `backend` has no `tool_call` fact table (see
 * `admin-conversation-query.ts`'s doc). `channelId` is a real, indexed column on
 * `conversation` (so the predicate-builder still accepts it — see `buildQuery`/
 * `parseConversationFilters` — for forward-compatibility and API testability) but
 * there is no channel-picker data source wired into this screen yet (would need a
 * `GET /channels` list call this phase doesn't otherwise make); adding a real filter
 * control is left to a follow-up phase rather than faked with a free-text channel-id
 * input an operator would have to already know by memory.
 */
export function ConversationsList({ permissionLevel: _permissionLevel }: { permissionLevel: PermissionLevelValue }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionMessage, setBulkActionMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setItems(null);
      setError(null);
      const query = buildQuery(filters);
      const result = await fetchJson<{ items: ConversationListItem[]; total: number }>(`/api/v1/admin/conversations${query ? `?${query}` : ""}`);
      if (result.kind === "forbidden") {
        setForbidden(true);
        return;
      }
      if (result.kind === "ok") {
        setItems(result.data.items ?? []);
        setTotal(result.data.total ?? 0);
      } else {
        setError(result.message);
      }
    })();
  }, [filters]);

  if (forbidden) return <AccessDeniedState moduleLabel="Conversations" />;

  const hasActiveFilters = Object.values(filters).some(Boolean);
  const allSelected = (items?.length ?? 0) > 0 && items!.every((c) => selectedIds.has(c.id));

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!items) return;
    setSelectedIds((prev) => (prev.size === items.length ? new Set() : new Set(items.map((c) => c.id))));
  }

  /** U6 fix (QA fix pass) — applies a bulk "tag"/"archive" action to every currently
   * selected row via `PATCH /api/v1/admin/conversations/bulk`, then re-fetches the
   * list so the UI reflects the persisted result rather than an optimistic guess. */
  async function runBulkAction(action: "tag" | "archive") {
    if (selectedIds.size === 0) return;
    let tag: string | undefined;
    if (action === "tag") {
      const entered = window.prompt("Tag to apply to the selected conversations:");
      if (!entered || !entered.trim()) return;
      tag = entered.trim();
    }
    setBulkActionMessage(null);
    const result = await fetchJson<{ updated: number }>("/api/v1/admin/conversations/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationIds: Array.from(selectedIds), action, ...(tag ? { tag } : {}) }),
    });
    if (result.kind === "ok") {
      setBulkActionMessage(`${action === "tag" ? "Tagged" : "Archived"} ${result.data.updated} conversation${result.data.updated === 1 ? "" : "s"}.`);
      setSelectedIds(new Set());
      setFilters((f) => ({ ...f })); // re-trigger the fetch effect
    } else if (result.kind === "forbidden") {
      setBulkActionMessage(result.message);
    } else {
      setBulkActionMessage(result.message);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Conversations</h1>
        <div className="flex gap-2">
          <a
            href={`/api/v1/admin/conversations/export?format=csv&${buildQuery(filters)}`}
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            Export CSV
          </a>
          <a
            href={`/api/v1/admin/conversations/export?format=json&${buildQuery(filters)}`}
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            Export JSON
          </a>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="flex max-w-[200px] flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="conversations-filter-status">Status</Label>
            <FieldHint
              id="conversations-filter-status-hint"
              content="Restricts the list to conversations currently in this lifecycle state (e.g. Escalated hides everything the AI already resolved or that was handed to a human) — combines with the other filters below."
            />
          </div>
          <Select value={filters.status || undefined} onValueChange={(v) => setFilters((f) => ({ ...f, status: (v as string) || "" }))}>
            <SelectTrigger id="conversations-filter-status">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
              <SelectItem value="Escalated">Escalated</SelectItem>
              <SelectItem value="Abandoned">Abandoned</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex max-w-[200px] flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="conversations-filter-goal">Recognized task</Label>
            <FieldHint
              id="conversations-filter-goal-hint"
              content="Matches the internal task identifier the AI's goal-recognition step assigned to a conversation (e.g. order_status) — the same value shown in each row's Recognized task column, not free-text search over the transcript."
            />
          </div>
          <Input
            id="conversations-filter-goal"
            placeholder="e.g. order_status"
            value={filters.recognizedGoal}
            onChange={(e) => setFilters((f) => ({ ...f, recognizedGoal: e.target.value }))}
          />
        </div>
        <div className="flex max-w-[160px] flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="conversations-filter-language">Language</Label>
            <FieldHint
              id="conversations-filter-language-hint"
              content="Filters by the conversation's detected language code (e.g. en) as recorded at conversation start — not the admin console's own display language."
            />
          </div>
          <Input
            id="conversations-filter-language"
            placeholder="en"
            value={filters.language}
            onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value }))}
          />
        </div>
        <div className="flex max-w-[200px] flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="conversations-filter-started-after">Started after</Label>
            <FieldHint
              id="conversations-filter-started-after-hint"
              content="Only include conversations whose first message arrived on or after this date — combines with Started before to bound a date range."
            />
          </div>
          <Input
            id="conversations-filter-started-after"
            type="date"
            value={filters.startedAfter}
            onChange={(e) => setFilters((f) => ({ ...f, startedAfter: e.target.value }))}
          />
        </div>
        <div className="flex max-w-[200px] flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="conversations-filter-started-before">Started before</Label>
            <FieldHint
              id="conversations-filter-started-before-hint"
              content="Only include conversations whose first message arrived on or before this date — leave blank to include everything up to now."
            />
          </div>
          <Input
            id="conversations-filter-started-before"
            type="date"
            value={filters.startedBefore}
            onChange={(e) => setFilters((f) => ({ ...f, startedBefore: e.target.value }))}
          />
        </div>
        {hasActiveFilters && (
          <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!items ? (
        <Skeleton className="h-32 w-full" role="status" aria-label="Loading conversations" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">
          {hasActiveFilters ? "No conversations match these filters." : "No conversations yet — they'll appear here once customers start chatting."}
        </p>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-none border bg-muted/50 p-2">
              <p className="text-sm">{selectedIds.size} selected</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void runBulkAction("tag")}>
                  Tag
                </Button>
                <Button size="sm" variant="outline" onClick={() => void runBulkAction("archive")}>
                  Archive
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  Clear selection
                </Button>
              </div>
            </div>
          )}
          {bulkActionMessage && (
            <Alert className="mb-3">
              <AlertDescription>{bulkActionMessage}</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all conversations" />
                </TableHead>
                <TableHead>Conversation ID</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Last message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recognized task</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Resolution</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>
                  <span className="sr-only">Trace link</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelected(c.id)} aria-label={`Select conversation ${c.id}`} />
                  </TableCell>
                  <TableCell>
                    <NextLink href={`/conversations/${c.id}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                      {c.id.slice(0, 8)}…
                    </NextLink>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger render={<span className="text-sm">{CHANNEL_ICON[c.channelType] ?? "❓"}</span>} />
                      <TooltipContent>{c.channelType}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-xs">{maskCustomerIdentifier(c.customerIdentifier)}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs">
                    {c.lastMessagePreview ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                  </TableCell>
                  <TableCell>{c.recognizedGoal ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs">{formatDuration(c.startedAt, c.endedAt)}</TableCell>
                  <TableCell>
                    {c.resolutionType ? (
                      <Badge variant={RESOLUTION_VARIANT[c.resolutionType] ?? "outline"}>{c.resolutionType}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{c.language}</TableCell>
                  <TableCell>{new Date(c.startedAt).toLocaleString()}</TableCell>
                  <TableCell>${Number(c.totalCostUsd).toFixed(4)}</TableCell>
                  <TableCell>
                    <NextLink href={`/conversations/${c.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      View trace
                    </NextLink>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-4 text-sm text-muted-foreground">
            {items.length} of {total} conversations
          </p>
        </>
      )}
    </div>
  );
}
