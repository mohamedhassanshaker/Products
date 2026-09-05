"use client";

import { useState } from "react";
import NextLink from "next/link";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@nextbot/ui/components/ui/card";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { fetchJson } from "@/src/lib/fetch-json";

type RetrievalStrategyName = "Vector" | "GraphLocal" | "GraphGlobal" | "Hybrid";

const ALL_STRATEGIES: RetrievalStrategyName[] = ["Vector", "GraphLocal", "GraphGlobal", "Hybrid"];

const STRATEGY_LABELS: Record<RetrievalStrategyName, string> = {
  Vector: "Vector",
  GraphLocal: "Graph — local",
  GraphGlobal: "Graph — global",
  Hybrid: "Hybrid",
};

const STRATEGY_DESCRIPTIONS: Record<RetrievalStrategyName, string> = {
  Vector: "Top-k similarity over chunk embeddings. Lowest cost — best for lookup questions a single passage answers.",
  GraphLocal: "Anchors on entities mentioned in the query, walks N hops, returns neighbour chunks plus the relation path.",
  GraphGlobal: "Maps over community summaries and reduces to an answer. Highest cost — best for broad, thematic questions.",
  Hybrid: "Vector recall, then graph expansion of the top entities, then rerank. Medium cost.",
};

interface RelationPathHop {
  srcName: string;
  relation: string;
  dstName: string;
  provenanceChunkId: string;
}

interface RetrievalEvidenceItem {
  kind: "Chunk" | "CommunitySummary";
  score: number;
  chunkId?: string;
  documentTitle?: string | null;
  sourceName?: string;
  snippet?: string;
  communityTitle?: string | null;
  summary?: string;
  relationPath?: RelationPathHop[];
}

interface RetrievalStrategyResult {
  strategy: RetrievalStrategyName;
  items: RetrievalEvidenceItem[];
  metrics: { groundednessScore: number | null; latencyMs: number; costUsd: string };
  note?: string;
  synthesizedAnswer?: string;
}

interface RetrievalPlaygroundResponse {
  query: string;
  generationId: string;
  results: RetrievalStrategyResult[];
}

function formatScore(score: number | null): string {
  return score === null ? "—" : `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}

function formatCost(costUsd: string): string {
  const value = Number(costUsd);
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  return value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`;
}

/**
 * Retrieval Playground (Target Architecture Blueprint Phase 9, BL-40, FR-KB-05,
 * Blueprint §7.4/Figure 5) — enter a query, pick which of the four retrieval
 * strategies to run (all four by default, matching Figure 5's side-by-side
 * comparison), see each strategy's own result set plus groundedness/latency/cost.
 *
 * Reuses the Skills Library/Graph Explorer screens' established list/detail +
 * `FieldHint` conventions directly — a routine comparison-table screen those
 * patterns already cover, so no `nexus-ux` dispatch was made for this phase.
 */
