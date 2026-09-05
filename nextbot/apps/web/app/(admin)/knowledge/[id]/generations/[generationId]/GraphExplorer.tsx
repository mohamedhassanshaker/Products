"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { fetchJson } from "@/src/lib/fetch-json";

interface EntityListItem {
  id: string;
  canonicalName: string;
  type: string;
  aliases: string[];
  summary: string | null;
  degree: number;
  mentionCount: number;
  communityId: string | null;
  communityTitle: string | null;
}

interface CommunityListItem {
  id: string;
  level: number;
  title: string | null;
  summary: string | null;
  summaryStale: boolean;
  entityCount: number;
}

const ENTITY_PAGE_SIZE = 50;

/**
 * Graph Explorer (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04). Reached
 * from a collection's Generations table ("Explore graph"). Read-only — this phase
 * adds no manual entity/edge editing capability.
 *
 * Design decision (recorded per this phase's own request for reasoning): a
 * TABLE-BASED navigator with drill-down, not an interactive graph-canvas
 * visualization. Checked this monorepo for an existing graph/charting dependency
 * first (none — no d3/cytoscape/react-flow/vis-network/sigma anywhere in the
 * workspace); every other console screen in this codebase (Skills Library, MCP
 * servers, Model Gateway) already establishes the list/table + detail-drilldown
 * pattern this reuses directly. Adding a net-new charting library for one screen
 * would need to clear the ADR's maintenance/license/adoption bar for a real
 * dependency risk this project's own rules ask to be weighed, for a visualization
 * FR-KB-04 does not actually require (its own text asks for browsing entities,
 * relations, communities, and provenance — a table with drill-down satisfies all
 * four without that risk). No `nexus-ux` dispatch was made: this is a routine
 * list/detail screen the existing patterns already document.
 */
export function GraphExplorer({ collectionId, generationId }: { collectionId: string; generationId: string }) {
  const [entities, setEntities] = useState<EntityListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [entityError, setEntityError] = useState<string | null>(null);

  const [communities, setCommunities] = useState<CommunityListItem[] | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);

  async function loadEntities(reset: boolean, cursor?: string | null) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (typeFilter) params.set("type", typeFilter);
    params.set("limit", String(ENTITY_PAGE_SIZE));
    if (cursor) params.set("cursor", cursor);

    const result = await fetchJson<{ entities: EntityListItem[]; nextCursor: string | null }>(`/api/v1/admin/knowledge/generations/${generationId}/graph/entities?${params.toString()}`);
    if (result.kind === "ok") {
      setEntities((prev) => (reset || !prev ? result.data.entities : [...prev, ...result.data.entities]));
      setNextCursor(result.data.nextCursor);
      setEntityError(null);
    } else {
      setEntityError(result.message);
    }
  }

  async function loadCommunities() {
    const result = await fetchJson<{ communities: CommunityListItem[] }>(`/api/v1/admin/knowledge/generations/${generationId}/graph/communities`);
    if (result.kind === "ok") {
      setCommunities(result.data.communities);
      setCommunityError(null);
    } else {
      setCommunityError(result.message);
    }
  }

  useEffect(() => {
    // No `react-hooks/exhaustive-deps` rule is registered in this project's ESLint
    // config (confirmed — same as `DesignModeForm.tsx`'s own note), so this
    // deliberately depends on `generationId` only: `q`/`typeFilter` are read fresh
    // inside `loadEntities` via closure at CALL time (the submit handler always
    // calls it after the latest `setQ`/`setTypeFilter`), not at mount time.
    setEntities(null);
    void loadEntities(true);
    void loadCommunities();
  }, [generationId]);

  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEntities(null);
    await loadEntities(true);
  }

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      await loadEntities(false, nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        <NextLink href={`/knowledge/${collectionId}`} className="hover:underline">
          Knowledge Collection
        </NextLink>
        {" > "}Graph Explorer
      </p>
      <h1 className="font-heading text-lg font-semibold">Graph Explorer</h1>
      <p className="text-muted-foreground">
        Browse extracted entities, their relations, and the communities they belong to. Every relation traces back to the exact source chunk it was extracted from — follow a
        relation&apos;s &quot;View source&quot; link to see the sentence that produced it.
      </p>

      <Tabs defaultValue="entities">
        <TabsList>
          <TabsTrigger id="graph-explorer-tab-entities" panelId="graph-explorer-panel-entities" value="entities">
            Entities
          </TabsTrigger>
          <TabsTrigger id="graph-explorer-tab-communities" panelId="graph-explorer-panel-communities" value="communities">
            Communities
          </TabsTrigger>
        </TabsList>

        <TabsContent id="graph-explorer-panel-entities" value="entities" className="flex flex-col gap-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-end gap-4">
            <div>
              <Label htmlFor="entity-search">Search by name</Label>
              <Input id="entity-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Acme Corp" />
            </div>
            <div>
              <Label htmlFor="entity-type">Type</Label>
              <Input id="entity-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} placeholder="e.g. Organization" />
            </div>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>

          {entityError && (
            <Alert variant="destructive">
              <AlertDescription>{entityError}</AlertDescription>
            </Alert>
          )}

          {entities === null ? (
            <Skeleton className="h-10 w-full" role="status" aria-label="Loading entities" />
          ) : entities.length === 0 ? (
            <p className="text-muted-foreground">No entities match this filter.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Community</TableHead>
                    <TableHead>Relations</TableHead>
                    <TableHead>Mentions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entities.map((entity) => (
                    <TableRow key={entity.id}>
                      <TableCell>
                        <NextLink href={`/knowledge/${collectionId}/generations/${generationId}/entities/${entity.id}`} className="text-primary hover:underline">
                          {entity.canonicalName}
                        </NextLink>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entity.type}</Badge>
                      </TableCell>
                      <TableCell>
                        {entity.communityId ? (
                          <NextLink href={`/knowledge/${collectionId}/generations/${generationId}/communities/${entity.communityId}`} className="hover:underline">
                            {entity.communityTitle ?? "(untitled)"}
                          </NextLink>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* FR-KB-04 boundary: an isolated node (degree 0) still renders, tagged distinctly rather than hidden. */}
                        {entity.degree > 0 ? entity.degree : <span className="text-muted-foreground">No relations extracted</span>}
                      </TableCell>
                      <TableCell>{entity.mentionCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {nextCursor && (
                <Button variant="outline" onClick={() => void handleLoadMore()} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent id="graph-explorer-panel-communities" value="communities" className="flex flex-col gap-4">
          {communityError && (
            <Alert variant="destructive">
              <AlertDescription>{communityError}</AlertDescription>
            </Alert>
          )}
          {communities === null ? (
            <Skeleton className="h-10 w-full" role="status" aria-label="Loading communities" />
          ) : communities.length === 0 ? (
            <p className="text-muted-foreground">No communities detected yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Entities</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {communities.map((community) => (
                  <TableRow key={community.id}>
                    <TableCell>
                      <NextLink href={`/knowledge/${collectionId}/generations/${generationId}/communities/${community.id}`} className="text-primary hover:underline">
                        {community.title ?? "(untitled community)"}
                      </NextLink>
                      {community.summaryStale && (
                        <Badge variant="secondary" className="ms-2">
                          Summary stale
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[420px] truncate">{community.summary ?? "—"}</TableCell>
                    <TableCell>{community.entityCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
