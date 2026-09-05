"use client";

import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@nextbot/ui/components/ui/button";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@nextbot/ui/components/ui/alert-dialog";
import { AccessDeniedState } from "@nextbot/ui";
import { toast } from "@nextbot/ui/lib/toast";
import { cn } from "@nextbot/ui/lib/utils";
import { fetchJson } from "@/src/lib/fetch-json";
import { CapabilityGroupFormModal, type CapabilityGroupFormValue } from "./CapabilityGroupFormModal";

interface CapabilityGroupListItem {
  id: string;
  name: string;
  guidanceText: string | null;
  priorityWeight: number;
  toolCount: number;
}

const READONLY_TOOLTIP = "You have read-only access to this module";

/**
 * Capability Group management screen (Phase 6, BL-28, FR-MCP-17). The `capability_
 * group` table and its runtime enforcement (`tool.capability_group_id`, the Design
 * Studio's tool-policy picker) already shipped in earlier phases — this screen is the
 * missing authoring surface: create/edit/delete over that existing schema, no new
 * table (LLD §14.3.3).
 *
 * Delete is a soft-delete plus an in-transaction reassignment of every member tool to
 * Ungrouped (never a cascade delete of the tools) — the confirmation dialog shows the
 * real affected-tool count fetched *before* the user confirms, from the same DELETE
 * route's "dry run" (`?confirm=1` omitted) response, so the count can never drift from
 * what actually happens on confirm.
 */
export function CapabilityGroupManager({ canMutate }: { canMutate: boolean }) {
  const [groups, setGroups] = useState<CapabilityGroupListItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CapabilityGroupListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CapabilityGroupListItem | null>(null);
  const [affectedToolCount, setAffectedToolCount] = useState<number | null>(null);

  async function load() {
    const result = await fetchJson<{ capabilityGroups: CapabilityGroupListItem[] }>("/api/v1/admin/tools/capability-groups");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "ok") setGroups(result.data.capabilityGroups ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreateOrUpdate(value: CapabilityGroupFormValue): Promise<{ ok: true } | { ok: false; message: string }> {
    const body = { name: value.name, guidanceText: value.guidanceText || undefined, priorityWeight: value.priorityWeight };
    const result = editing
      ? await fetchJson(`/api/v1/admin/tools/capability-groups/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetchJson("/api/v1/admin/tools/capability-groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
    if (result.kind !== "ok") return { ok: false, message: result.message };
    await load();
    return { ok: true };
  }

  /** Fetches the real affected-tool count (the DELETE route's dry-run response,
   * `?confirm=1` omitted) before opening the confirmation dialog — so the count shown
   * can never drift from what confirming actually does. */
  async function openDeleteConfirm(group: CapabilityGroupListItem) {
    const result = await fetchJson<{ requiresConfirmation: true; affectedToolCount: number }>(`/api/v1/admin/tools/capability-groups/${group.id}`, {
      method: "DELETE",
    });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    setAffectedToolCount(result.data.affectedToolCount);
    setDeleteTarget(group);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const result = await fetchJson(`/api/v1/admin/tools/capability-groups/${deleteTarget.id}?confirm=1`, { method: "DELETE" });
    setDeleteTarget(null);
    setAffectedToolCount(null);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Capability group deleted — its tools are now Ungrouped.");
    await load();
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Capability Groups" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Capability Groups</h1>
        {canMutate && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + New Group
          </Button>
        )}
      </div>

      {!groups ? (
        <Skeleton className="h-[120px] w-full" role="status" aria-label="Loading capability groups" />
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground">
          No capability groups yet. Groups let you bundle related tools (e.g. all billing tools) so an agent's tool policy or the Design Studio's
          tool-policy picker can reference the whole bundle instead of listing every tool individually.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Guidance</TableHead>
              <TableHead>Priority weight</TableHead>
              <TableHead>Tools</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.id}>
                <TableCell>{g.name}</TableCell>
                <TableCell className="max-w-[320px] truncate text-sm text-muted-foreground">{g.guidanceText ?? "—"}</TableCell>
                <TableCell>{g.priorityWeight}</TableCell>
                <TableCell>{g.toolCount}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span tabIndex={canMutate ? -1 : 0} className="inline-block">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={!canMutate}
                              onClick={() => {
                                setEditing(g);
                                setFormOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                          </span>
                        }
                      />
                      {!canMutate && <TooltipContent>{READONLY_TOOLTIP}</TooltipContent>}
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span tabIndex={canMutate ? -1 : 0} className="inline-block">
                            <Button size="xs" variant="destructive" disabled={!canMutate} onClick={() => void openDeleteConfirm(g)}>
                              Delete
                            </Button>
                          </span>
                        }
                      />
                      {!canMutate && <TooltipContent>{READONLY_TOOLTIP}</TooltipContent>}
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        Assigning a tool to a group happens on that tool&apos;s own row —{" "}
        <a href="/tools" className={cn(buttonVariants({ variant: "link", size: "sm" }), "p-0")}>
          open Tool Catalog
        </a>
        .
      </p>

      <CapabilityGroupFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        initial={editing ? { name: editing.name, guidanceText: editing.guidanceText ?? "", priorityWeight: editing.priorityWeight } : undefined}
        onSubmit={handleCreateOrUpdate}
        title={editing ? `Edit ${editing.name}` : "New capability group"}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setAffectedToolCount(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {affectedToolCount === 0
                ? "No tools are currently assigned to this group — deleting it is safe."
                : `${affectedToolCount} tool${affectedToolCount === 1 ? "" : "s"} currently assigned to this group will become Ungrouped — they are never deleted or disabled themselves.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete group
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
