import { describe, expect, it } from "vitest";
import { canonicalizeEntityName, groupMentionsByExactCanonical, cosineSimilarity, findMergeCandidates, applyAutoMerges } from "./entity-resolution.js";

describe("canonicalizeEntityName", () => {
  it("collapses case and whitespace differences", () => {
    expect(canonicalizeEntityName("Acme  Corp")).toBe(canonicalizeEntityName("acme corp"));
    expect(canonicalizeEntityName("  Acme Corp  ")).toBe("acme corp");
  });
});

describe("groupMentionsByExactCanonical (deterministic dedup rule)", () => {
  it("merges mentions whose canonicalized name matches, tracking aliases and mention count", () => {
    const groups = groupMentionsByExactCanonical([
      { surfaceForm: "Acme Corp", type: "Organization" },
      { surfaceForm: "acme corp", type: "Organization" },
      { surfaceForm: "Acme Corp.", type: "Organization" },
    ]);
    // "Acme Corp" and "acme corp" canonicalize identically; "Acme Corp." is a
    // distinct surface form (different canonical string) so it's its own group.
    const acmeGroup = groups.find((g) => g.canonicalName === "acme corp");
    expect(acmeGroup?.mentionCount).toBe(2);
    expect(acmeGroup?.aliases).toContain("Acme Corp");
    expect(acmeGroup?.aliases).toContain("acme corp");
  });

  it("never merges the same name across different entity types", () => {
    const groups = groupMentionsByExactCanonical([
      { surfaceForm: "Amazon", type: "Organization" },
      { surfaceForm: "Amazon", type: "Product" },
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("throws on mismatched vector lengths", () => {
    expect(() => cosineSimilarity([1, 2], [1])).toThrow();
  });
});

describe("findMergeCandidates + applyAutoMerges (FR-KB-02 review band)", () => {
  const groups = [
    { canonicalName: "acme corp", type: "Organization", aliases: ["Acme Corp"], mentionCount: 3 },
    { canonicalName: "acme incorporated", type: "Organization", aliases: ["Acme Incorporated"], mentionCount: 1 },
    { canonicalName: "widget", type: "Product", aliases: ["Widget"], mentionCount: 2 },
  ];
  // Near-identical embeddings for the two "Acme" variants (high similarity), a
  // very different one for the unrelated Product.
  const embeddings = [
    [1, 0, 0],
    [0.98, 0.1, 0],
    [0, 1, 0],
  ];

  it("classifies a high-similarity same-type pair as auto-merge", () => {
    const { autoMerge, review } = findMergeCandidates(groups, embeddings, 0.93, 0.8);
    expect(autoMerge).toHaveLength(1);
    expect(autoMerge[0]).toMatchObject({ leftIndex: 0, rightIndex: 1 });
    expect(review).toHaveLength(0);
  });

  it("never suggests merging entities of different types regardless of embedding similarity", () => {
    const sameEmbeddingDifferentType = [
      [1, 0, 0],
      [1, 0, 0], // identical embedding, but Product vs the Organizations above
    ];
    const { autoMerge, review } = findMergeCandidates(
      [groups[2]!, { canonicalName: "widget2", type: "Product2", aliases: [], mentionCount: 1 }],
      sameEmbeddingDifferentType,
      0.93,
      0.8,
    );
    expect(autoMerge).toHaveLength(0);
    expect(review).toHaveLength(0);
  });

  it("a below-review-band pair produces no candidate at all", () => {
    const lowSimilarityEmbeddings = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const { autoMerge, review } = findMergeCandidates(groups, lowSimilarityEmbeddings, 0.93, 0.8);
    expect(autoMerge).toHaveLength(0);
    expect(review).toHaveLength(0);
  });

  it("applyAutoMerges collapses a merge pair into one group with combined mention count and aliases, and reports the index mapping", () => {
    const { autoMerge } = findMergeCandidates(groups, embeddings, 0.93, 0.8);
    const { mergedGroups, originalIndexToMergedIndex } = applyAutoMerges(groups, autoMerge);
    expect(mergedGroups).toHaveLength(2); // the two Acme groups collapsed into one; Widget stays separate
    const acme = mergedGroups.find((g) => g.aliases.includes("Acme Corp"));
    expect(acme?.mentionCount).toBe(4);
    expect(acme?.aliases).toEqual(expect.arrayContaining(["Acme Corp", "Acme Incorporated"]));
    // Both original Acme-variant indices (0 and 1) must map to the SAME merged index.
    expect(originalIndexToMergedIndex[0]).toBe(originalIndexToMergedIndex[1]);
    // The unrelated Product (index 2) must map to a DIFFERENT merged index.
    expect(originalIndexToMergedIndex[2]).not.toBe(originalIndexToMergedIndex[0]);
  });
});
