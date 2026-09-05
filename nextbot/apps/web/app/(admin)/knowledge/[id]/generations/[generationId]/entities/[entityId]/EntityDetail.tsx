"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Button } from "@nextbot/ui/components/ui/button";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@nextbot/ui/components/ui/dialog";
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

interface RelationItem {
  edgeId: string;
  direction: "outgoing" | "incoming";
  relation: string;
  weight: number;
  confidence: number;
  otherEntity: { id: string; canonicalName: string; type: string };
  provenance: { chunkId: string; documentTitle: string | null; page?: number; section?: string; blockIndex: number; span: { charStart: number; charEnd: number } | null };
}

interface ChunkDetail {
  id: string;
  text: string;
  tokenCount: number;
  documentTitle: string | null;
  sourceName: string;
  provenance: { documentTitle: string | null; page?: number; section?: string };
}

/**
 * Entity inspector (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04) — the
 * critical screen: every relation lists its provenance, and "View source" opens the
 * actual chunk TEXT (never merely a chunk id), fetched on demand so a high-degree
 * entity's page load doesn't have to pull every one of its relations' full chunk
 * text up front.
 */
export function EntityDetail({ collectionId, generationId, entityId }: { collectionId: string; generationId: string; entityId: string }) {
  const [entity, setEntity] = useState<EntityListItem | null>(null);
  const [relations, setRelations] = useState<RelationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chunkDialogOpen, setChunkDialogOpen] = useState(false);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunk, setChunk] = useState<ChunkDetail | null>(null);
  const [chunkError, setChunkError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const result = await fetchJson<{ entity: EntityListItem; relations: RelationItem[] }>(`/api/v1/admin/knowledge/generations/${generationId}/graph/entities/${entityId}`);
      if (result.kind === "ok") {
        setEntity(result.data.entity);
        setRelations(result.data.relations);
      } else {
        setError(result.message);
      }
    }
    void load();
  }, [generationId, entityId]);

  async function handleViewSource(chunkId: string) {
    setChunkDialogOpen(true);
    setChunkLoading(true);
    setChunk(null);
    setChunkError(null);
    const result = await fetchJson<{ chunk: ChunkDetail }>(`/api/v1/admin/knowledge/chunks/${chunkId}`);
    if (result.kind === "ok") {
      setChunk(result.data.chunk);
    } else {
      setChunkError(result.message);
    }
    setChunkLoading(false);
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!entity || relations === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" role="status" aria-label="Loading entity" />
        <Skeleton className="h-10 w-full" role="status" aria-label="Loading entity" />
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
        {entity.canonicalName}
      </p>

      <div>
        <div className="mb-2 flex items-center gap-3">
          <h1 className="font-heading text-lg font-semibold">{entity.canonicalName}</h1>
          <Badge variant="outline">{entity.type}</Badge>
        </div>
        {entity.aliases.length > 0 && <p className="text-sm text-muted-foreground">Also known as: {entity.aliases.join(", ")}</p>}
        <p className="mt-2">{entity.summary ?? <span className="text-muted-foreground">No summary generated for this entity.</span>}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Community:{" "}
          {entity.communityId ? (
            <NextLink href={`/knowledge/${collectionId}/generations/${generationId}/communities/${entity.communityId}`} className="hover:underline">
              {entity.communityTitle ?? "(untitled)"}
            </NextLink>
          ) : (
            "—"
          )}
        </p>
        <p className="text-sm text-muted-foreground">Mentioned {entity.mentionCount} time(s) across the source documents.</p>
      </div>

      <section>
        <h2 className="mb-3 font-heading text-base font-semibold">Relations</h2>
        {relations.length === 0 ? (
          // FR-KB-04 boundary: an isolated node still renders, tagged distinctly.
          <p className="text-muted-foreground">No relations extracted for this entity.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relation</TableHead>
                <TableHead>Other entity</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Provenance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {relations.map((r) => (
                <TableRow key={r.edgeId}>
                  <TableCell>
                    <span className="me-1">{r.direction === "outgoing" ? "→" : "←"}</span>
                    {r.relation}
                  </TableCell>
                  <TableCell>
                    <NextLink href={`/knowledge/${collectionId}/generations/${generationId}/entities/${r.otherEntity.id}`} className="text-primary hover:underline">
                      {r.otherEntity.canonicalName}
                    </NextLink>{" "}
                    <Badge variant="outline">{r.otherEntity.type}</Badge>
                  </TableCell>
                  <TableCell>{r.weight.toFixed(2)}</TableCell>
                  <TableCell>{(r.confidence * 100).toFixed(0)}%</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => void handleViewSource(r.provenance.chunkId)}>
                      View source
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={chunkDialogOpen} onOpenChange={setChunkDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Source chunk</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {chunkError && (
              <Alert variant="destructive">
                <AlertDescription>{chunkError}</AlertDescription>
              </Alert>
            )}
            {chunkLoading || !chunk ? (
              !chunkError && <Skeleton className="h-24 w-full" role="status" aria-label="Loading source chunk" />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {chunk.documentTitle ?? "Untitled document"} · {chunk.sourceName}
                  {chunk.provenance.page !== undefined ? ` · page ${chunk.provenance.page}` : ""}
                  {chunk.provenance.section ? ` · ${chunk.provenance.section}` : ""}
                </p>
                <p className="whitespace-pre-wrap rounded-md border bg-muted p-3 text-sm">{chunk.text}</p>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChunkDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
