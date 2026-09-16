"use client";

/**
 * B9's new Security tab — session/lockout policy and TOTP administration. Gated on
 * `security:manage`, separate from this screen's other tabs' `users:manage` — `page.tsx`
 * passes `securityPolicy: null` when the signed-in principal lacks it, and this tab renders
 * a permission-denied panel in that case rather than the form (same page-level gate shape
 * every other restricted tab in this codebase uses, e.g. `guardrails-screen.tsx`).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { DataTable } from "@/components/patterns/data-table/data-table";
import type { UserRosterRow } from "../../../../modules/iam/application/list-users.js";
import type { SecurityPolicyRow } from "../../../../modules/iam/ports/security-policy-repository.js";
import type { IamScreenActions } from "./iam-screen.js";

export interface SecurityTabProps {
  readonly users: readonly UserRosterRow[];
  readonly policy: SecurityPolicyRow | null;
  readonly totpStatus: Readonly<Record<string, boolean>>;
  readonly actions: IamScreenActions;
}

export function SecurityTab({
  users,
  policy,
  totpStatus,
  actions,
}: SecurityTabProps): React.ReactElement {
  const t = useTranslations("iam.security");
  const router = useRouter();

  const [form, setForm] = React.useState(policy);
  const [pendingSave, setPendingSave] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [resettingId, setResettingId] = React.useState<string | null>(null);
  const [statusByUserId, setStatusByUserId] = React.useState(totpStatus);

  if (!form) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">{t("permissionDeniedHeading")}</h2>
        <p className="text-sm text-muted-foreground">{t("permissionDeniedBody")}</p>
      </div>
    );
  }

  async function handleSavePolicy(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!form) return;
    setPendingSave(true);
    setError(null);
    const result = await actions.updateSecurityPolicy({
      staffSessionIdleMinutes: form.staffSessionIdleMinutes,
      staffSessionAbsoluteHours: form.staffSessionAbsoluteHours,
      lockoutFailuresBeforeLock: form.lockoutFailuresBeforeLock,
      lockoutDurationMinutes: form.lockoutDurationMinutes,
      backoffCeilingSeconds: form.backoffCeilingSeconds,
    });
    setPendingSave(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.value.ok) {
      // `result.value.reason` carries this port's namespaced error code
      // (`"security.value_out_of_range"`, matching the `agent.*`/`governance.*`
      // convention every other use case's `reason` union uses) but the messages
      // files key `saveError` by the un-prefixed suffix only (`value_out_of_range`)
      // — stripping the `security.` domain prefix here is what makes the lookup
      // resolve to the translated string instead of surfacing next-intl's own
      // "MISSING_MESSAGE" fallback (the literal dotted key) to the user. The
      // `defaultValue` is a safety net for a future reason this tab's messages
      // haven't been updated for yet, not the primary fix.
      const reasonKey = result.value.reason.replace(/^security\./, "");
      setError(t(`saveError.${reasonKey}`, { defaultValue: result.value.reason }));
      return;
    }
    setNotice(t("savedNotice"));
    router.refresh();
  }

  async function handleResetTotp(staffUserId: string): Promise<void> {
    setResettingId(staffUserId);
    setError(null);
    const result = await actions.resetStaffTotp({ staffUserId });
    if (!result.ok) {
      setError(result.error);
      setResettingId(null);
      return;
    }
    const refreshed = await actions.listTotpStatus(users.map((u) => u.id));
    setResettingId(null);
    if (refreshed.ok) {
      setStatusByUserId(refreshed.value);
      setNotice(t("totpResetNotice"));
    }
  }

  const columns = React.useMemo<ColumnDef<UserRosterRow, unknown>[]>(
    () => [
      { id: "displayName", accessorKey: "displayName", header: t("columnUser") },
      { id: "email", accessorKey: "email", header: t("columnEmail") },
      {
        id: "totpStatus",
        header: t("columnTotpStatus"),
        cell: ({ row }) =>
          statusByUserId[row.original.id] ? t("totpEnrolled") : t("totpNotEnrolled"),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={resettingId === row.original.id}
            disabled={!statusByUserId[row.original.id]}
            onClick={() => void handleResetTotp(row.original.id)}
          >
            {t("resetTotpAction")}
          </Button>
        ),
      },
    ],
    [t, statusByUserId, resettingId],
  );

  return (
    <div className="flex flex-col gap-8">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {notice ? <InlineAlert variant="success">{notice}</InlineAlert> : null}

      <form
        className="flex flex-col gap-4"
        style={{ maxWidth: "32rem" }}
        onSubmit={(event) => void handleSavePolicy(event)}
      >
        <h2 className="text-sm font-medium text-foreground">{t("policyHeading")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t("fieldStaffSessionIdleMinutes")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                variant="mono"
                value={form.staffSessionIdleMinutes}
                onChange={(e) =>
                  setForm({ ...form, staffSessionIdleMinutes: Number(e.target.value) })
                }
              />
            )}
          </FormField>
          <FormField label={t("fieldStaffSessionAbsoluteHours")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                variant="mono"
                value={form.staffSessionAbsoluteHours}
                onChange={(e) =>
                  setForm({ ...form, staffSessionAbsoluteHours: Number(e.target.value) })
                }
              />
            )}
          </FormField>
          <FormField label={t("fieldLockoutFailuresBeforeLock")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                variant="mono"
                value={form.lockoutFailuresBeforeLock}
                onChange={(e) =>
                  setForm({ ...form, lockoutFailuresBeforeLock: Number(e.target.value) })
                }
              />
            )}
          </FormField>
          <FormField label={t("fieldLockoutDurationMinutes")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                variant="mono"
                value={form.lockoutDurationMinutes}
                onChange={(e) =>
                  setForm({ ...form, lockoutDurationMinutes: Number(e.target.value) })
                }
              />
            )}
          </FormField>
          <FormField label={t("fieldBackoffCeilingSeconds")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                variant="mono"
                value={form.backoffCeilingSeconds}
                onChange={(e) =>
                  setForm({ ...form, backoffCeilingSeconds: Number(e.target.value) })
                }
              />
            )}
          </FormField>
        </div>
        <div>
          <Button type="submit" loading={pendingSave}>
            {t("saveAction")}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">{t("totpHeading")}</h2>
        <DataTable
          columns={columns}
          data={users}
          getRowId={(row) => row.id}
          caption={t("totpHeading")}
          captionVisuallyHidden
        />
      </div>
    </div>
  );
}
