"use client";

import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { toast } from "@nextbot/ui/lib/toast";
import type { RoleOption } from "./RoleCheckboxList";
import { InviteUserModal } from "./InviteUserModal";
import { ChangeRolesModal } from "./ChangeRolesModal";

export interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  status: "Active" | "Locked" | "Disabled" | "Invited";
  lastLoginAt: string | null;
  mfaEnrolled: boolean;
  roles: Array<{ id: string; name: string }>;
}

/**
 * The "Users & Roles" screen's user table (FR-ADM-02 / screen inventory B.8.1: name,
 * email, role(s), last login, MFA status) plus the "invite user" and "change roles"
 * actions this screen was entirely missing before this dispatch. `canWrite` gates the
 * three mutating actions (invite, change roles, reset MFA) the same way
 * `ToolPermissionRules`/`RolesTable` gate theirs — a `users_roles: Read`-only caller
 * sees the table but every action is disabled.
 */
export function UsersTable({
  users,
  roles,
  canWrite,
  onRefresh,
}: {
  users: UserListItem[];
  roles: RoleOption[];
  canWrite: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [changingRolesFor, setChangingRolesFor] = useState<UserListItem | null>(null);
  const [resettingMfaId, setResettingMfaId] = useState<string | null>(null);

  async function handleCreate(value: { email: string; password: string; displayName: string; roleIds: string[] }) {
    const res = await fetch("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!res.ok) {
      const problem = await res.json().catch(() => null);
      return { ok: false as const, message: problem?.title ?? "Failed to create user." };
    }
    await onRefresh();
    return { ok: true as const };
  }

  async function handleChangeRoles(userId: string, roleIds: string[]) {
    const res = await fetch(`/api/v1/admin/users/${userId}/roles`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleIds }),
    });
    if (!res.ok) {
      const problem = await res.json().catch(() => null);
      return { ok: false as const, message: problem?.title ?? "Failed to update roles." };
    }
    await onRefresh();
    return { ok: true as const };
  }

  async function handleResetMfa(userId: string) {
    setResettingMfaId(userId);
    const res = await fetch(`/api/v1/admin/users/${userId}/mfa-reset`, { method: "POST" });
    setResettingMfaId(null);
    if (!res.ok) {
      const problem = await res.json().catch(() => null);
      toast.error(problem?.title ?? "Failed to reset MFA.");
      return;
    }
    toast.success("MFA enrollment reset — the user will re-enroll on next login.");
    await onRefresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Every Admin Console user and their assigned role(s). A user with no role assigned cannot sign in (FR-ADM-02).
        </p>
        {canWrite && <Button onClick={() => setInviteOpen(true)}>+ Invite User</Button>}
      </div>
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role(s)</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>MFA</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.displayName}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {u.roles.length === 0 ? (
                    <Badge variant="destructive">No role — cannot sign in</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r.id}>{r.name}</Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</TableCell>
                <TableCell>
                  <Badge variant={u.mfaEnrolled ? "default" : "secondary"}>
                    {u.mfaEnrolled ? "Enrolled" : "Not enrolled"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => setChangingRolesFor(u)}>
                      Change roles
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWrite || !u.mfaEnrolled || resettingMfaId === u.id}
                      onClick={() => void handleResetMfa(u.id)}
                    >
                      {resettingMfaId === u.id ? "Resetting…" : "Reset MFA"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <InviteUserModal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} roles={roles} onSubmit={handleCreate} />
      <ChangeRolesModal
        isOpen={changingRolesFor !== null}
        onClose={() => setChangingRolesFor(null)}
        userLabel={changingRolesFor?.displayName ?? ""}
        roles={roles}
        initialRoleIds={changingRolesFor?.roles.map((r) => r.id) ?? []}
        onSubmit={(roleIds) => {
          if (!changingRolesFor) return Promise.resolve({ ok: false as const, message: "No user selected." });
          return handleChangeRoles(changingRolesFor.id, roleIds);
        }}
      />
    </div>
  );
}
