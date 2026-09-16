"use client";

/**
 * B5 tab 1 — Skills catalogue. A real `DataTable` (design-system.md §5.5 #41 — "a screen that
 * assembles its own table fails review"), never a hand-rolled `<table>`.
 *
 * ## Why only Native skills are editable here
 *
 * A `Skill` row reaches this catalogue three ways, and only one of them is owned by this tab:
 *   - `Native` — registered directly here, so create/edit/delete all live in this tab.
 *   - `ApiConnector` — projected automatically from an API connector registration (a database
 *     trigger mints and retires the paired skill row). Its name, schemas and lifecycle belong
 *     to the connector; editing it here would let the two drift apart.
 *   - `McpTool` — materialised by a successful MCP discovery, and retired when the server stops
 *     advertising the tool.
 *
 * So the last two are read-only rows with a plain "managed via …" note in place of row actions.
 * Not a missing feature — the alternative (two places that can rename the same thing) is the
 * bug.
 *
 * ## The bound-agent-version count is a number, not a control
 *
 * Attaching a skill to a specific agent version is a per-agent decision made in the agent
 * wizard's step 4. This column reports how widely a skill is used across the estate; it is
 * deliberately not clickable. See `tools-screen.tsx`'s own note.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DestructiveConfirmDialog,
} from "@/components/patterns/dialog";
import type { SkillCatalogRow } from "../../../../modules/tools/application/list-skills.js";
import type { SkillInvocationKind } from "../../../../modules/tools/domain/tool-catalog.js";
import type { ToolsScreenActions } from "./tools-screen.js";

export interface SkillsTabProps {
  readonly rows: readonly SkillCatalogRow[];
  readonly actions: ToolsScreenActions;
}

/**
 * Sort rank for the invocation-kind column (design-system.md §5.4 #39 — never alphabetical).
 * Native first: those are the rows this tab can actually act on.
 */
const INVOCATION_RANK: Readonly<Record<SkillInvocationKind, number>> = {
  Native: 0,
  ApiConnector: 1,
  McpTool: 2,
};

/** Native reads as this screen's own object (`info`); the projected kinds are descriptive, not a state to react to (`neutral`). */
const INVOCATION_FAMILY: Readonly<Record<SkillInvocationKind, StatusFamily>> = {
  Native: "info",
  ApiConnector: "neutral",
  McpTool: "neutral",
};

type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly row: SkillCatalogRow }
  | { readonly kind: "delete"; readonly row: SkillCatalogRow };

/** An optional free-text field: a blank box means "no value", which the ports model as `null`, not `""`. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function SkillsTab({ rows, actions }: SkillsTabProps): React.ReactElement {
  const t = useTranslations("tools.skills");
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const invocationLabel = React.useCallback(
    (kind: SkillInvocationKind): string =>
      kind === "Native"
        ? t("invocationNative")
        : kind === "ApiConnector"
          ? t("invocationApiConnector")
          : t("invocationMcpTool"),
    [t],
  );

  const columns = React.useMemo<ColumnDef<SkillCatalogRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("columnName"),
        meta: { identifying: true },
      },
      {
        id: "category",
        accessorFn: (row) => row.category ?? "",
        header: t("columnCategory"),
        cell: ({ row }) => row.original.category ?? t("noCategory"),
      },
      {
        id: "invocationKind",
        accessorKey: "invocationKind",
        header: t("columnInvocationKind"),
        cell: ({ row }) => (
          <StatusCell
            label={invocationLabel(row.original.invocationKind)}
            family={INVOCATION_FAMILY[row.original.invocationKind]}
            rank={INVOCATION_RANK[row.original.invocationKind]}
          />
        ),
        sortingFn: (a, b) =>
          INVOCATION_RANK[a.original.invocationKind] - INVOCATION_RANK[b.original.invocationKind],
      },
      {
        id: "attachedByDefault",
        accessorFn: (row) => row.isAttachedByDefault,
        header: t("columnAttachedByDefault"),
        cell: ({ row }) => (row.original.isAttachedByDefault ? t("yes") : t("no")),
      },
      {
        id: "boundAgentVersionCount",
        accessorKey: "boundAgentVersionCount",
        header: t("columnBoundVersions"),
        meta: { mono: true },
      },
    ],
    [t, invocationLabel],
  );

  /** Shared post-mutation step: close the dialog, clear the error, and re-run `page.tsx`'s reads. */
  function onMutationSucceeded(): void {
    setDialog({ kind: "none" });
    setError(null);
    router.refresh();
  }

  async function handleDelete(row: SkillCatalogRow): Promise<void> {
    setPending(true);
    const result = await actions.deleteSkill(row.id);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      // The one real business-rule refusal: agent versions still bind this skill. Reported with
      // the real count rather than a generic failure — unbinding them is the actual next step.
      setError(t("deleteInUseError", { count: result.value.boundAgentVersionIds.length }));
      return;
    }
    onMutationSucceeded();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("heading")}</h2>
        <Button type="button" size="sm" onClick={() => setDialog({ kind: "create" })}>
          {t("createAction")}
        </Button>
      </div>

      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        caption={t("heading")}
        captionVisuallyHidden
        renderRowActions={(row) =>
          row.invocationKind === "Native" ? (
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
                onClick={() => setDialog({ kind: "delete", row })}
              >
                {t("deleteAction")}
              </Button>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {row.invocationKind === "ApiConnector"
                ? t("managedViaApiConnector")
                : t("managedViaMcpServer")}
            </span>
          )
        }
      />

      <p className="text-sm text-muted-foreground">{t("boundVersionsNote")}</p>

      {dialog.kind === "create" ? (
        <CreateSkillDialog
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          pending={pending}
          onSubmit={async (input) => {
            setPending(true);
            const result = await actions.createNativeSkill(input);
            setPending(false);
            if (result.ok) onMutationSucceeded();
            else setError(result.error);
          }}
        />
      ) : null}

      {dialog.kind === "edit" ? (
        <EditSkillDialog
          row={dialog.row}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          pending={pending}
          onSubmit={async (input) => {
            setPending(true);
            const result = await actions.updateSkill(input);
            setPending(false);
            if (result.ok) onMutationSucceeded();
            else setError(result.error);
          }}
        />
      ) : null}

      {dialog.kind === "delete" ? (
        <DestructiveConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          title={t("deleteConfirmTitle")}
          objectName={dialog.row.name}
          descriptionTemplate={(name) => t("deleteConfirmDescription", { name })}
          actionLabel={t("deleteConfirmAction")}
          cancelLabel={t("cancel")}
          confirming={pending}
          onConfirm={() => void handleDelete(dialog.row)}
        />
      ) : null}
    </div>
  );
}

