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
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { RoleCheckboxList, type RoleOption } from "./RoleCheckboxList";

/**
 * "+ Invite user" — creates a new Admin Console user with one or more role
 * assignments at creation time (FR-ADM-02 / screen inventory B.8.1). At least one
 * role must be selected before "Create" is enabled — the UI-level mirror of the
 * fail-closed rule the API enforces server-side (`CreateUserRequestSchema`'s
 * `minItems: 1`), so the admin gets immediate feedback rather than a round trip.
 *
 * A real invite-by-email (no password, magic-link acceptance) flow isn't in this
 * dispatch's scope — this creates the account directly with an admin-chosen initial
 * password, the same pattern `registerUser()`/`scripts/seed.ts` already establish for
 * every other Admin Console account in this system.
 */
export function InviteUserModal({
  isOpen,
  onClose,
  roles,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  roles: RoleOption[];
  onSubmit: (value: { email: string; password: string; displayName: string; roleIds: string[] }) => Promise<
    { ok: true } | { ok: false; message: string }
  >;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEmail("");
      setPassword("");
      setDisplayName("");
      setRoleIds([]);
      setError(null);
    }
  }, [isOpen]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const result = await onSubmit({ email: email.trim(), password, displayName: displayName.trim(), roleIds });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onClose();
  }

  const canSubmit = email.trim().length > 0 && password.length >= 8 && displayName.trim().length > 0 && roleIds.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="invite-user-display-name" className="font-bold">
                Display name
              </Label>
              <FieldHint
                id="invite-user-display-name-hint"
                content="The name shown for this user throughout the Admin Console (e.g. the Users table and audit log actor field) — can be changed later."
              />
            </div>
            <Input id="invite-user-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="invite-user-email" className="font-bold">
                Email
              </Label>
              <FieldHint
                id="invite-user-email-hint"
                content="Used as this user's sign-in identifier and where security notifications (e.g. an MFA reset) are sent."
              />
            </div>
            <Input id="invite-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="invite-user-password" className="font-bold">
                Initial password
              </Label>
              <FieldHint
                id="invite-user-password-hint"
                content="The initial sign-in password you're setting for this user — they can change it themselves after their first sign-in."
              />
            </div>
            <Input
              id="invite-user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              At least 8 characters. The user can change this after their first sign-in.
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-bold">Role(s)</p>
            <RoleCheckboxList roles={roles} selected={roleIds} onChange={setRoleIds} />
            <p className="mt-1 text-xs text-muted-foreground">
              At least one role is required — a user with no role assigned cannot sign in (FR-ADM-02).
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !canSubmit}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
