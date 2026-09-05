"use client";

import { useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import { Button } from "@nextbot/ui/components/ui/button";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { fetchJson } from "@/src/lib/fetch-json";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  region: string;
  status: "Active" | "Suspended" | "Trial";
  planTier: "Starter" | "Growth" | "Enterprise";
  createdAt: string;
  maxConcurrentRuns: number | null;
  liveConcurrentRuns: number;
}

type SortKey = "name" | "status" | "planTier" | "region";

/** Tenant lifecycle status → Badge treatment, same "solid, pre-verified pairing"
 * convention as `McpHealthDashboard.tsx`'s `CONNECTOR_STATUS_BADGE`. */
const STATUS_BADGE: Record<TenantRow["status"], { variant?: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  Active: { className: "bg-emerald-700 text-white" },
  Trial: { variant: "secondary" },
  Suspended: { className: WARNING_BADGE_CLASS },
};

/**
 * Platform Manager console Tenant List (NFR-11) — every tenant across the platform,
 * with its live "concurrent runs" quota gauge, sortable by name/status/plan-tier/
 * region and filterable by a free-text name/slug search. Modeled on
 * `apps/web/app/(admin)/mcp-health/McpHealthDashboard.tsx`'s existing dashboard
 * pattern (shadcn `Table`, `Skeleton` loading state, `Badge` status treatment),
 * gated by `requirePlatformApi()` instead of tenant-scoped RBAC.
 */
export function TenantListScreen() {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  async function reload() {
    setError(null);
    const result = await fetchJson<{ tenants: TenantRow[] }>("/api/internal/ops/tenants");
    if (result.kind === "forbidden" || result.kind === "error") {
      setError(result.message);
      return;
    }
    setTenants(result.data.tenants);
  }

  useEffect(() => {
    void reload();
  }, []);

  const visibleTenants = useMemo(() => {
    if (!tenants) return null;
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? tenants.filter((t) => t.name.toLowerCase().includes(needle) || t.slug.toLowerCase().includes(needle))
      : tenants;
    return [...filtered].sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])));
  }, [tenants, filter, sortKey]);

  function sortButton(key: SortKey, label: string) {
    return (
      <button
        type="button"
        onClick={() => setSortKey(key)}
        className={`flex items-center gap-1 ${sortKey === key ? "font-semibold" : ""}`}
        aria-pressed={sortKey === key}
      >
        {label}
        {sortKey === key && <span aria-hidden="true">▾</span>}
      </button>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Tenants</h1>
        {/* `nativeButton={false}`: the `render` target is a `NextLink` (an `<a>`), not
            a real `<button>` — Base UI otherwise warns that `nativeButton` (its
            default) expects one. */}
        <Button nativeButton={false} render={<NextLink href="/internal/ops/tenants/new" />}>
          Provision new tenant
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-4 max-w-sm">
        <Label htmlFor="tenant-filter">Filter by name or slug</Label>
        <Input
          id="tenant-filter"
          className="mt-1"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="acme"
        />
      </div>

      {visibleTenants === null ? (
        <Skeleton className="h-8 w-64" role="status" aria-label="Loading tenants" />
      ) : visibleTenants.length === 0 ? (
        <p className="text-muted-foreground">No tenants match this filter.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{sortButton("name", "Name")}</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>{sortButton("region", "Region")}</TableHead>
              <TableHead>{sortButton("status", "Status")}</TableHead>
              <TableHead>{sortButton("planTier", "Plan tier")}</TableHead>
              <TableHead>Concurrent runs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTenants.map((tenant) => {
              const statusBadge = STATUS_BADGE[tenant.status];
              return (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <NextLink
                      href={`/internal/ops/tenants/${tenant.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {tenant.name}
                    </NextLink>
                  </TableCell>
                  <TableCell>{tenant.slug}</TableCell>
                  <TableCell>{tenant.region}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadge.variant} className={statusBadge.className}>
                      {tenant.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{tenant.planTier}</TableCell>
                  <TableCell>
                    {tenant.liveConcurrentRuns}
                    {tenant.maxConcurrentRuns !== null ? ` / ${tenant.maxConcurrentRuns}` : " (no cap)"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