/** JSON that a tool schema field will accept — parsed here so a typo is caught before the round trip, not stored as an unparseable schema. */
function isParseableJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

interface CreateSkillDialogProps {
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly onSubmit: (input: {
    readonly name: string;
    readonly description: string | null;
    readonly category: string | null;
    readonly inputSchemaJson: string;
    readonly outputSchemaJson: string | null;
    readonly isAttachedByDefault: boolean;
  }) => Promise<void>;
}

function CreateSkillDialog({ onOpenChange, pending, onSubmit }: CreateSkillDialogProps) {
  const t = useTranslations("tools.skills");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [inputSchemaJson, setInputSchemaJson] = React.useState("");
  const [outputSchemaJson, setOutputSchemaJson] = React.useState("");
  const [isAttachedByDefault, setIsAttachedByDefault] = React.useState(false);
  /** Which schema field failed to parse, so the message lands on the box that is actually wrong. */
  const [schemaError, setSchemaError] = React.useState<"input" | "output" | null>(null);
  const attachedByDefaultId = React.useId();

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{t("createDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isParseableJson(inputSchemaJson)) {
              setSchemaError("input");
              return;
            }
            const output = trimmedOrNull(outputSchemaJson);
            if (output !== null && !isParseableJson(output)) {
              setSchemaError("output");
              return;
            }
            setSchemaError(null);
            void onSubmit({
              name,
              description: trimmedOrNull(description),
              category: trimmedOrNull(category),
              inputSchemaJson,
              outputSchemaJson: output,
              isAttachedByDefault,
            });
          }}
        >
          <FormField label={t("fieldName")}>
            {(field) => (
              <Input
                {...field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldCategory")} labelVariant="optional">
            {(field) => (
              <Input
                {...field}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={t("fieldDescription")} labelVariant="optional">
            {(field) => (
              <Textarea
                {...field}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </FormField>
          <FormField
            label={t("fieldInputSchema")}
            help={t("fieldSchemaHelp")}
            {...(schemaError === "input" ? { error: t("invalidJsonError") } : {})}
          >
            {(field) => (
              <Textarea
                {...field}
                dir="ltr"
                value={inputSchemaJson}
                onChange={(event) => setInputSchemaJson(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField
            label={t("fieldOutputSchema")}
            labelVariant="optional"
            {...(schemaError === "output" ? { error: t("invalidJsonError") } : {})}
          >
            {(field) => (
              <Textarea
                {...field}
                dir="ltr"
                value={outputSchemaJson}
                onChange={(event) => setOutputSchemaJson(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={attachedByDefaultId}>{t("fieldAttachedByDefault")}</Label>
            <Switch
              id={attachedByDefaultId}
              checked={isAttachedByDefault}
              onCheckedChange={setIsAttachedByDefault}
            />
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
            <Button type="submit" loading={pending}>
              {t("createDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditSkillDialogProps {
  readonly row: SkillCatalogRow;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly onSubmit: (input: {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly category: string | null;
  }) => Promise<void>;
}

/** Only the three fields `SkillRepository.update` accepts — schemas and invocation kind are immutable once a skill exists, so they are not offered. */
function EditSkillDialog({ row, onOpenChange, pending, onSubmit }: EditSkillDialogProps) {
  const t = useTranslations("tools.skills");
  const [name, setName] = React.useState(row.name);
  const [description, setDescription] = React.useState(row.description ?? "");
  const [category, setCategory] = React.useState(row.category ?? "");

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{t("editDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({
              id: row.id,
              name,
              description: trimmedOrNull(description),
              category: trimmedOrNull(category),
            });
          }}
        >
          <FormField label={t("fieldName")}>
            {(field) => (
              <Input
                {...field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldCategory")} labelVariant="optional">
            {(field) => (
              <Input
                {...field}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={t("fieldDescription")} labelVariant="optional">
            {(field) => (
              <Textarea
                {...field}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
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
              {t("editDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
