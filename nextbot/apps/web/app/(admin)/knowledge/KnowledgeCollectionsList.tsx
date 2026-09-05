"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { AccessDeniedState } from "@nextbot/ui";
import { fetchJson } from "@/src/lib/fetch-json";

interface KnowledgeCollectionListItem {
  id: string;
  name: string;
  description: string | null;
  region: "UAE" | "EU" | "US";
  status: "Draft" | "Building" | "Ready" | "ReEmbedding" | "Stale" | "Failed";
  updatedAt: string;
}

const STATUS_VARIANT: Record<KnowledgeCollectionListItem["status"], "default" | "secondary" | "destructive" | "outline"> = {
  Draft: "outline",
  Building: "secondary",
  Ready: "default",
  ReEmbedding: "secondary",
  Stale: "outline",
  Failed: "destructive",
};

/** Knowledge Collections list — mirrors the Skills Library list screen's
 *  established pattern (loading skeleton / empty state / error+retry / table). */
export function KnowledgeCollectionsList({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [collections, setCollections] = useState<KnowledgeCollectionListItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await fetchJson<{ collections: KnowledgeCollectionListItem[] }>("/api/v1/admin/knowledge/collections");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    setCollections(result.data.collections ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  if (forbidden) return <AccessDeniedState moduleLabel="Knowledge" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Knowledge Collections</h1>
        {canWrite && <Button onClick={() => router.push("/knowledge/new")}>+ New Collection</Button>}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex items-center gap-4">
            {error}
            <Button size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {collections === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading knowledge collections" />
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading knowledge collections" />
        </div>
      ) : collections && collections.length === 0 ? (
        <div className="py-12 text-center">
          <p className="mb-4 text-muted-foreground">No knowledge collections yet</p>
          {canWrite && <Button onClick={() => router.push("/knowledge/new")}>+ New Collection</Button>}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Index status</TableHead>
              <TableHead>Last updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collections?.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <NextLink href={`/knowledge/${c.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {c.name}
                  </NextLink>
                </TableCell>
                <TableCell>{c.region}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                </TableCell>
                <TableCell>{new Date(c.updatedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
