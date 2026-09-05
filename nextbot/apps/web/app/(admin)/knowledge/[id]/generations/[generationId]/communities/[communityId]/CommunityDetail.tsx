"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { fetchJson } from "@/src/lib/fetch-json";

interface CommunityListItem {
  id: string;
  level: number;
  title: string | null;
  summary: string | null;
  summaryStale: boolean;
  entityCount: number;
}

interface EntityListItem {
  id: string;
  canonicalName: string;
  type: string;
  degree: number;
  mentionCount: number;
}

/** Community view (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04):
 *  entities grouped by community, with the community's own generated summary
 *  visible. */
export function CommunityDetail({ collectionId, generationId, communityId }: { collectionId: string; generationId: string; communityId: string }) {
  const [community, setCommunity] = useState<CommunityListItem | null>(null);
  const [members, setMembers] = useState<EntityListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const result = await fetchJson<{ community: CommunityListItem; members: EntityListItem[] }>(
        `/api/v1/admin/knowledge/generations/${generationId}/graph/communities/${communityId}`,
      );
      if (result.kind === "ok") {
        setCommunity(result.data.community);
        setMembers(result.data.members);
      } else {
        setError(result.message);
      }
    }
    void load();
  }, [generationId, communityId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!community || members === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" role="status" aria-label="Loading community" />
        <Skeleton className="h-10 w-full" role="status" aria-label="Loading community" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        <NextLink href={`/knowledge/${collectionId}`} className="hover:underline">
          Knowledge Collection
        </NextLink>
        {" > "}
        <NextLink href={`/knowledge/${collectionId}/generations/${generationId}`} className="hover:underline">
          Graph Explorer
        </NextLink>
        {" > "}
        {community.title ?? "Community"}
      </p>

      <div>
        <div className="mb-2 flex items-center gap-3">
          <h1 className="font-heading text-lg font-semibold">{community.title ?? "(untitled community)"}</h1>
          {community.summaryStale && <Badge variant="secondary">Summary stale — will regenerate as membership changes</Badge>}
        </div>
        <p>{community.summary ?? <span className="text-muted-foreground">No summary generated for this community yet.</span>}</p>
        <p className="mt-2 text-sm text-muted-foreground">{community.entityCount} member entities</p>
      </div>

      <section>
        <h2 className="mb-3 font-heading text-base font-semibold">Members</h2>
        {members.length === 0 ? (
          <p className="text-muted-foreground">No member entities.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Relations</TableHead>
                <TableHead>Mentions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <NextLink href={`/knowledge/${collectionId}/generations/${generationId}/entities/${m.id}`} className="text-primary hover:underline">
                      {m.canonicalName}
                    </NextLink>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.type}</Badge>
                  </TableCell>
                  <TableCell>{m.degree > 0 ? m.degree : <span className="text-muted-foreground">No relations extracted</span>}</TableCell>
                  <TableCell>{m.mentionCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
