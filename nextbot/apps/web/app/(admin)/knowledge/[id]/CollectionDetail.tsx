"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  region: "UAE" | "EU" | "US";
  status: "Draft" | "Building" | "Ready" | "ReEmbedding" | "Stale" | "Failed";
  currentGenerationId: string | null;
}

interface SourceRow {
  id: string;
  name: string;
  kind: "Upload" | "Url" | "McpResource" | "Connector";
  status: "Pending" | "Syncing" | "Synced" | "PartiallyFailed" | "Failed" | "Purged";
  documentCount: number;
  failedDocumentCount: number;
}

interface GenerationRow {
  id: string;
  generation: number;
  status: "Building" | "Ready" | "Superseded" | "Failed" | "Cancelled";
  chunkCount: number;
  entityCount: number;
  edgeCount: number;
  communityCount: number;
}

type SourceKind = SourceRow["kind"];

/** Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the Freshness
 *  sub-requirement's own UI shape (`getCollectionFreshness`'s response, verbatim). */
interface FreshnessInfo {
  status: "NoGeneration" | "Fresh" | "Stale" | "NoStalenessLimitConfigured";
  ageHours: number | null;
  maxStalenessHours: number | null;
}

export function CollectionDetail({ collectionId, canWrite, canWriteConfig }: { collectionId: string; canWrite: boolean; canWriteConfig: boolean }) {
  const [collection, setCollection] = useState<CollectionRow | null>(null);
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [generations, setGenerations] = useState<GenerationRow[] | null>(null);
  const [freshness, setFreshness] = useState<FreshnessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sourceKind, setSourceKind] = useState<SourceKind>("Upload");
  const [sourceName, setSourceName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [mcpManifestItemId, setMcpManifestItemId] = useState("");
  const [mcpUri, setMcpUri] = useState("");
  const [connectorId, setConnectorId] = useState("");
  const [connectorTool, setConnectorTool] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [building, setBuilding] = useState(false);

  async function load() {
    const [collectionResult, sourcesResult, generationsResult, freshnessResult] = await Promise.all([
      fetchJson<{ collection: CollectionRow }>(`/api/v1/admin/knowledge/collections/${collectionId}`),
      fetchJson<{ sources: SourceRow[] }>(`/api/v1/admin/knowledge/collections/${collectionId}/sources`),
      fetchJson<{ generations: GenerationRow[] }>(`/api/v1/admin/knowledge/collections/${collectionId}/generations`),
      fetchJson<FreshnessInfo>(`/api/v1/admin/knowledge/collections/${collectionId}/freshness`),
    ]);
    if (collectionResult.kind === "ok") setCollection(collectionResult.data.collection);
    if (sourcesResult.kind === "ok") setSources(sourcesResult.data.sources);
    if (generationsResult.kind === "ok") setGenerations(generationsResult.data.generations);
    // Freshness is a nice-to-have badge, not core collection data — a fetch failure
    // here never blocks rendering the rest of the page (no `setError` on failure).
    if (freshnessResult.kind === "ok") setFreshness(freshnessResult.data);
    if (collectionResult.kind === "error") setError(collectionResult.message);
  }

  useEffect(() => {
    void load();
  }, [collectionId]);

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault();
    setAddingSource(true);
    try {
      let locator: unknown;
      if (sourceKind === "Upload") {
        if (!file) {
          toast.error("Choose a file first.");
          return;
        }
        const formData = new FormData();
        formData.append("file", file);
        const uploadResult = await fetchJson<{ locator: unknown }>("/api/v1/admin/knowledge/upload", { method: "POST", body: formData });
        if (uploadResult.kind !== "ok") {
          toast.error(uploadResult.kind === "forbidden" ? uploadResult.message : uploadResult.message);
          return;
        }
        locator = uploadResult.data.locator;
      } else if (sourceKind === "Url") {
        locator = { kind: "Url", url, crawlDepth: 0, includePatterns: [], excludePatterns: [], respectRobots: true };
      } else if (sourceKind === "McpResource") {
        locator = { kind: "McpResource", mcpManifestItemId, mcpServerVersionId: "", uri: mcpUri };
      } else {
        locator = { kind: "Connector", connectorId, toolName: connectorTool, argTemplate: {} };
      }

      const result = await fetchJson(`/api/v1/admin/knowledge/collections/${collectionId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: sourceKind, name: sourceName, locator, acl: { tags: [], visibility: "Tenant" } }),
      });
      if (result.kind === "ok") {
        toast.success("Source added.");
        setSourceName("");
        setFile(null);
        setUrl("");
        void load();
      } else {
        toast.error(result.message);
      }
    } finally {
      setAddingSource(false);
    }
  }

  async function handleSync(sourceId: string) {
    const result = await fetchJson(`/api/v1/admin/knowledge/sources/${sourceId}/sync`, { method: "POST" });
    if (result.kind === "ok") {
      toast.success("Sync enqueued.");
      void load();
    } else {
      toast.error(result.message);
    }
  }

  async function handleBuild() {
    setBuilding(true);
    try {
      const result = await fetchJson(`/api/v1/admin/knowledge/collections/${collectionId}/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (result.kind === "ok") {
        toast.success("Generation build started.");
        void load();
        return;
      }
      if (result.kind === "error" && result.status === 409) {
        const confirmReembed = window.confirm("Changing the embedding model invalidates this index and requires a full re-embed — continue?");
        if (confirmReembed) {
          const retry = await fetchJson(`/api/v1/admin/knowledge/collections/${collectionId}/generations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmReEmbed: true }),
          });
          if (retry.kind === "ok") {
            toast.success("Re-embed started.");
            void load();
            return;
          }
        }
      }
      toast.error(result.message);
    } finally {
      setBuilding(false);
    }
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center gap-4">
          {error}
          <Button size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!collection) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" role="status" aria-label="Loading collection" />
        <Skeleton className="h-10 w-full" role="status" aria-label="Loading collection" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h1 className="font-heading text-lg font-semibold">{collection.name}</h1>
          <Badge>{collection.status}</Badge>
          {freshness && freshness.status !== "NoGeneration" && (
            <Badge
              variant={freshness.status === "Stale" ? "destructive" : freshness.status === "NoStalenessLimitConfigured" ? "outline" : "secondary"}
              title={
                freshness.status === "NoStalenessLimitConfigured"
                  ? "No maximum staleness configured — the retrieval agent can never refuse for staleness on this collection."
                  : `Current index is ${freshness.ageHours ? Math.round(freshness.ageHours) : 0}h old (limit: ${freshness.maxStalenessHours}h)`
              }
            >
              {freshness.status === "Stale" ? "Stale" : freshness.status === "NoStalenessLimitConfigured" ? "No staleness limit" : "Fresh"}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground">{collection.description ?? "No description"}</p>
        <p className="text-sm text-muted-foreground">Region: {collection.region}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {canWriteConfig && (
            <Button onClick={() => void handleBuild()} disabled={building}>
              {building ? "Starting…" : "Build generation"}
            </Button>
          )}
          {collection.currentGenerationId ? (
            <NextLink href={`/knowledge/${collectionId}/playground`}>
              <Button variant="outline">Retrieval Playground</Button>
            </NextLink>
          ) : (
            <Button variant="outline" disabled title="Build a generation first">
              Retrieval Playground
            </Button>
          )}
          <NextLink href={`/knowledge/${collectionId}/coverage`}>
            <Button variant="outline">Coverage report</Button>
          </NextLink>
        </div>
      </div>

      <section>
        <h2 className="mb-3 font-heading text-base font-semibold">Sources</h2>
        {sources === null ? (
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading sources" />
        ) : sources.length === 0 ? (
          <p className="text-muted-foreground">No sources yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Documents</TableHead>
                <TableHead>Failed</TableHead>
                {canWrite && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.kind}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === "Failed" ? "destructive" : "outline"}>{s.status}</Badge>
                  </TableCell>
                  <TableCell>{s.documentCount}</TableCell>
                  <TableCell>{s.failedDocumentCount}</TableCell>
                  {canWrite && (
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => void handleSync(s.id)}>
                        Sync
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {canWrite && (
          <form onSubmit={handleAddSource} className="mt-6 flex max-w-xl flex-col gap-4">
            <h3 className="font-medium">Add a source</h3>
            <div>
              <Label htmlFor="source-name">Name</Label>
              <Input id="source-name" value={sourceName} onChange={(e) => setSourceName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="source-kind">Kind</Label>
              <FieldHint id="source-kind-hint" content="File and URL sources are fetched for real content today; MCP resource and connector-sync sources are captured now but their content fetch integration ships in a later phase." />
              <Select value={sourceKind} onValueChange={(v) => setSourceKind(v as SourceKind)}>
                <SelectTrigger id="source-kind" aria-label="Source kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Upload">File upload</SelectItem>
                  <SelectItem value="Url">URL</SelectItem>
                  <SelectItem value="McpResource">MCP resource</SelectItem>
                  <SelectItem value="Connector">Connector sync</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sourceKind === "Upload" && (
              <div>
                <Label htmlFor="source-file">File</Label>
                <Input id="source-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
              </div>
            )}
            {sourceKind === "Url" && (
              <div>
                <Label htmlFor="source-url">URL</Label>
                <Input id="source-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
              </div>
            )}
            {sourceKind === "McpResource" && (
              <>
                <div>
                  <Label htmlFor="mcp-manifest-item">MCP manifest item ID</Label>
                  <Input id="mcp-manifest-item" value={mcpManifestItemId} onChange={(e) => setMcpManifestItemId(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="mcp-uri">Resource URI</Label>
                  <Input id="mcp-uri" value={mcpUri} onChange={(e) => setMcpUri(e.target.value)} required />
                </div>
              </>
            )}
            {sourceKind === "Connector" && (
              <>
                <div>
                  <Label htmlFor="connector-id">Connector ID</Label>
                  <Input id="connector-id" value={connectorId} onChange={(e) => setConnectorId(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="connector-tool">Tool name</Label>
                  <Input id="connector-tool" value={connectorTool} onChange={(e) => setConnectorTool(e.target.value)} required />
                </div>
              </>
            )}
            <Button type="submit" disabled={addingSource}>
              {addingSource ? "Adding…" : "Add source"}
            </Button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-heading text-base font-semibold">Generations</h2>
        {generations === null ? (
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading generations" />
        ) : generations.length === 0 ? (
          <p className="text-muted-foreground">No generations built yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Generation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Entities</TableHead>
                <TableHead>Edges</TableHead>
                <TableHead>Communities</TableHead>
                <TableHead>Graph</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {generations.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>#{g.generation}</TableCell>
                  <TableCell>
                    <Badge variant={g.status === "Failed" ? "destructive" : g.status === "Ready" ? "default" : "secondary"}>{g.status}</Badge>
                  </TableCell>
                  <TableCell>{g.chunkCount}</TableCell>
                  <TableCell>{g.entityCount}</TableCell>
                  <TableCell>{g.edgeCount}</TableCell>
                  <TableCell>{g.communityCount}</TableCell>
                  <TableCell>
                    {g.entityCount > 0 ? (
                      <NextLink href={`/knowledge/${collectionId}/generations/${g.id}`} className="text-sm text-primary hover:underline">
                        Explore graph
                      </NextLink>
                    ) : (
                      <span className="text-sm text-muted-foreground">No entities yet</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