export function RetrievalPlayground({ collectionId }: { collectionId: string }) {
  const [query, setQuery] = useState("");
  const [selectedStrategies, setSelectedStrategies] = useState<Set<RetrievalStrategyName>>(new Set(ALL_STRATEGIES));
  const [maxHops, setMaxHops] = useState("2");
  const [topK, setTopK] = useState("12");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<RetrievalPlaygroundResponse | null>(null);

  function toggleStrategy(strategy: RetrievalStrategyName, checked: boolean) {
    setSelectedStrategies((prev) => {
      const next = new Set(prev);
      if (checked) next.add(strategy);
      else next.delete(strategy);
      return next;
    });
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      setError("Enter a query first.");
      return;
    }
    if (selectedStrategies.size === 0) {
      setError("Select at least one strategy to run.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const result = await fetchJson<RetrievalPlaygroundResponse>("/api/v1/admin/knowledge/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          query,
          strategies: [...selectedStrategies],
          topK: Number(topK) || undefined,
          maxHops: Number(maxHops) || undefined,
        }),
      });
      if (result.kind === "ok") {
        setResponse(result.data);
      } else {
        setError(result.message);
        setResponse(null);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        <NextLink href={`/knowledge/${collectionId}`} className="hover:underline">
          Knowledge Collection
        </NextLink>
        {" > "}Retrieval Playground
      </p>
      <h1 className="font-heading text-lg font-semibold">Retrieval Playground</h1>
      <p className="text-muted-foreground">
        Compare the four retrieval strategies against the same query — groundedness, latency, and cost per strategy, side by side.
      </p>

      <form onSubmit={handleRun} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="playground-query">Query</Label>
          <Input id="playground-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Can a customer dispute a charge after the refund window closes?" />
        </div>

        <div>
          <Label>Strategies to run</Label>
          <FieldHint id="playground-strategies-hint" content="No automatic query classifier exists yet (that ships with the bounded retrieval agent) — pick which strategy or strategies to run yourself." />
          <div className="mt-2 flex flex-wrap gap-4">
            {ALL_STRATEGIES.map((strategy) => (
              <div key={strategy} className="flex items-center gap-2">
                <Checkbox
                  id={`playground-strategy-${strategy}`}
                  checked={selectedStrategies.has(strategy)}
                  onCheckedChange={(c) => toggleStrategy(strategy, c === true)}
                />
                <Label htmlFor={`playground-strategy-${strategy}`}>{STRATEGY_LABELS[strategy]}</Label>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div>
            <Label htmlFor="playground-topk">Top K</Label>
            <Input id="playground-topk" type="number" min={1} max={100} value={topK} onChange={(e) => setTopK(e.target.value)} className="w-24" />
          </div>
          <div>
            <Label htmlFor="playground-maxhops">Max hops</Label>
            <FieldHint id="playground-maxhops-hint" content="Bounded 0-4 regardless of what's entered here — a hard ceiling enforced server-side so a graph traversal can never run away." />
            <Input id="playground-maxhops" type="number" min={0} max={4} value={maxHops} onChange={(e) => setMaxHops(e.target.value)} className="w-24" />
          </div>
        </div>

        <Button type="submit" disabled={running} className="w-fit">
          {running ? "Running…" : "Run"}
        </Button>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {running && <Skeleton className="h-40 w-full" role="status" aria-label="Running retrieval strategies" />}

      {response && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {response.results.map((result) => (
            <Card key={result.strategy} data-testid={`playground-result-${result.strategy}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>{STRATEGY_LABELS[result.strategy]}</span>
                  <Badge variant="outline">{result.items.length} result{result.items.length === 1 ? "" : "s"}</Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{STRATEGY_DESCRIPTIONS[result.strategy]}</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    Groundedness: <strong>{formatScore(result.metrics.groundednessScore)}</strong>
                  </span>
                  <span>
                    Latency: <strong>{result.metrics.latencyMs} ms</strong>
                  </span>
                  <span>
                    Cost: <strong>{formatCost(result.metrics.costUsd)}</strong>
                  </span>
                </div>

                {result.note && (
                  <Alert>
                    <AlertDescription>{result.note}</AlertDescription>
                  </Alert>
                )}

                {result.synthesizedAnswer && (
                  <div className="rounded-md border p-3 text-sm">
                    <p className="mb-1 font-medium">Synthesized answer</p>
                    <p className="text-muted-foreground">{result.synthesizedAnswer}</p>
                  </div>
                )}

                {result.items.length === 0 && !result.note ? (
                  <p className="text-sm text-muted-foreground">No results.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {result.items.map((item, idx) => (
                      <li key={`${item.chunkId ?? item.communityTitle ?? idx}-${idx}`} className="rounded-md border p-3 text-sm">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <Badge variant="secondary">{item.kind === "Chunk" ? "Chunk" : "Community"}</Badge>
                          <span className="text-muted-foreground">{formatScore(item.score)}</span>
                        </div>
                        {item.kind === "Chunk" ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              {item.documentTitle ?? "(untitled document)"} · {item.sourceName}
                            </p>
                            <p className="mt-1 line-clamp-3">{item.snippet}</p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-muted-foreground">{item.communityTitle ?? "(untitled community)"}</p>
                            <p className="mt-1 line-clamp-3">{item.summary}</p>
                          </>
                        )}
                        {item.relationPath && item.relationPath.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.relationPath.map((hop, hopIdx) => (
                              <Badge key={hopIdx} variant="outline" className="font-normal">
                                {hop.srcName} —[{hop.relation}]→ {hop.dstName}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
