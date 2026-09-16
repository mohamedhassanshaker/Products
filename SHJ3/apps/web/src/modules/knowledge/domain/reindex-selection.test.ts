import { describe, expect, it } from "vitest";
import { selectChunksForReindex, type ReindexCandidateChunk } from "./reindex-selection.js";

/** A deliberately mixed set: some already `Indexed` on both axes, some `Stale`, some `Pending`, some `Failed` — every state a real source could be in when a job starts. */
const MIXED_CHUNKS: readonly ReindexCandidateChunk[] = [
  { id: "c1", vectorState: "Indexed", graphState: "Indexed" },
  { id: "c2", vectorState: "Indexed", graphState: "Indexed" },
  { id: "c3", vectorState: "Stale", graphState: "Indexed" },
  { id: "c4", vectorState: "Indexed", graphState: "Failed" },
  { id: "c5", vectorState: "Pending", graphState: "Pending" },
];

describe("selecting which chunks a re-index job re-processes", () => {
  it("EmbeddingModelChange selects every chunk in scope, regardless of current state — the named hard invariant of this wave", () => {
    const selected = selectChunksForReindex("EmbeddingModelChange", MIXED_CHUNKS);
    expect(selected).toHaveLength(MIXED_CHUNKS.length);
    expect(selected.map((c) => c.id)).toEqual(MIXED_CHUNKS.map((c) => c.id));
  });

  it("Manual, Restore and GraphMerge also select the full set — only Reconciliation narrows", () => {
    for (const reason of ["Manual", "Restore", "GraphMerge"] as const) {
      expect(selectChunksForReindex(reason, MIXED_CHUNKS)).toHaveLength(MIXED_CHUNKS.length);
    }
  });

  it("Reconciliation selects only chunks whose vector or graph state already signals drift", () => {
    const selected = selectChunksForReindex("Reconciliation", MIXED_CHUNKS);
    expect(selected.map((c) => c.id).sort()).toEqual(["c3", "c4", "c5"]);
  });

  it("Reconciliation against an all-Indexed set selects nothing — it must never over-select either", () => {
    const allHealthy: readonly ReindexCandidateChunk[] = [
      { id: "c1", vectorState: "Indexed", graphState: "Indexed" },
      { id: "c2", vectorState: "Indexed", graphState: "Indexed" },
    ];
    expect(selectChunksForReindex("Reconciliation", allHealthy)).toHaveLength(0);
  });
});
