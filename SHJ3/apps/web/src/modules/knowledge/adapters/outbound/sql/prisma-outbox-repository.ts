/**
 * The real `OutboxRepository` — `OutboxEvents`, per-tenant.
 *
 * **A real, documented simplification of §9.2 step 3's claim query.** The design doc
 * describes `UPDATE TOP (n) ... WITH (READPAST, UPDLOCK, ROWLOCK) ... OUTPUT inserted.*` —
 * a row-locking hint pattern meant to let several concurrent `shj3-worker` replicas claim
 * disjoint batches safely. No such worker fleet exists in this repository yet (this wave's
 * own scope note: `scripts/process-knowledge-outbox.ts` is a single polling loop standing
 * in for that deployment, not a multi-replica one), and outbox processing is also invoked
 * synchronously, inline, from a Server Action — never from two processes at once in this
 * wave's real topology. `claimBatch` below is therefore a plain SELECT-then-`updateMany`,
 * which is race-prone only if two claimers run concurrently against the same tenant. If a
 * real multi-replica `shj3-worker` is introduced later, this method must move to a real
 * `OUTPUT`-based single-statement claim — flagged here rather than left silently assumed.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isOutboxAggregateKind,
  isOutboxState,
  isOutboxTargetStore,
} from "../../../domain/knowledge-catalog.js";
import type {
  NewOutboxEventInput,
  OutboxEventRow,
  OutboxRepository,
} from "../../../ports/outbox-repository.js";

const OPERATION = "knowledge outbox repository";

function toEventRow(row: {
  id: string;
  aggregateKind: string;
  aggregateId: string;
  eventType: string;
  targetStore: string;
  payloadJson: string;
  dedupeKey: string;
  state: string;
  attemptCount: number;
  maxAttempts: number;
  availableAt: Date;
}): OutboxEventRow {
  if (
    !isOutboxAggregateKind(row.aggregateKind) ||
    !isOutboxTargetStore(row.targetStore) ||
    !isOutboxState(row.state)
  ) {
    throw new Error(`OutboxEvent ${row.id} has an unrecognized aggregateKind/targetStore/state.`);
  }
  return {
    id: row.id,
    aggregateKind: row.aggregateKind,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    targetStore: row.targetStore,
    payloadJson: row.payloadJson,
    dedupeKey: row.dedupeKey,
    state: row.state,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt,
  };
}

export class PrismaOutboxRepository implements OutboxRepository {
  async enqueue(input: NewOutboxEventInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    const existing = await db.outboxEvent.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) return; // Already queued — re-enqueuing is a safe no-op by design.

    await db.outboxEvent.create({
      data: {
        id: newUlid(input.now),
        aggregateKind: input.aggregateKind,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        targetStore: input.targetStore,
        payloadJson: input.payloadJson,
        dedupeKey: input.dedupeKey,
        state: "Pending",
        attemptCount: 0,
        maxAttempts: 8,
        availableAt: input.now,
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
        appliedAt: null,
        occurredAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
  }

  async claimBatch(limit: number, workerId: string, now: Date): Promise<readonly OutboxEventRow[]> {
    const db = getTenantDb(OPERATION);
    const candidates = await db.outboxEvent.findMany({
      where: { state: { in: ["Pending", "Failed"] }, availableAt: { lte: now } },
      orderBy: [{ availableAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    if (candidates.length === 0) return [];

    const ids = candidates.map((row) => row.id);
    const lockedUntil = new Date(now.getTime() + 5 * 60 * 1000);
    await db.outboxEvent.updateMany({
      where: { id: { in: ids } },
      data: {
        state: "InFlight",
        lockedBy: workerId,
        lockedUntil,
        attemptCount: { increment: 1 },
        updatedAt: now,
      },
    });

    const claimed = await db.outboxEvent.findMany({ where: { id: { in: ids } } });
    return claimed.map(toEventRow);
  }

  async markApplied(id: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.outboxEvent.update({
      where: { id },
      data: { state: "Applied", appliedAt: now, lockedBy: null, lockedUntil: null, updatedAt: now },
    });
  }

  async markFailed(input: {
    readonly id: string;
    readonly error: string;
    readonly nextAvailableAt: Date;
    readonly becameDead: boolean;
  }): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.outboxEvent.update({
      where: { id: input.id },
      data: {
        state: input.becameDead ? "Dead" : "Failed",
        lastError: input.error,
        availableAt: input.nextAvailableAt,
        lockedBy: null,
        lockedUntil: null,
        updatedAt: input.nextAvailableAt,
      },
    });
  }

  async requeueDead(ids: readonly string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    const db = getTenantDb(OPERATION);
    await db.outboxEvent.updateMany({
      where: { id: { in: [...ids] }, state: "Dead" },
      data: {
        state: "Pending",
        attemptCount: 0,
        availableAt: now,
        lastError: null,
        updatedAt: now,
      },
    });
  }

  async listDeadForAggregate(
    aggregateKind: string,
    aggregateId: string,
  ): Promise<readonly OutboxEventRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.outboxEvent.findMany({
      where: { aggregateKind, aggregateId, state: "Dead" },
    });
    return rows.map(toEventRow);
  }
}
