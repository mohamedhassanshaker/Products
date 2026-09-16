"use client";

/**
 * Screen 3, "Global policies" tab (wireframe `#screen-guardrails`, subtab `policies`).
 *
 * A locked row shows no Edit action at all — client-side, this is `row.isLocked` simply
 * never producing the button (`renderRowActions` below). That alone would only be a UI
 * convenience; the real guarantee is server-side: `updateGuardrailPolicyValueAction` →
 * `UpdateGuardrailPolicyValue` → `PrismaPolicyCatalogueRepository.updateDefaultValue`
 * re-checks the live `platform.OverridablePolicies` membership at write time and refuses
 * `"policy_locked"` regardless of what this component did or didn't render — proven
 * directly (not just trusted) in this wave's own live-infra verification (see the final
 * report).
 *
 * A dialog, not `DataTable`'s `editable-cell` variant — matching `circuit-breakers-tab.
 * tsx`'s own precedent for the identical reason: even though most policies here are a
 * single scalar, a dialog keeps the "which kind of control" decision (Switch / number
 * Input / raw JSON textarea) in one place per policy, and gives the JSON-fallback case
 * (Enum, or any future kind) room for a real validation message before Save, which a bare
 * inline cell has no room for.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import {
  encodeBooleanValue,
  encodeThresholdValue,
  hasTypedEditor,
  isValidPolicyValueJsonText,
  parseThresholdInput,
  unwrapPolicyValue,
} from "../../../../modules/guardrails/domain/policy-value.js";
import type { GlobalPolicyRow } from "../../../../modules/guardrails/ports/policy-catalogue-repository.js";
import type { GuardrailsScreenActions } from "./guardrails-screen.js";

export interface GlobalPoliciesTabProps {
  readonly initialPolicies: readonly GlobalPolicyRow[];
  readonly actions: GuardrailsScreenActions;
}

export function GlobalPoliciesTab({
  initialPolicies,
  actions,
}: GlobalPoliciesTabProps): React.ReactElement {
  const t = useTranslations("guardrails.policies");
  const router = useRouter();

  const [policies, setPolicies] = React.useState(initialPolicies);
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setPolicies(initialPolicies), [initialPolicies]);

  const editingRow = editingKey ? policies.find((p) => p.policyKey === editingKey) : undefined;

  function valueDisplay(row: GlobalPolicyRow): string {
    const value = unwrapPolicyValue(row.defaultValueJson);
    if (row.kind === "Boolean") return value === true ? t("valueOn") : t("valueOff");
    if (row.kind === "Threshold" && typeof value === "number") return String(value);
    return row.defaultValueJson;
  }

  async function handleSave(defaultValueJson: string): Promise<void> {
    if (!editingKey) return;
    setPending(true);
    setError(null);
    const result = await actions.updateGuardrailPolicyValue({
      policyKey: editingKey,
      defaultValueJson,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      setError(t(`updateError.${result.value.reason}`, { defaultValue: result.value.reason }));
      return;
    }
    setEditingKey(null);
    router.refresh();
  }

  const columns = React.useMemo<ColumnDef<GlobalPolicyRow, unknown>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: t("columnPolicy"),
        meta: { identifying: true },
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span>{row.original.title}</span>
            <span className="text-xs text-muted-foreground">{row.original.detail}</span>
          </div>
        ),
      },
      {
        id: "kind",
        accessorKey: "kind",
        header: t("columnKind"),
      },
      {
        id: "appliesTo",
        accessorKey: "appliesTo",
        header: t("columnAppliesTo"),
        cell: ({ row }) =>
          row.original.appliesTo === "Runtime" ? t("appliesToRuntime") : t("appliesToStorage"),
      },
      {
        id: "value",
        header: t("columnValue"),
        cell: ({ row }) => valueDisplay(row.original),
      },
      {
        id: "locked",
        header: t("columnLocked"),
        cell: ({ row }) =>
          row.original.isLocked ? (
            <Badge variant="outline" label={t("lockedBadge")} />
          ) : (
            <span className="text-sm text-muted-foreground">{t("unlockedLabel")}</span>
          ),
      },
    ],
    // `valueDisplay` closes only over `t` (already listed) — no `react-hooks/exhaustive-deps`
    // rule is configured in this project (`use-wizard-draft.ts`'s own comment names this),
    // so this dependency array is exact rather than defensively over-inclusive.
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <Card className="flex flex-col gap-3 p-4">
        <DataTable<GlobalPolicyRow>
          columns={columns}
          data={policies}
          getRowId={(row) => row.policyKey}
          getRowLabel={(row) => row.title}
          caption={t("caption")}
          captionVisuallyHidden
          status={policies.length === 0 ? "empty" : "ready"}
          emptyContent={<EmptyState headline={t("emptyHeadline")} cause={t("emptyCause")} />}
          renderRowActions={(row) =>
            row.isLocked ? (
              <span className="text-xs text-muted-foreground">{t("lockedNote")}</span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingKey(row.policyKey)}
              >
                {t("editAction")}
              </Button>
            )
          }
        />
      </Card>

      {editingRow ? (
        <PolicyEditDialog
          row={editingRow}
          pending={pending}
          onOpenChange={(open) => {
            if (!open) {
              setEditingKey(null);
              setError(null);
            }
          }}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}

interface PolicyEditDialogProps {
  readonly row: GlobalPolicyRow;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (defaultValueJson: string) => Promise<void>;
}

/**
 * The per-kind editor. `Boolean` gets a real `Switch`, `Threshold` a bounded decimal
 * `Input` — `domain/policy-value.ts`'s `hasTypedEditor` names exactly these two. Every
 * other kind (`Enum` today; any future kind this schema has not seeded yet) falls back to
 * a raw, validated JSON textarea — an honest fallback rather than a guessed-at third
 * typed control, since `platform.Policies` carries no column naming an enum's real option
 * set to build a `<Select>` from (this module's own domain doc comment).
 */
