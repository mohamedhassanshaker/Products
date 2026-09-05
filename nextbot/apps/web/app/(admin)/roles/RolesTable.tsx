"use client";

import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nextbot/ui/components/ui/tooltip";
import { RoleFormModal, type RoleFormValue } from "./RoleFormModal";

export interface RoleListItem {
  id: string;
  name: string;
  isSystem: boolean;
  permissionMatrix: RoleFormValue["permissionMatrix"];
  mfaRequired: boolean;
}

const SYSTEM_ROLE_TOOLTIP = "System roles are seeded defaults and cannot be edited.";

/**
 * The role editor's list view — every role for the tenant (system + custom), with
 * "+ New Role" and per-row "Edit" wired to `RoleFormModal`. System roles remain fully
 * visible (per this dispatch's explicit requirement) but their Edit action is
 * disabled with an explanatory tooltip rather than hidden outright, so an admin can
 * still see e.g. "Tenant Admin"'s full matrix without being able to change it.
 */
export function RolesTable({
  roles,
  canWrite,
  onRefresh,
}: {
  roles: RoleListItem[];
  canWrite: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RoleListItem | null>(null);

  async function handleCreate(value: RoleFormValue) {
    const res = await fetch("/api/v1/admin/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!res.ok) {
      const problem = await res.json().catch(() => null);
      return { ok: false as const, message: problem?.title ?? "Failed to create role." };
    }
    await onRefresh();
    return { ok: true as const };
  }

  async function handleUpdate(roleId: string, value: RoleFormValue) {
    const res = await fetch(`/api/v1/admin/roles/${roleId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!res.ok) {
      const problem = await res.json().catch(() => null);
      return { ok: false as const, message: problem?.title ?? "Failed to save role." };
    }
    await onRefresh();
    return { ok: true as const };
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Roles define a per-module Read/Write/None permission matrix (FR-ADM-02). Assign roles to users from the Users tab.
        </p>
        {canWrite && <Button onClick={() => setCreateOpen(true)}>+ New Role</Button>}
      </div>
      {/* `TooltipProvider` is mounted once at the app root (`apps/web/app/layout.tsx`) —
          reused here, not re-mounted. */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>MFA required</TableHead>
            <TableHead>
              {/* axe-core `empty-table-header` (found during this dispatch's live
                  scan): a bare empty header cell has no accessible name for screen
                  readers, even though it's visually blank by design (it heads the
                  per-row "Edit" action column) — same fix `UsersTable.tsx`'s
                  trailing header already applies. */}
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.name}</TableCell>
              <TableCell>
                <Badge variant={r.isSystem ? "secondary" : "default"}>{r.isSystem ? "System" : "Custom"}</Badge>
              </TableCell>
              <TableCell>{r.mfaRequired ? "Yes" : "No"}</TableCell>
              <TableCell>
                {r.isSystem ? (
                  <Tooltip>
                    <TooltipTrigger
                      // Each row needs its own stable, unique id — several system
                      // rows can render simultaneously, and a hardcoded singleton
                      // id (fine for `LoginForm.tsx`'s one-off SSO tooltip) would
                      // produce duplicate DOM ids here.
                      id={`system-role-tooltip-trigger-${r.id}`}
                      render={
                        // A truly `disabled` native button never fires hover/focus
                        // events that would open the tooltip (a known Base UI/Radix
                        // gotcha, same one `LoginForm.tsx`'s SSO tooltip already
                        // worked around) — wrap the disabled `Button` in a focusable
                        // `span` and let *that* be the tooltip's real trigger.
                        <span tabIndex={0} className="inline-block">
                          <Button size="sm" variant="ghost" disabled>
                            Edit
                          </Button>
                        </span>
                      }
                    />
                    <TooltipContent>{SYSTEM_ROLE_TOOLTIP}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <RoleFormModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        title="New Role"
      />
      <RoleFormModal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        initial={editing ?? undefined}
        onSubmit={(value) => {
          if (!editing) return Promise.resolve({ ok: false as const, message: "No role selected." });
          return handleUpdate(editing.id, value);
        }}
        title={`Edit Role — ${editing?.name ?? ""}`}
      />
    </div>
  );
}
