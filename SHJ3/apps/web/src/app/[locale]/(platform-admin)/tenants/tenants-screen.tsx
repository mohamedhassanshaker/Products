"use client";

/**
 * `/tenants` — the platform operator's tenant lifecycle screen (Parts C + E).
 * List + Create (wraps `ProvisionTenant`) + Suspend + Delete (`DeprovisionTenant`,
 * gated behind the Suspended-first precondition and a typed-slug confirmation —
 * both also re-enforced server-side inside the use case itself, never only here).
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
import type { Tenant } from "../../../../modules/platform/domain/tenant.js";
import type {
  createTenantAction,
  deprovisionTenantAction,
  suspendTenantAction,
} from "./actions.js";

export interface TenantsScreenActions {
  readonly createTenant: typeof createTenantAction;
  readonly suspendTenant: typeof suspendTenantAction;
  readonly deprovisionTenant: typeof deprovisionTenantAction;
}

export interface TenantsScreenProps {
  readonly tenants: readonly Tenant[];
  readonly actions: TenantsScreenActions;
}

export function TenantsScreen({ tenants, actions }: TenantsScreenProps): React.ReactElement {
  const t = useTranslations("platformAdmin.tenants");
  const router = useRouter();

  const [slug, setSlug] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = React.useState<string | null>(null);
  const [confirmSlugBySlug, setConfirmSlugBySlug] = React.useState<Record<string, string>>({});

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setError(null);
    const result = await actions.createTenant({ slug, displayName });
    setCreating(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSlug("");
    setDisplayName("");
    setNotice(t("createdNotice", { slug: result.value.slug }));
    router.refresh();
  }

  async function handleSuspend(tenantSlug: string): Promise<void> {
    setPendingSlug(tenantSlug);
    setError(null);
    const result = await actions.suspendTenant(tenantSlug);
    setPendingSlug(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(t("suspendedNotice", { slug: tenantSlug }));
    router.refresh();
  }

  async function handleDeprovision(tenantSlug: string): Promise<void> {
    const confirmSlug = confirmSlugBySlug[tenantSlug] ?? "";
    setPendingSlug(tenantSlug);
    setError(null);
    const result = await actions.deprovisionTenant(tenantSlug, confirmSlug);
    setPendingSlug(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(t("deprovisionedNotice", { slug: tenantSlug }));
    router.refresh();
  }

  const columns = React.useMemo<ColumnDef<Tenant, unknown>[]>(
    () => [
      { id: "slug", accessorKey: "slug", header: t("columnSlug") },
      { id: "displayName", accessorKey: "displayName", header: t("columnDisplayName") },
      { id: "status", accessorKey: "status", header: t("columnStatus") },
      {
        id: "createdAt",
        header: t("columnCreatedAt"),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const tenant = row.original;
          const isPending = pendingSlug === tenant.slug;
          if (tenant.status === "Active") {
            return (
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={isPending}
                onClick={() => void handleSuspend(tenant.slug)}
              >
                {t("suspendAction")}
              </Button>
            );
          }
          if (tenant.status === "Suspended") {
            return (
              <div className="flex items-center gap-2">
                <Input
                  variant="mono"
                  placeholder={t("confirmSlugPlaceholder", { slug: tenant.slug })}
                  value={confirmSlugBySlug[tenant.slug] ?? ""}
                  onChange={(e) =>
                    setConfirmSlugBySlug({ ...confirmSlugBySlug, [tenant.slug]: e.target.value })
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  loading={isPending}
                  disabled={(confirmSlugBySlug[tenant.slug] ?? "") !== tenant.slug}
                  onClick={() => void handleDeprovision(tenant.slug)}
                >
                  {t("deleteAction")}
                </Button>
              </div>
            );
          }
          return null;
        },
      },
    ],
    [t, pendingSlug, confirmSlugBySlug],
  );

  return (
    <div className="flex flex-col gap-8">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      {notice ? <InlineAlert variant="success">{notice}</InlineAlert> : null}

      <form
        className="flex flex-col gap-4"
        style={{ maxWidth: "32rem" }}
        onSubmit={(event) => void handleCreate(event)}
      >
        <h2 className="text-sm font-medium text-foreground">{t("createHeading")}</h2>
        <FormField label={t("fieldSlug")}>
          {(field) => (
            <Input
              {...field}
              variant="mono"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          )}
        </FormField>
        <FormField label={t("fieldDisplayName")}>
          {(field) => (
            <Input
              {...field}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          )}
        </FormField>
        <div>
          <Button type="submit" loading={creating}>
            {t("createAction")}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">{t("listHeading")}</h2>
        <DataTable
          columns={columns}
          data={tenants}
          getRowId={(row) => row.slug}
          caption={t("listHeading")}
          captionVisuallyHidden
        />
      </div>
    </div>
  );
}
