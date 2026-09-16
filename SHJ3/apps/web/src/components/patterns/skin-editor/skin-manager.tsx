"use client";

/**
 * §9.1's Skin manager sub-block: "list, apply, duplicate, rename, delete, export,
 * import" — the system-seeded default plus every tenant-authored skin.
 *
 * A real `DataTable` (§5.5 #41 — "A screen that assembles its own table fails
 * review"), never a hand-rolled `<table>`; `no-raw-table.mjs` has no exemption for
 * `skin-editor/`, matching every other feature screen in this codebase.
 *
 * Export produces TWO downloadable JSON files, one per mode, rather than one
 * combined document: `@shj3/tokens`' real, already-tested skin schema (`skin.ts`) is
 * genuinely per-mode (`Skin.mode: "light" | "dark" | "system"`, one `tokens` object)
 * — exactly how `SHARJAH_DEFAULT`/`SHARJAH_DARK` themselves ship as two separate
 * files, not one. Inventing a combined-pair wrapper format `validateSkin`/
 * `parseSkinDocument` do not recognise would mean either a second, parallel schema
 * (real drift risk against the already-tested one) or exporting something an import
 * elsewhere could never validate. Import is the mirror: it lands ONE mode's
 * validated, gap-filled colours into whichever mode tab is currently open in the
 * candidate (never a second, parallel "unapplied skin" persistence path) — see this
 * component's own `onImport` contract and `tasks/todo.md`'s review entry for the full
 * reasoning.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DestructiveConfirmDialog,
} from "@/components/patterns/dialog";
import { DataTable } from "@/components/patterns/data-table/data-table";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { SkinIssue } from "@shj3/tokens";
import type { SkinEditorDeletionResult, SkinEditorSkinEntry } from "./skin-editor-types.js";

export interface SkinManagerProps {
  readonly skins: readonly SkinEditorSkinEntry[];
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onApplyTenant: (skinId: string) => Promise<void>;
  readonly onApplyPersonal: (skinId: string) => Promise<void>;
  readonly onDuplicate: (sourceSkinId: string, newName: string) => Promise<void>;
  readonly onRename: (skinId: string, name: string, description: string | null) => Promise<void>;
  readonly onDelete: (skinId: string) => Promise<SkinEditorDeletionResult>;
  readonly onExport: (skinId: string, mode: "light" | "dark") => Promise<void>;
  readonly onImport: (mode: "light" | "dark", fileText: string) => Promise<readonly SkinIssue[]>;
}

/** next-intl's translator function type, independent of which namespace string was
 *  passed at the call site (the namespace argument changes runtime key resolution,
 *  never the function's own type) — avoids fragile generic-parameterised gymnastics
 *  for a value threaded through several small dialog-slot components below. */
type Translate = ReturnType<typeof useTranslations>;

type DialogState =
  | { kind: "none" }
  | { kind: "duplicate"; skin: SkinEditorSkinEntry }
  | { kind: "rename"; skin: SkinEditorSkinEntry }
  | { kind: "delete"; skin: SkinEditorSkinEntry }
  | { kind: "delete-blocked"; skin: SkinEditorSkinEntry; reason: string }
  | { kind: "import" };

