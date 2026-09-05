"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@nextbot/ui/components/ui/dialog";
import { Button } from "@nextbot/ui/components/ui/button";
import { RoleCheckboxList, type RoleOption } from "./RoleCheckboxList";

/**
 * "Change roles" — reassigns an existing user's entire role set (FR-ADM-02 / screen
 * inventory B.8.1's "role assignment" requirement). Replaces the set wholesale (not
 * incremental add/remove), matching `PUT /api/v1/admin/users/{id}/roles`'s semantics.
 * At least one role must remain selected — same fail-closed UI mirror as
 * `InviteUserModal`.
 */
export function ChangeRolesModal({
  isOpen,
  onClose,
  userLabel,
  roles,
  initialRoleIds,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  userLabel: string;
  roles: RoleOption[];
  initialRoleIds: string[];
  onSubmit: (roleIds: string[]) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const [roleIds, setRoleIds] = useState<string[]>(initialRoleIds);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed on open (or when the target user changes) — see `RoleFormModal`'s
  // identical comment on why a `useState(initialRoleIds)` initializer alone would be
  // stale on a second "Change roles" click for a different user.
  useEffect(() => {
    if (isOpen) {
      setRoleIds(initialRoleIds);
      setError(null);
    }
  }, [isOpen, userLabel]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const result = await onSubmit(roleIds);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Change roles — {userLabel}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          <RoleCheckboxList roles={roles} selected={roleIds} onChange={setRoleIds} />
          <p className="mt-1 text-xs text-muted-foreground">
            At least one role is required — removing every role would lock this user out (FR-ADM-02).
          </p>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || roleIds.length === 0}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
