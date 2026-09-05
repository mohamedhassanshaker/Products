"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Separator } from "@nextbot/ui/components/ui/separator";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

const ROLES = ["chat.primary", "chat.router", "embed.default", "rerank.default", "vision.default", "custom"] as const;

interface RouteItem {
  id: string;
  name: string;
  role: (typeof ROLES)[number];
  currentVersionId: string | null;
  status: "Active" | "Archived";
}

interface RouteVersionItem {
  id: string;
  version: number;
  status: "Draft" | "Published" | "Deprecated";
  advertisedCapabilities: Record<string, boolean>;
  maxRegionSet: string[];
}

interface ProviderItem {
  id: string;
  type: string;
  name: string;
}

interface CatalogItem {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
}

interface HopDraft {
  providerId: string;
  catalogEntryId: string;
  timeoutMs: number;
}

interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

/** Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8, FR-AGT-20-26) — Route v2
 * management: routes pin real `model_catalog_entry` rows (never a free-text model
 * string), save-time capability/residency/plan-tier validation surfaces every error
 * inline before a save is accepted. Replaces the retired v1 "Routes" tab at
 * `/agent-platform/model-gateway` (see that page's redirect). */
export function RoutesTab({ canWrite }: { canWrite: boolean }) {
  const [routes, setRoutes] = useState<RouteItem[] | null>(null);
  const [providers, setProviders] = useState<ProviderItem[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [versionsByRoute, setVersionsByRoute] = useState<Record<string, RouteVersionItem[]>>({});

  const [newRouteName, setNewRouteName] = useState("");
  const [newRouteRole, setNewRouteRole] = useState<(typeof ROLES)[number]>("custom");
  const [creatingRoute, setCreatingRoute] = useState(false);

  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [hops, setHops] = useState<HopDraft[]>([]);
  const [cacheMode, setCacheMode] = useState<"Off" | "ExactMatch" | "Semantic">("Off");
  const [allowOutOfRegionFailover, setAllowOutOfRegionFailover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  async function load() {
    const [routesResult, providersResult, catalogResult] = await Promise.all([
      fetchJson<{ routes: RouteItem[] }>("/api/v1/admin/model-gateway/routes"),
      fetchJson<{ providers: ProviderItem[] }>("/api/v1/admin/model-gateway/providers"),
      fetchJson<{ entries: CatalogItem[] }>("/api/v1/admin/model-gateway/catalog"),
    ]);
    if (routesResult.kind === "ok") {
      setRoutes(routesResult.data.routes);
      for (const r of routesResult.data.routes) {
        const versionsResult = await fetchJson<{ versions: RouteVersionItem[] }>(`/api/v1/admin/model-gateway/routes/${r.id}/versions`);
        if (versionsResult.kind === "ok") setVersionsByRoute((prev) => ({ ...prev, [r.id]: versionsResult.data.versions }));
      }
    }
    if (providersResult.kind === "ok") setProviders(providersResult.data.providers);
    if (catalogResult.kind === "ok") setCatalog(catalogResult.data.entries);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createRoute() {
    if (newRouteName.trim().length === 0) {
      toast.error("Route name is required");
      return;
    }
    setCreatingRoute(true);
    const result = await fetchJson<{ route: RouteItem }>("/api/v1/admin/model-gateway/routes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newRouteName, role: newRouteRole }),
    });
    setCreatingRoute(false);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Route created — add a version below");
    setNewRouteName("");
    setSelectedRouteId(result.data.route.id);
    await load();
  }

  function addHop() {
    setHops([...hops, { providerId: providers?.[0]?.id ?? "", catalogEntryId: "", timeoutMs: 30000 }]);
  }

  function updateHop(idx: number, patch: Partial<HopDraft>) {
    const next = [...hops];
    next[idx] = { ...next[idx], ...patch } as HopDraft;
    setHops(next);
  }

  async function saveVersion(publish: boolean) {
    if (!selectedRouteId) return;
    if (hops.length === 0) {
      toast.error("Add at least one hop");
      return;
    }
    setSaving(true);
    setIssues([]);
    // A raw `fetch` here, not the shared `fetchJson` helper — a save-time
    // capability/residency rejection (422) carries an RFC 9457 `fields` array naming
    // every offending hop (FR-AGT-22's "never a silent accept" requirement), which
    // `fetchJson`'s error union deliberately doesn't surface (it only exposes a
    // human `title`). Every other list/CRUD call on this page keeps using
    // `fetchJson` — this one specific save path needs the richer body.
    const response = await fetch(`/api/v1/admin/model-gateway/routes/${selectedRouteId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chain: hops.map((h, idx) => ({ ordinal: idx, providerId: h.providerId, catalogEntryId: h.catalogEntryId, params: {}, timeoutMs: h.timeoutMs })),
        policy: {
          strategy: "FixedPriority",
          failoverOn: ["429", "5xx", "timeout"],
          retry: { maxPerHop: 1, backoff: "exponential" },
          totalTimeoutMs: 30000,
          cacheMode,
          onBudgetBreach: "Fail",
          allowOutOfRegionFailover,
        },
        publish,
      }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      toast.error((body?.title as string) ?? "Something went wrong. Please try again.");
      if (Array.isArray(body?.fields)) setIssues(body.fields as ValidationIssue[]);
      return;
    }
    toast.success(publish ? "Route version saved and published" : "Route version saved as Draft");
    setHops([]);
    await load();
  }

  return (
    <div>
      <h2 className="mb-2 font-heading text-base font-semibold">Model Routes</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        A route is an ordered chain of catalog-pinned hops with declared failover/residency policy (FR-AGT-22). Editing a route creates a new
        immutable version — nothing already promoted changes.
      </p>

      {routes === null ? (
        <Skeleton className="mb-6 h-20 w-full" role="status" aria-label="Loading model routes" />
      ) : (
        <Table className="mb-6">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Current version</TableHead>
              <TableHead>Advertised capabilities</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((r) => {
              const currentVersion = versionsByRoute[r.id]?.find((v) => v.id === r.currentVersionId);
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <code>{r.name}</code>
                  </TableCell>
                  <TableCell>{r.role}</TableCell>
                  <TableCell>{currentVersion ? `v${currentVersion.version} (${currentVersion.status})` : "— none published —"}</TableCell>
                  <TableCell>
                    {currentVersion
                      ? Object.entries(currentVersion.advertisedCapabilities)
                          .filter(([, v]) => v)
                          .map(([k]) => k)
                          .join(", ") || "none"
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {canWrite && (
                      <Button size="xs" onClick={() => setSelectedRouteId(r.id)}>
                        New version
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {canWrite && (
        <div className="mb-8 rounded-none border p-4">
          <h3 className="mb-4 font-heading text-sm font-semibold">Create route</h3>
          <div className="mb-4 flex items-end gap-4">
            <div>
              <Label htmlFor="route-name" className="mb-1 text-sm">
                Name
              </Label>
              <Input id="route-name" value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)} placeholder="chat.primary" className="w-[220px]" />
            </div>
            <div>
              <Label htmlFor="route-role" className="mb-1 text-sm">
                Role
              </Label>
              <Select value={newRouteRole} onValueChange={(v) => v !== null && setNewRouteRole(v as (typeof ROLES)[number])}>
                <SelectTrigger id="route-role" aria-label="Role" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void createRoute()} disabled={creatingRoute}>
              {creatingRoute ? "Creating…" : "Create route"}
            </Button>
          </div>

          {selectedRouteId && (
            <>
              <Separator className="mb-4" />
              <h3 className="mb-2 font-heading text-sm font-semibold">New version for {routes?.find((r) => r.id === selectedRouteId)?.name}</h3>

              {issues.length > 0 && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {issues.map((issue, idx) => (
                        <li key={idx}>
                          <strong>{issue.path}</strong>: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="mb-4 flex flex-col gap-3">
                {hops.map((hop, idx) => (
                  <div key={idx} className="flex items-end gap-3 rounded-none border p-3">
                    <div>
                      <div className="mb-1 flex items-center gap-1">
                        <Label htmlFor={`hop-${idx}-provider`} className="text-xs">
                          Provider
                        </Label>
                        <FieldHint id={`hop-${idx}-provider-hint`} content="Which registered provider serves this hop." />
                      </div>
                      <Select value={hop.providerId} onValueChange={(v) => v !== null && updateHop(idx, { providerId: v, catalogEntryId: "" })}>
                        <SelectTrigger id={`hop-${idx}-provider`} aria-label={`Hop ${idx + 1} provider`} className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(providers ?? []).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1">
                        <Label htmlFor={`hop-${idx}-entry`} className="text-xs">
                          Catalog entry
                        </Label>
                        <FieldHint id={`hop-${idx}-entry-hint`} content="A real, catalog-pinned model — never a free-text model name (FR-AGT-21)." />
                      </div>
                      <Select value={hop.catalogEntryId} onValueChange={(v) => v !== null && updateHop(idx, { catalogEntryId: v })}>
                        <SelectTrigger id={`hop-${idx}-entry`} aria-label={`Hop ${idx + 1} catalog entry`} className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(catalog ?? [])
                            .filter((c) => c.providerId === hop.providerId)
                            .map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.displayName} ({c.modelId})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="icon-xs" variant="ghost" aria-label={`Remove hop ${idx + 1}`} onClick={() => setHops(hops.filter((_, i) => i !== idx))}>
                      ×
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="self-start" onClick={addHop}>
                  + Add hop
                </Button>
              </div>

              <div className="mb-4 flex items-center gap-6">
                <div>
                  <Label htmlFor="route-cache-mode" className="mb-1 text-sm">
                    Cache mode
                  </Label>
                  <Select value={cacheMode} onValueChange={(v) => v !== null && setCacheMode(v as typeof cacheMode)}>
                    <SelectTrigger id="route-cache-mode" aria-label="Cache mode" className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Off">Off</SelectItem>
                      <SelectItem value="ExactMatch">Exact Match</SelectItem>
                      <SelectItem value="Semantic">Semantic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Label className="mt-5 flex items-center gap-2">
                  <Checkbox checked={allowOutOfRegionFailover} onCheckedChange={(v) => setAllowOutOfRegionFailover(v === true)} />
                  Allow out-of-region failover
                </Label>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">
                Defaults to false (FR-AGT-22/25) — an out-of-region hop is still rejected unless this AND the tenant&apos;s own residency setting
                (Settings → Retention and Residency) both opt in.
              </p>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void saveVersion(false)} disabled={saving}>
                  {saving ? "Saving…" : "Save as Draft"}
                </Button>
                <Button onClick={() => void saveVersion(true)} disabled={saving}>
                  {saving ? "Saving…" : "Save & Publish"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {routes && routes.length === 0 && (
        <Alert>
          <AlertDescription>No routes configured yet — unconfigured logical names fall back to the platform env default.</AlertDescription>
        </Alert>
      )}
      <Badge variant="secondary" className="mt-2">
        Recommended standard routes: chat.primary, chat.router, embed.default, rerank.default, vision.default (FR-AGT-23)
      </Badge>
    </div>
  );
}
