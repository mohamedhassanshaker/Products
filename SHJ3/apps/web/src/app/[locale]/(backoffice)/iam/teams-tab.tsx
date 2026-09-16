"use client";

/**
 * B9 tab 2 — Teams. Membership counts/names are exactly what `page.tsx` fetched via
 * `ListTeamsWithLiveMembership` — "derived live from the Users tab" (the wireframe's own
 * words) is satisfied by `router.refresh()` re-running that use case after any mutation
 * that could change membership, not by anything recomputed here (see `iam-screen.tsx`'s
 * own doc comment).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import type { TeamRosterRow } from "../../../../modules/iam/application/list-teams-with-live-membership.js";
import type { TeamScope } from "../../../../modules/iam/ports/team-repository.js";
import type { IamScreenActions } from "./iam-screen.js";

export interface TeamsTabProps {
  readonly rows: readonly TeamRosterRow[];
  readonly actions: IamScreenActions;
}

export function TeamsTab({ rows, actions }: TeamsTabProps): React.ReactElement {
  const t = useTranslations("iam.teams");
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  // [ASSUMPTION] Both scopes are offered here regardless of which tenant is asking —
  // `TR_Teams_crossEntityScope` is the real, database-level enforcement ("only the
  // Platform tenant may own an AllEntities-scoped team"), surfaced through this dialog's
  // own error state rather than hidden client-side. A nicer version would hide
  // "All entities" entirely for a non-platform tenant, which needs this route to know
  // whether its own tenant IS the platform operator — not exposed to this screen today;
  // flagged rather than silently guessed at.
  const [scope, setScope] = React.useState<TeamScope>("Tenant");

  const columns = React.useMemo<ColumnDef<TeamRosterRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.team.name,
        header: t("columnName"),
        meta: { identifying: true },
      },
      {
        id: "scope",
        accessorFn: (row) => row.team.scope,
        header: t("columnScope"),
        cell: ({ row }) =>
          row.original.team.scope === "AllEntities" ? t("scopeAllEntities") : t("scopeTenant"),
      },
      {
        id: "members",
        accessorFn: (row) => row.memberCount,
        header: t("columnMembers"),
        cell: ({ row }) =>
          row.original.memberCount > 0
            ? row.original.memberDisplayNames.join(", ")
            : t("noMembers"),
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
        <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
          {t("addAction")}
        </Button>
      </div>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.team.id}
        getRowLabel={(row) => row.team.name}
        caption={t("heading")}
        captionVisuallyHidden
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setName("");
            setScope("Tenant");
            setError(null);
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("addDialogTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setPending(true);
              void actions
                .createTeam({ name, scope })
                .then((result) => {
                  if (result.ok) {
                    setDialogOpen(false);
                    setName("");
                    setScope("Tenant");
                    router.refresh();
                  } else {
                    setError(result.error);
                  }
                })
                .finally(() => setPending(false));
            }}
          >
            <FormField label={t("addDialogNameLabel")}>
              {(field) => (
                <Input
                  {...field}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              )}
            </FormField>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                {t("addDialogScopeLabel")}
              </span>
              <RadioGroup value={scope} onValueChange={(value) => setScope(value as TeamScope)}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="Tenant" id="team-scope-tenant" />
                  <Label htmlFor="team-scope-tenant">{t("scopeTenant")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="AllEntities" id="team-scope-all" />
                  <Label htmlFor="team-scope-all">{t("scopeAllEntities")}</Label>
                </div>
              </RadioGroup>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={pending}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={pending}>
                {t("addDialogSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
