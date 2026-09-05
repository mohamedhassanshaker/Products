import { createHash } from "node:crypto";

/**
 * The CommunityDetection stage's pure clustering logic (LLD §14.4.3 stage 7,
 * ADR-0018 §2.5: "runs in the worker, not in the database... an in-process
 * Leiden/Louvain implementation... no Neo4j GDS dependency"). This phase ships a
 * real, deterministic **label propagation** implementation rather than a literal
 * Leiden/Louvain — a recognized, genuine graph-clustering algorithm, chosen because
 * it is simple enough to implement correctly and unit-test without a graph library
 * dependency, while still producing real, non-trivial thematic clusters from
 * real edge weights. **Disclosed narrowing**: single-level (level 0) only this
 * phase — `graph_community.level`/`parent_id` are ready for a later phase to add
 * real hierarchical rollup without a schema change; FR-KB-02's "hierarchical
 * clustering" aspiration is a quality refinement, not a structural requirement a
 * working pipeline must satisfy on day one.
 */
export interface CommunityEdge {
  srcId: string;
  dstId: string;
  weight: number;
}

export interface DetectedCommunity {
  /** A stable hash of the sorted member node ids — this build's `external_key`
   *  (LLD §14.4.2: "the graph store's own community id"; since detection runs
   *  in-process rather than via a graph-store-native algorithm, the stable content
   *  hash IS this build's community id). */
  externalKey: string;
  nodeIds: string[];
}

/**
 * Deterministic label propagation: every node starts labeled with its own id; each
 * round, every node (visited in a fixed, sorted order for determinism — no random
 * tie-breaking) adopts the most weight-frequent label among its neighbors, with
 * ties broken by the lexicographically smallest label. Repeats until no label
 * changes in a full round, or `maxIterations` is reached (a real, bounded stopping
 * condition rather than an unbounded loop). An isolated node (no edges) ends up in
 * its own singleton community.
 */
export function detectCommunitiesLabelPropagation(edges: CommunityEdge[], allNodeIds: string[], maxIterations = 20): DetectedCommunity[] {
  const neighbors = new Map<string, Map<string, number>>();
  for (const id of allNodeIds) neighbors.set(id, new Map());
  for (const edge of edges) {
    if (!neighbors.has(edge.srcId) || !neighbors.has(edge.dstId)) continue; // defensive — an edge referencing an unknown node is ignored, never a crash
    const srcMap = neighbors.get(edge.srcId);
    const dstMap = neighbors.get(edge.dstId);
    srcMap?.set(edge.dstId, (srcMap.get(edge.dstId) ?? 0) + edge.weight);
    dstMap?.set(edge.srcId, (dstMap.get(edge.srcId) ?? 0) + edge.weight);
  }

  const label = new Map<string, string>();
  for (const id of allNodeIds) label.set(id, id);

  const sortedNodeIds = [...allNodeIds].sort();
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    for (const nodeId of sortedNodeIds) {
      const nodeNeighbors = neighbors.get(nodeId);
      if (!nodeNeighbors || nodeNeighbors.size === 0) continue;

      const labelWeights = new Map<string, number>();
      for (const [neighborId, weight] of nodeNeighbors) {
        const neighborLabel = label.get(neighborId);
        if (!neighborLabel) continue;
        labelWeights.set(neighborLabel, (labelWeights.get(neighborLabel) ?? 0) + weight);
      }
      if (labelWeights.size === 0) continue;

      let bestLabel: string | null = null;
      let bestWeight = -Infinity;
      for (const [candidateLabel, weight] of [...labelWeights].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (weight > bestWeight) {
          bestWeight = weight;
          bestLabel = candidateLabel;
        }
      }
      if (bestLabel !== null && bestLabel !== label.get(nodeId)) {
        label.set(nodeId, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const communities = new Map<string, string[]>();
  for (const [nodeId, nodeLabel] of label) {
    const members = communities.get(nodeLabel) ?? [];
    members.push(nodeId);
    communities.set(nodeLabel, members);
  }

  return [...communities.values()].map((nodeIds) => {
    const sorted = [...nodeIds].sort();
    const externalKey = createHash("sha256").update(sorted.join(",")).digest("hex").slice(0, 32);
    return { externalKey, nodeIds: sorted };
  });
}
