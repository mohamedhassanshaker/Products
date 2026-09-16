"use client";

/**
 * B9 tab 1 — Users. A real `DataTable` (§5.5 #41 — "a screen that assembles its own table
 * fails review"), never a hand-rolled `<table>`.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SelectablePill } from "@/components/ui/selectable-pill";
import { StatusCell } from "@/components/ui/status-cell";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DestructiveConfirmDialog,
} from "@/components/patterns/dialog";
import type { UserRosterRow } from "../../../../modules/iam/application/list-users.js";
import type { StaffUserStatus } from "../../../../modules/iam/ports/user-repository.js";
import type { IamScreenActions } from "./iam-screen.js";

export interface UsersTabProps {
  readonly rows: readonly UserRosterRow[];
  readonly teamOptions: readonly { readonly id: string; readonly name: string }[];
  readonly roleOptions: readonly { readonly key: string; readonly displayName: string }[];
  readonly actions: IamScreenActions;
}

/** Rank order for `StatusCell`'s sort (design-system.md §5.4 #39 — never alphabetical). Active first, since it is the state B9 tab 1 is mostly used to confirm. */
const STATUS_RANK: Record<StaffUserStatus, number> = { Active: 0, Invited: 1, Suspended: 2 };
const STATUS_FAMILY: Record<StaffUserStatus, "success" | "info" | "destructive"> = {
  Active: "success",
  Invited: "info",
  Suspended: "destructive",
};

type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "invite" }
  | { readonly kind: "edit"; readonly row: UserRosterRow }
  | { readonly kind: "remove"; readonly row: UserRosterRow };

export function UsersTab({
  rows,
  teamOptions,
  roleOptions,
  actions,
}: UsersTabProps): React.ReactElement {
  const t = useTranslations("iam.users");
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const [pending, setPending] = React.useState(false);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [pendingRowId, setPendingRowId] = React.useState<string | null>(null);

  const statusLabel = React.useCallback(
    (status: StaffUserStatus): string =>
      status === "Active"
        ? t("statusActive")
        : status === "Invited"
          ? t("statusInvited")
          : t("statusSuspended"),
    [t],
  );

  const columns = React.useMemo<ColumnDef<UserRosterRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "displayName",
        header: t("columnName"),
        meta: { identifying: true },
      },
      { id: "email", accessorKey: "email", header: t("columnEmail") },
      {
        id: "team",
        accessorFn: (row) => row.primaryTeamName ?? "",
        header: t("columnTeam"),
        cell: ({ row }) => row.original.primaryTeamName ?? t("noPrimaryTeam"),
      },
      {
        id: "role",
        accessorFn: (row) => row.roleDisplayNames.join(", "),
        header: t("columnRole"),
        cell: ({ row }) =>
          row.original.roleDisplayNames.length > 0
            ? row.original.roleDisplayNames.join(", ")
            : t("noRoles"),
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("columnStatus"),
        cell: ({ row }) => (
          <StatusCell
            label={statusLabel(row.original.status)}
            family={STATUS_FAMILY[row.original.status]}
            rank={STATUS_RANK[row.original.status]}
          />
        ),
        sortingFn: (a, b) => STATUS_RANK[a.original.status] - STATUS_RANK[b.original.status],
      },
    ],
    [t, statusLabel],
  );

  async function afterMutation(result: { ok: boolean; error?: string }): Promise<void> {
    if (result.ok) {
      setDialog({ kind: "none" });
      setRowError(null);
      router.refresh();
    } else {
      setRowError(result.error ?? null);
    }
  }

  async function handleSuspendToggle(row: UserRosterRow): Promise<void> {
    setPendingRowId(row.id);
    setRowError(null);
    const result =
      row.status === "Suspended"
        ? await actions.reactivateUser(row.id)
        : await actions.suspendUser(row.id);
    setPendingRowId(null);
    if (!result.ok) setRowError(result.error);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
        <Button type="button" size="sm" onClick={() => setDialog({ kind: "invite" })}>
          {t("inviteAction")}
        </Button>
      </div>

      {rowError ? <InlineAlert variant="destructive">{rowError}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.displayName}
        caption={t("heading")}
        captionVisuallyHidden
        savingRowIds={new Set(pendingRowId ? [pendingRowId] : [])}
        renderRowActions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialog({ kind: "edit", row })}
            >
              {t("editAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pendingRowId === row.id}
              onClick={() => void handleSuspendToggle(row)}
            >
              {row.status === "Suspended" ? t("reactivateAction") : t("suspendAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialog({ kind: "remove", row })}
            >
              {t("removeAction")}
            </Button>
          </div>
        )}
      />

      <InviteUserDialog
        open={dialog.kind === "invite"}
        onOpenChange={(open) => setDialog(open ? { kind: "invite" } : { kind: "none" })}
        pending={pending}
        setPending={setPending}
        onSubmit={async (input) => afterMutation(await actions.inviteUser(input))}
        t={t}
      />

      {dialog.kind === "edit" ? (
        <EditUserDialog
          row={dialog.row}
          teamOptions={teamOptions}
          roleOptions={roleOptions}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          pending={pending}
          setPending={setPending}
          loadEditContext={actions.loadUserEditContext}
          onSubmit={async (input) => afterMutation(await actions.editUser(input))}
          t={t}
        />
      ) : null}

      {dialog.kind === "remove" ? (
        <DestructiveConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          title={t("removeConfirmTitle")}
          objectName={dialog.row.displayName}
          descriptionTemplate={(name) => t("removeConfirmDescription", { name })}
          actionLabel={t("removeConfirmAction")}
          cancelLabel={t("cancel")}
          confirming={pending}
          onConfirm={async () => {
            setPending(true);
            const result = await actions.removeUser(dialog.row.id);
            setPending(false);
            await afterMutation(result);
          }}
        />
      ) : null}
    </div>
  );
}

