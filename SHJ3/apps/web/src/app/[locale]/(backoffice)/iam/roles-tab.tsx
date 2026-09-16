"use client";

/**
 * B9 tab 3 — Roles & permissions. The real `PermissionMatrix` (design-system.md §5.5 #43),
 * already built to the full keyboard/undo/`confirmChange`/`isLocked` spec — this file wires
 * real data into it, never modifies its interaction model.
 *
 * ## The separation-of-duties confirmation
 *
 * B9's own rule: *"Agent Designer can build but not publish. Publishing is an Entity Admin
 * action — separation of duties between authoring and release."* `PermissionMatrix`'s
 * `confirmChange` seam is deliberately generic (it has no idea what "Publish agents" or
 * "Agent Designer" mean — see that hook's own doc comment) and is callback-shaped
 * (`(changes) => boolean | Promise<boolean>`), while the real confirmation affordance in
 * this codebase, `DestructiveConfirmDialog`, is `open`/`onOpenChange`/`onConfirm`-shaped —
 * an imperative dialog, not a promise. `useSeparationOfDutiesConfirm` below is the bridge:
 * it inspects a proposed batch for exactly the one shape the rule cares about (granting
 * `agents:publish` to a role that is neither Super Admin nor Entity Admin), and when it
 * matches, opens the real dialog and returns a `Promise<boolean>` that resolves only when
 * the user actually clicks Confirm or Cancel/closes it — never resolved early, so
 * `PermissionMatrix` genuinely waits for a human decision before applying the change.
 *
 * ## `isLocked` — the protected cell
 *
 * `TR_RolePermissions_protectSuperAdmin` (`prisma/sql/001_constraints.sql`) blocks
 * revoking Super Admin's `users:manage` grant at the database. `isLocked` renders that
 * cell as visually locked *before* a user ever tries to toggle it — proactive UX, not a
 * replacement for the real enforcement, which still runs server-side in
 * `PrismaRoleRepository.updatePermissions()` regardless of what this client believes.
 *
 * ## Optimistic-then-reconciled writes
 *
 * `PermissionMatrix` applies a change to its own internal grid immediately (optimistic —
 * see its own doc comment on why the grid is seeded once, not fully controlled) and reports
 * it via `onCellsChange`. If the server rejects it (the protected cell, reached some way
 * other than this client's own `isLocked` check — a stale client, a second admin's
 * concurrent edit), this file calls `router.refresh()` to re-fetch the real, persisted
 * matrix and reconcile the visible grid back to what the database actually holds, and shows
 * `protectedCellNotice` explaining why.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DestructiveConfirmDialog,
} from "@/components/patterns/dialog";
import {
  PermissionMatrix,
  type PermissionMatrixChange,
  type PermissionMatrixGrid,
} from "@/components/patterns/permission-matrix/permission-matrix";
import { ROLE_KEYS, type Permission } from "../../../../modules/iam/domain/permissions.js";
import type {
  PermissionCatalogEntry,
  Role,
} from "../../../../modules/iam/ports/role-repository.js";
import type { IamScreenActions } from "./iam-screen.js";

export interface RolesTabProps {
  readonly roles: readonly Role[];
  readonly permissionCatalog: readonly PermissionCatalogEntry[];
  readonly matrix: Readonly<Record<string, readonly Permission[]>>;
  readonly actions: IamScreenActions;
}

const PUBLISH_PERMISSION: Permission = "agents:publish";
const USERS_MANAGE_PERMISSION: Permission = "users:manage";
/** Only these two roles may hold `agents:publish` without tripping the separation-of-duties confirmation — matches `RESTRICTED_PERMISSIONS["agents:publish"]` in `domain/permissions.ts`. */
const PUBLISH_ADMIN_ROLE_KEYS: ReadonlySet<string> = new Set([
  ROLE_KEYS.SuperAdmin,
  ROLE_KEYS.EntityAdmin,
]);

type Translate = ReturnType<typeof useTranslations>;

/**
 * The `confirmChange` bridge described in the module comment.
 *
 * `roleLabelById` is needed so the dialog can restate the *display* name
 * (`DestructiveConfirmDialog`'s `objectName` — "the object's name, restated verbatim" — its
 * own required prop), not the raw persisted role key.
 */
function useSeparationOfDutiesConfirm(
  t: Translate,
  roleLabelById: ReadonlyMap<string, string>,
): {
  readonly confirmChange: (
    changes: readonly PermissionMatrixChange[],
  ) => boolean | Promise<boolean>;
  readonly dialog: React.ReactNode;
} {
  const [pending, setPending] = React.useState<{
    readonly roleId: string;
    readonly resolve: (value: boolean) => void;
  } | null>(null);

  const confirmChange = React.useCallback(
    (changes: readonly PermissionMatrixChange[]): boolean | Promise<boolean> => {
      const violating = changes.find(
        (change) =>
          change.granted &&
          change.permissionId === PUBLISH_PERMISSION &&
          !PUBLISH_ADMIN_ROLE_KEYS.has(change.roleId),
      );
      if (!violating) return true;

      return new Promise<boolean>((resolve) => {
        setPending({ roleId: violating.roleId, resolve });
      });
    },
    [],
  );

  const dialog = pending ? (
    <DestructiveConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          pending.resolve(false);
          setPending(null);
        }
      }}
      title={t("separationConfirmTitle")}
      objectName={roleLabelById.get(pending.roleId) ?? pending.roleId}
      descriptionTemplate={(roleLabel) => t("separationConfirmDescription", { roleLabel })}
      actionLabel={t("separationConfirmAction")}
      cancelLabel={t("cancel")}
      onConfirm={() => {
        pending.resolve(true);
        setPending(null);
      }}
    />
  ) : null;

  return { confirmChange, dialog };
}

