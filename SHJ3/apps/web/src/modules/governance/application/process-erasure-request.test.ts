import { describe, expect, it } from "vitest";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import {
  FakeAuditSink,
  FakeCitizenCacheEraser,
  FakeCitizenDataEraser,
  FakeErasureRequestRepository,
  FakeGraphVectorErasureVerifier,
} from "../testing/fakes.js";
import {
  ErasureRequestHasNoLinkedCitizenError,
  ProcessErasureRequest,
} from "./process-erasure-request.js";

const now = new Date("2026-09-10T10:00:00.000Z");
const actor = {
  id: "staff_1",
  tenant: "sewa",
  displayName: "Ahmed Saeed",
  roles: ["SuperAdmin"],
  permissions: new Set(["governance:manage"]),
  assurance: "L0",
} as unknown as Principal;

describe("ProcessErasureRequest", () => {
  it("records all four store tasks and completes once all four are verified", async () => {
    const erasureRequests = new FakeErasureRequestRepository();
    const request = await erasureRequests.create({
      subjectKind: "CitizenIdentity",
      subjectHash: "hash",
      citizenIdentityId: "citizen_1",
      receivedVia: "backoffice",
      now,
    });

    const sqlEraser = new FakeCitizenDataEraser();
    sqlEraser.result = {
      affectedCount: 4,
      verificationQuery: "fake sql",
      transactionsSkipped: 2,
      purgedConversationIds: ["conv_1"],
    };
    const cacheEraser = new FakeCitizenCacheEraser();
    cacheEraser.result = { affectedCount: 2, verificationQuery: "fake redis" };
    const graphVectorVerifier = new FakeGraphVectorErasureVerifier();
    const audit = new FakeAuditSink();

    const result = await new ProcessErasureRequest({
      erasureRequests,
      sqlEraser,
      cacheEraser,
      graphVectorVerifier,
      audit,
    }).execute({ erasureRequestId: request.id, actor, now });

    expect(result.completed).toBe(true);
    expect(result.tasks).toHaveLength(4);
    expect(result.tasks.map((task) => task.store).sort()).toEqual([
      "Neo4j",
      "Qdrant",
      "Redis",
      "SqlServer",
    ]);
    const updated = await erasureRequests.findById(request.id);
    expect(updated?.status).toBe("Completed");
    expect(audit.recorded.at(-1)?.action).toBe("governance.erasure_request_completed");
  });

  it("refuses to process a request with no linked citizen identity", async () => {
    const erasureRequests = new FakeErasureRequestRepository();
    const request = await erasureRequests.create({
      subjectKind: "ContactHash",
      subjectHash: "hash",
      citizenIdentityId: null,
      receivedVia: "backoffice",
      now,
    });

    await expect(
      new ProcessErasureRequest({
        erasureRequests,
        sqlEraser: new FakeCitizenDataEraser(),
        cacheEraser: new FakeCitizenCacheEraser(),
        graphVectorVerifier: new FakeGraphVectorErasureVerifier(),
        audit: new FakeAuditSink(),
      }).execute({ erasureRequestId: request.id, actor, now }),
    ).rejects.toThrow(ErasureRequestHasNoLinkedCitizenError);
  });
});
