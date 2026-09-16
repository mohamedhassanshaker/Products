import { describe, expect, it } from "vitest";
import { MergeDuplicate } from "./merge-duplicate.js";
import { IgnoreDuplicate } from "./ignore-duplicate.js";
import {
  FakeGraphRepository,
  FakeKnowledgeAiClient,
  graphNodeRecordRowFixture,
} from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

function seedPair(graph: FakeGraphRepository) {
  const left = graphNodeRecordRowFixture({
    id: "left_1",
    canonicalKey: "sewa",
    canonicalName: "SEWA",
  });
  const right = graphNodeRecordRowFixture({
    id: "right_1",
    canonicalKey: "sharjah-electricity-water-authority",
    canonicalName: "Sharjah Electricity & Water Authority",
  });
  graph.seedNode(left);
  graph.seedNode(right);
  return graph.upsertDuplicateCandidate({
    leftNodeRecordId: left.id,
    rightNodeRecordId: right.id,
    similarity: 0.9,
    detectionMethod: "AliasOverlap",
    now: NOW,
  });
}

describe("merging a duplicate candidate", () => {
  it("records a Merge decision, marks the candidate Merged, and redirects the absorbed node", async () => {
    const graph = new FakeGraphRepository();
    const candidate = await seedPair(graph);
    const ai = new FakeKnowledgeAiClient();

    const result = await new MergeDuplicate({ graph, ai }).execute({
      candidateId: candidate.id,
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect((await graph.getDuplicateCandidate(candidate.id))?.state).toBe("Merged");
    expect(graph.mergeDecisions[0]?.decision).toBe("Merge");
    const absorbed = await graph.getNode(candidate.rightNodeRecordId);
    expect(absorbed?.mergedIntoNodeRecordId).toBe(candidate.leftNodeRecordId);
  });

  it("refuses to merge a candidate that is not Open", async () => {
    const graph = new FakeGraphRepository();
    const candidate = await seedPair(graph);
    const ai = new FakeKnowledgeAiClient();
    await graph.setDuplicateCandidateState(candidate.id, "Ignored", NOW);

    const result = await new MergeDuplicate({ graph, ai }).execute({
      candidateId: candidate.id,
      actorStaffUserId: "usr_admin",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "knowledge.candidate_not_open" });
  });
});

describe("ignoring a duplicate candidate", () => {
  it("records an Ignore decision and suppresses the candidate", async () => {
    const graph = new FakeGraphRepository();
    const candidate = await seedPair(graph);
    const ai = new FakeKnowledgeAiClient();

    const result = await new IgnoreDuplicate({ graph, ai }).execute({
      candidateId: candidate.id,
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect((await graph.getDuplicateCandidate(candidate.id))?.state).toBe("Ignored");
    expect(graph.mergeDecisions[0]).toMatchObject({
      decision: "Ignore",
      survivingNodeRecordId: null,
    });
  });
});