export function SkinManager({
  skins,
  canManage,
  busy,
  onApplyTenant,
  onApplyPersonal,
  onDuplicate,
  onRename,
  onDelete,
  onExport,
  onImport,
}: SkinManagerProps) {
  const t = useTranslations("skinEditor.manager");
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });

  const columns = React.useMemo<ColumnDef<SkinEditorSkinEntry, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("heading"),
        meta: { identifying: true },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.name}</span>
            {row.original.isSystem ? (
              <Badge variant="neutral" size="sm" label={t("systemBadge")} />
            ) : null}
            {row.original.isActive ? (
              <Badge variant="success" size="sm" label={t("activeBadge")} />
            ) : null}
          </div>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t("heading")}</h3>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDialog({ kind: "import" })}
          >
            {t("importAction")}
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={skins}
        getRowId={(skin) => skin.id}
        getRowLabel={(skin) => skin.name}
        caption={t("heading")}
        captionVisuallyHidden
        renderRowActions={(skin) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={busy}>
                {t("rowActionsLabel")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canManage ? (
                <DropdownMenuItem
                  onSelect={() => void onApplyTenant(skin.id)}
                  disabled={skin.isActive}
                >
                  {t("applyAction")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => void onApplyPersonal(skin.id)}>
                {t("applyToMeAction")}
              </DropdownMenuItem>
              {canManage ? (
                <>
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "duplicate", skin })}>
                    {t("duplicateAction")}
                  </DropdownMenuItem>
                  {!skin.isSystem ? (
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "rename", skin })}>
                      {t("renameAction")}
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
              <DropdownMenuItem onSelect={() => void onExport(skin.id, "light")}>
                {t("exportLightAction")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onExport(skin.id, "dark")}>
                {t("exportDarkAction")}
              </DropdownMenuItem>
              {canManage && !skin.isSystem ? (
                <DropdownMenuItem
                  variant="destructive"
                  confirmationDescription={skin.name}
                  onSelect={() => setDialog({ kind: "delete", skin })}
                >
                  {t("deleteAction")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <DuplicateDialog state={dialog} setDialog={setDialog} onDuplicate={onDuplicate} t={t} />
      <RenameDialog state={dialog} setDialog={setDialog} onRename={onRename} t={t} />
      <ImportDialog state={dialog} setDialog={setDialog} onImport={onImport} t={t} />

      {dialog.kind === "delete" ? (
        <DestructiveConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          title={t("deleteDialogTitle")}
          objectName={dialog.skin.name}
          actionLabel={t("deleteDialogAction")}
          onConfirm={() => {
            void (async () => {
              const result = await onDelete(dialog.skin.id);
              if (result.blocked) {
                setDialog({ kind: "delete-blocked", skin: dialog.skin, reason: result.reason });
              } else {
                setDialog({ kind: "none" });
              }
            })();
          }}
        />
      ) : null}

      {dialog.kind === "delete-blocked" ? (
        <Dialog open onOpenChange={(open) => !open && setDialog({ kind: "none" })}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>{t("deleteBlockedTitle")}</DialogTitle>
              <DialogDescription>{dialog.reason}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="primary" onClick={() => setDialog({ kind: "none" })}>
                {t("deleteBlockedDismiss")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

interface DialogSlotProps {
  readonly state: DialogState;
  readonly setDialog: (state: DialogState) => void;
  readonly t: Translate;
}

function DuplicateDialog({
  state,
  setDialog,
  onDuplicate,
  t,
}: DialogSlotProps & { onDuplicate: (sourceSkinId: string, newName: string) => Promise<void> }) {
  const [name, setName] = React.useState("");
  const open = state.kind === "duplicate";

  React.useEffect(() => {
    if (state.kind === "duplicate") setName(`${state.skin.name} (2)`);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setDialog({ kind: "none" })}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("duplicateDialogTitle")}</DialogTitle>
        </DialogHeader>
        <FormField label={t("duplicateDialogLabel")} id="skin-manager-duplicate-name">
          {(field) => (
            <Input {...field} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </FormField>
        <DialogFooter>
          <Button
            type="button"
            variant="primary"
            disabled={name.trim().length === 0}
            onClick={() => {
              if (state.kind !== "duplicate") return;
              void onDuplicate(state.skin.id, name.trim()).then(() => setDialog({ kind: "none" }));
            }}
          >
            {t("duplicateDialogAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  state,
  setDialog,
  onRename,
  t,
}: DialogSlotProps & {
  onRename: (skinId: string, name: string, description: string | null) => Promise<void>;
}) {
  const open = state.kind === "rename";
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    if (state.kind === "rename") {
      setName(state.skin.name);
      setDescription(state.skin.description ?? "");
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setDialog({ kind: "none" })}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("renameDialogTitle")}</DialogTitle>
        </DialogHeader>
        <FormField label={t("renameDialogNameLabel")} id="skin-manager-rename-name">
          {(field) => (
            <Input {...field} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </FormField>
        <FormField label={t("renameDialogDescriptionLabel")} id="skin-manager-rename-description">
          {(field) => (
            <Input
              {...field}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </FormField>
        <DialogFooter>
          <Button
            type="button"
            variant="primary"
            disabled={name.trim().length === 0}
            onClick={() => {
              if (state.kind !== "rename") return;
              void onRename(state.skin.id, name.trim(), description.trim() || null).then(() =>
                setDialog({ kind: "none" }),
              );
            }}
          >
            {t("renameDialogAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  state,
  setDialog,
  onImport,
  t,
}: DialogSlotProps & {
  onImport: (mode: "light" | "dark", fileText: string) => Promise<readonly SkinIssue[]>;
}) {
  const open = state.kind === "import";
  const [mode, setMode] = React.useState<"light" | "dark">("light");
  const [issues, setIssues] = React.useState<readonly SkinIssue[]>([]);
  const [file, setFile] = React.useState<File | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDialog({ kind: "none" });
          setIssues([]);
          setFile(null);
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("importDialogTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skin-manager-import-mode">{t("importModeLabel")}</Label>
          <RadioGroup
            id="skin-manager-import-mode"
            value={mode}
            onValueChange={(value) => setMode(value as "light" | "dark")}
            className="flex flex-row gap-3"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="light" id="skin-manager-import-mode-light" />
              <Label htmlFor="skin-manager-import-mode-light">{t("exportLightAction")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="dark" id="skin-manager-import-mode-dark" />
              <Label htmlFor="skin-manager-import-mode-dark">{t("exportDarkAction")}</Label>
            </div>
          </RadioGroup>
        </div>

        <FormField label={t("importFileLabel")} id="skin-manager-import-file">
          {(field) => (
            <input
              {...field}
              type="file"
              accept="application/json"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-sm text-foreground"
            />
          )}
        </FormField>

        {issues.length > 0 ? (
          <InlineAlert variant="destructive">
            <ul className="list-disc ps-4">
              {issues.map((issue) => (
                <li key={`${issue.path}-${issue.message}`}>
                  {issue.path || "/"}: {issue.message}
                </li>
              ))}
            </ul>
          </InlineAlert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="primary"
            disabled={!file}
            onClick={() => {
              if (!file) return;
              void file.text().then(async (text) => {
                const result = await onImport(mode, text);
                setIssues(result);
                if (result.length === 0) setDialog({ kind: "none" });
              });
            }}
          >
            {t("importAction2")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