function PolicyEditDialog({
  row,
  pending,
  onOpenChange,
  onSave,
}: PolicyEditDialogProps): React.ReactElement {
  const t = useTranslations("guardrails.policies");
  const currentValue = unwrapPolicyValue(row.defaultValueJson);
  const booleanFieldId = React.useId();

  const [boolValue, setBoolValue] = React.useState(currentValue === true);
  const [thresholdText, setThresholdText] = React.useState(
    typeof currentValue === "number" ? String(currentValue) : "",
  );
  const [jsonText, setJsonText] = React.useState(row.defaultValueJson);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  function handleSubmit(): void {
    if (row.kind === "Boolean") {
      void onSave(encodeBooleanValue(boolValue));
      return;
    }
    if (row.kind === "Threshold") {
      const parsed = parseThresholdInput(thresholdText);
      if (parsed === null) {
        setValidationError(t("invalidThresholdError"));
        return;
      }
      setValidationError(null);
      void onSave(encodeThresholdValue(parsed));
      return;
    }
    if (!isValidPolicyValueJsonText(jsonText)) {
      setValidationError(t("invalidJsonError"));
      return;
    }
    setValidationError(null);
    void onSave(jsonText);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{row.title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <p className="text-sm text-muted-foreground">{row.detail}</p>

          {/* `hasTypedEditor` gates which two kinds reach a typed branch at all — kept as
              a real, named check (not just the two `=== "Boolean"`/`"Threshold"` tests
              below) so the fallback branch stays correct if a third typed editor is ever
              added: it would need its own `hasTypedEditor` case, not just a new `===`. */}
          {hasTypedEditor(row.kind) && row.kind === "Boolean" ? (
            // A plain `Label` + `Switch` pair, not `FormField` — matches
            // `circuit-breakers-tab.tsx`'s own established precedent for a boolean
            // field (`fieldServeCachedWhenDown`): a toggle's accessible name comes from
            // its associated `<label htmlFor>`, not from `FormField`'s render-prop
            // wiring, which this codebase reserves for text/select/textarea controls.
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={booleanFieldId}>{t("fieldValue")}</Label>
              <Switch id={booleanFieldId} checked={boolValue} onCheckedChange={setBoolValue} />
            </div>
          ) : hasTypedEditor(row.kind) ? (
            <FormField
              label={t("fieldValue")}
              help={row.floorValueJson ? t("floorHelp") : undefined}
              {...(validationError !== null ? { error: validationError } : {})}
            >
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={thresholdText}
                  onChange={(event) => setThresholdText(event.target.value)}
                  required
                />
              )}
            </FormField>
          ) : (
            <FormField
              label={t("fieldValueJson")}
              help={t("valueJsonHelp")}
              {...(validationError !== null ? { error: validationError } : {})}
            >
              {(field) => (
                <Textarea
                  {...field}
                  variant="auto-grow"
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                  required
                />
              )}
            </FormField>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancelAction")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("saveAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