interface InviteUserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly setPending: (pending: boolean) => void;
  readonly onSubmit: (input: { email: string; displayName: string }) => Promise<void>;
  readonly t: ReturnType<typeof useTranslations>;
}

function InviteUserDialog({
  open,
  onOpenChange,
  pending,
  setPending,
  onSubmit,
  t,
}: InviteUserDialogProps) {
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setDisplayName("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("inviteDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            void onSubmit({ email, displayName }).finally(() => setPending(false));
          }}
        >
          <FormField label={t("inviteDialogNameLabel")}>
            {(field) => (
              <Input
                {...field}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("inviteDialogEmailLabel")}>
            {(field) => (
              <Input
                {...field}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("inviteDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditUserDialogProps {
  readonly row: UserRosterRow;
  readonly teamOptions: readonly { readonly id: string; readonly name: string }[];
  readonly roleOptions: readonly { readonly key: string; readonly displayName: string }[];
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly setPending: (pending: boolean) => void;
  readonly loadEditContext: IamScreenActions["loadUserEditContext"];
  readonly onSubmit: (input: {
    staffUserId: string;
    displayName: string;
    email: string;
    teamIds: readonly string[];
    roleKeys: readonly string[];
  }) => Promise<void>;
  readonly t: ReturnType<typeof useTranslations>;
}

function EditUserDialog({
  row,
  teamOptions,
  roleOptions,
  onOpenChange,
  pending,
  setPending,
  loadEditContext,
  onSubmit,
  t,
}: EditUserDialogProps) {
  const [displayName, setDisplayName] = React.useState(row.displayName);
  const [email, setEmail] = React.useState(row.email);
  const [teamIds, setTeamIds] = React.useState<readonly string[]>([]);
  const [roleKeys, setRoleKeys] = React.useState<readonly string[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadEditContext(row.id).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setTeamIds(result.value.teamIds);
        setRoleKeys(result.value.roleKeys);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // Deliberately depends only on `row.id`, not `loadEditContext`: this effect only ever
    // re-runs for a genuinely different row — `EditUserDialog` is mounted fresh per
    // `dialog.kind === "edit"` state (see UsersTab), never reused across two users, so
    // there is no stale-closure risk to guard against here.
  }, [row.id]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("editDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            void onSubmit({ staffUserId: row.id, displayName, email, teamIds, roleKeys }).finally(
              () => setPending(false),
            );
          }}
        >
          <FormField label={t("editDialogNameLabel")}>
            {(field) => (
              <Input
                {...field}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("editDialogEmailLabel")}>
            {(field) => (
              <Input
                {...field}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}
          </FormField>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">{t("editDialogTeamsLabel")}</span>
            <div className="flex flex-wrap gap-2">
              {teamOptions.map((team) => (
                <SelectablePill
                  key={team.id}
                  variant="multi"
                  checked={teamIds.includes(team.id)}
                  disabled={loading}
                  onCheckedChange={(checked) =>
                    setTeamIds((current) =>
                      checked ? [...current, team.id] : current.filter((id) => id !== team.id),
                    )
                  }
                >
                  {team.name}
                </SelectablePill>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">{t("editDialogRolesLabel")}</span>
            <div className="flex flex-wrap gap-2">
              {roleOptions.map((role) => (
                <SelectablePill
                  key={role.key}
                  variant="multi"
                  checked={roleKeys.includes(role.key)}
                  disabled={loading}
                  onCheckedChange={(checked) =>
                    setRoleKeys((current) =>
                      checked ? [...current, role.key] : current.filter((key) => key !== role.key),
                    )
                  }
                >
                  {role.displayName}
                </SelectablePill>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={loading}>
              {t("editDialogSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