export function RolesTab({
  roles,
  permissionCatalog,
  matrix,
  actions,
}: RolesTabProps): React.ReactElement {
  const t = useTranslations("iam.roles");
  const router = useRouter();
  const [addRoleOpen, setAddRoleOpen] = React.useState(false);
  const [addRoleName, setAddRoleName] = React.useState("");
  const [addRolePending, setAddRolePending] = React.useState(false);
  const [addRoleError, setAddRoleError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const permissionEntities = React.useMemo(
    () => permissionCatalog.map((entry) => ({ id: entry.key, label: entry.displayName })),
    [permissionCatalog],
  );
  const roleEntities = React.useMemo(
    () => roles.map((role) => ({ id: role.key, label: role.displayName })),
    [roles],
  );
  const roleLabelById = React.useMemo(
    () => new Map(roles.map((role) => [role.key, role.displayName])),
    [roles],
  );

  const { confirmChange, dialog: separationDialog } = useSeparationOfDutiesConfirm(
    t,
    roleLabelById,
  );

  const defaultValue = React.useMemo<PermissionMatrixGrid>(() => {
    const grid = new Map<string, Map<string, boolean>>();
    for (const permission of permissionCatalog) {
      const perRole = new Map<string, boolean>();
      for (const role of roles) {
        perRole.set(role.key, (matrix[role.key] ?? []).includes(permission.key));
      }
      grid.set(permission.key, perRole);
    }
    return grid;
    // Deliberately empty deps: seeded once — PermissionMatrix's own documented contract
    // ("defaultValue seeds the grid once, on mount"). Recomputing this memo when `matrix`
    // changes does NOT re-seed an already-mounted PermissionMatrix; only a genuine page
    // reload (or this component remounting) does, which is exactly the deliberate
    // one-way-seed model it specifies. (No `react-hooks/exhaustive-deps` rule is
    // configured in this project, so no disable directive is needed here.)
  }, []);

  const isLocked = React.useCallback(
    (permissionId: string, roleId: string) =>
      permissionId === USERS_MANAGE_PERMISSION && roleId === ROLE_KEYS.SuperAdmin,
    [],
  );

  const handleCellsChange = React.useCallback(
    (changes: readonly PermissionMatrixChange[]) => {
      void actions
        .updateRolePermissions(
          changes.map((change) => ({
            roleKey: change.roleId,
            permission: change.permissionId as Permission,
            granted: change.granted,
          })),
        )
        .then((result) => {
          if (!result.ok) {
            setNotice(t("protectedCellNotice"));
            // Reconciles the optimistic grid back to the real, persisted matrix — see
            // the module comment's "optimistic-then-reconciled" section.
            router.refresh();
          }
        });
    },
    [actions, router, t],
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>

      {notice ? <InlineAlert variant="warning">{notice}</InlineAlert> : null}

      <PermissionMatrix
        permissions={permissionEntities}
        roles={roleEntities}
        defaultValue={defaultValue}
        onCellsChange={handleCellsChange}
        confirmChange={confirmChange}
        isLocked={isLocked}
        onAddCustomRole={() => setAddRoleOpen(true)}
        addCustomRoleLabel={t("addRoleAction")}
        caption={t("matrixCaption")}
        captionVisuallyHidden
        permissionColumnLabel={t("permissionColumnLabel")}
        ruleSummary={<p className="text-sm text-muted-foreground">{t("ruleSummary")}</p>}
      />

      {separationDialog}

      <Dialog
        open={addRoleOpen}
        onOpenChange={(open) => {
          setAddRoleOpen(open);
          if (!open) {
            setAddRoleName("");
            setAddRoleError(null);
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("addRoleDialogTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setAddRolePending(true);
              void actions
                .createCustomRole({ displayName: addRoleName })
                .then((result) => {
                  if (result.ok) {
                    setAddRoleOpen(false);
                    setAddRoleName("");
                    router.refresh();
                  } else {
                    setAddRoleError(result.error);
                  }
                })
                .finally(() => setAddRolePending(false));
            }}
          >
            {addRoleError ? <InlineAlert variant="destructive">{addRoleError}</InlineAlert> : null}
            <FormField label={t("addRoleDialogNameLabel")}>
              {(field) => (
                <Input
                  {...field}
                  value={addRoleName}
                  onChange={(event) => setAddRoleName(event.target.value)}
                  required
                />
              )}
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddRoleOpen(false)}
                disabled={addRolePending}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={addRolePending}>
                {t("addRoleDialogSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
