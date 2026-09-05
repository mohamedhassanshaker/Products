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
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Switch } from "@nextbot/ui/components/ui/switch";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { toast } from "@nextbot/ui/lib/toast";
import type { PermissionLevelValue, PermissionMatrix, RbacModuleValue } from "@nextbot/contracts";
import { PermissionMatrixEditor, emptyPermissionMatrix } from "./PermissionMatrixEditor";

export interface RoleFormValue {
  name: string;
  permissionMatrix: PermissionMatrix;
  mfaRequired: boolean;
}

/**
 * Create/edit dialog for a custom role — the role editor half of the "Users & Roles"
 * screen (FR-ADM-02 / screen inventory B.8.1). Shared between "+ New Role" (no
 * `initial`) and "Edit" on an existing custom role (`initial` supplied); system roles
 * never reach this component in edit mode (`RolesTable` disables Edit for them).
 *
 * Also exposes the QA Defect B3 `mfaRequired` per-role toggle here — the only place
 * in the Admin Console that surfaces it, since it was previously wired end-to-end in
 * the backend/schema but had no UI control at all.
 */
export function RoleFormModal({
  isOpen,
  onClose,
  initial,
  onSubmit,
  title,
}: {
  isOpen: boolean;
  onClose: () => void;
  initial?: RoleFormValue;
  onSubmit: (value: RoleFormValue) => Promise<{ ok: true } | { ok: false; message: string }>;
  title: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [matrix, setMatrix] = useState<PermissionMatrix>(initial?.permissionMatrix ?? emptyPermissionMatrix());
  const [mfaRequired, setMfaRequired] = useState(initial?.mfaRequired ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed local state whenever a *different* initial value is opened with — using
  // `initial` directly as a `useState` initializer would freeze the very first
  // render's value and never pick up a subsequent "Edit" click on a different role
  // (the non-reactive-initializer gotcha this project has hit before).
  useEffect(() => {
    if (isOpen) {
      setName(initial?.name ?? "");
      setMatrix(initial?.permissionMatrix ?? emptyPermissionMatrix());
      setMfaRequired(initial?.mfaRequired ?? false);
      setError(null);
    }
  }, [isOpen, initial]);

  function updateLevel(module: RbacModuleValue, level: PermissionLevelValue) {
    setMatrix((prev) => ({ ...prev, [module]: level }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const result = await onSubmit({ name: name.trim(), permissionMatrix: matrix, mfaRequired });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success("Role saved.");
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="role-form-name" className="font-bold">
                Role name
              </Label>
              <FieldHint
                id="role-form-name-hint"
                content="The display name shown for this role throughout the Admin Console (e.g. in the Roles table and user role assignments) — must be unique per tenant."
              />
            </div>
            <Input id="role-form-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="role-form-mfa-required">Require MFA for users with this role</Label>
              <FieldHint
                id="role-form-mfa-required-hint"
                content="When on, every user assigned this role must complete MFA enrollment before they can access the Admin Console, regardless of their individual MFA setting."
              />
            </div>
            <Switch id="role-form-mfa-required" checked={mfaRequired} onCheckedChange={setMfaRequired} />
          </div>
          <div>
            <p className="mb-1 text-xs font-bold">Permission matrix</p>
            <PermissionMatrixEditor matrix={matrix} onChange={updateLevel} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !name.trim()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
