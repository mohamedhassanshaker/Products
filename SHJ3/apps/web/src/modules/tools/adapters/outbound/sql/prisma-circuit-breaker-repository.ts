/** The real `CircuitBreakerRepository` — `CircuitBreakerConfigs`/`CircuitBreakerEvents`, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isBreakerEventReason,
  isBreakerTransition,
  isCircuitBreakerTargetKind,
  isFallbackStrategy,
  type BreakerEventReason,
  type BreakerTransition,
  type FallbackStrategy,
} from "../../../domain/circuit-breaker.js";
import type {
  CircuitBreakerConfigRow,
  CircuitBreakerEventRow,
  CircuitBreakerRepository,
} from "../../../ports/circuit-breaker-repository.js";

const OPERATION = "tools circuit breaker repository";

function toConfigRow(row: {
  id: string;
  targetKind: string;
  targetId: string | null;
  targetKey: string | null;
  failureThreshold: number;
  windowSeconds: number;
  cooldownSeconds: number;
  halfOpenProbes: number;
  fallbackStrategy: string;
  cachedAnswerMaxAgeSeconds: number | null;
  serveCachedWhenDown: boolean;
  degradedModeMessage: string;
  isEnabled: boolean;
}): CircuitBreakerConfigRow {
  if (!isCircuitBreakerTargetKind(row.targetKind) || !isFallbackStrategy(row.fallbackStrategy)) {
    throw new Error(
      `CircuitBreakerConfig ${row.id} has an unrecognized targetKind/fallbackStrategy.`,
    );
  }
  return { ...row, targetKind: row.targetKind, fallbackStrategy: row.fallbackStrategy };
}

function toEventRow(row: {
  id: string;
  circuitBreakerConfigId: string;
  transition: string;
  reason: string;
  failureCount: number | null;
  actorStaffUserId: string | null;
  occurredAt: Date;
}): CircuitBreakerEventRow {
  if (!isBreakerTransition(row.transition) || !isBreakerEventReason(row.reason)) {
    throw new Error(`CircuitBreakerEvent ${row.id} has an unrecognized transition/reason.`);
  }
  return { ...row, transition: row.transition, reason: row.reason };
}

export class PrismaCircuitBreakerRepository implements CircuitBreakerRepository {
  async list(): Promise<readonly CircuitBreakerConfigRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.circuitBreakerConfig.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toConfigRow);
  }

  async get(id: string): Promise<CircuitBreakerConfigRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.circuitBreakerConfig.findUnique({ where: { id } });
    return row ? toConfigRow(row) : null;
  }

  async update(
    id: string,
    input: {
      readonly failureThreshold?: number;
      readonly windowSeconds?: number;
      readonly cooldownSeconds?: number;
      readonly fallbackStrategy?: FallbackStrategy;
      readonly cachedAnswerMaxAgeSeconds?: number | null;
      readonly serveCachedWhenDown?: boolean;
      readonly degradedModeMessage?: string;
      readonly isEnabled?: boolean;
    },
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.circuitBreakerConfig.update({
      where: { id },
      data: {
        ...(input.failureThreshold !== undefined
          ? { failureThreshold: input.failureThreshold }
          : {}),
        ...(input.windowSeconds !== undefined ? { windowSeconds: input.windowSeconds } : {}),
        ...(input.cooldownSeconds !== undefined ? { cooldownSeconds: input.cooldownSeconds } : {}),
        ...(input.fallbackStrategy !== undefined
          ? { fallbackStrategy: input.fallbackStrategy }
          : {}),
        ...(input.cachedAnswerMaxAgeSeconds !== undefined
          ? { cachedAnswerMaxAgeSeconds: input.cachedAnswerMaxAgeSeconds }
          : {}),
        ...(input.serveCachedWhenDown !== undefined
          ? { serveCachedWhenDown: input.serveCachedWhenDown }
          : {}),
        ...(input.degradedModeMessage !== undefined
          ? { degradedModeMessage: input.degradedModeMessage }
          : {}),
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
        updatedAt: now,
      },
    });
  }

  async appendEvent(input: {
    readonly circuitBreakerConfigId: string;
    readonly transition: BreakerTransition;
    readonly reason: BreakerEventReason;
    readonly failureCount: number | null;
    readonly actorStaffUserId: string | null;
    readonly now: Date;
  }): Promise<CircuitBreakerEventRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.circuitBreakerEvent.create({
      data: {
        id: newUlid(input.now),
        circuitBreakerConfigId: input.circuitBreakerConfigId,
        transition: input.transition,
        reason: input.reason,
        failureCount: input.failureCount,
        actorStaffUserId: input.actorStaffUserId,
        occurredAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toEventRow(row);
  }

  async listRecentEvents(
    circuitBreakerConfigId: string,
    limit: number,
  ): Promise<readonly CircuitBreakerEventRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.circuitBreakerEvent.findMany({
      where: { circuitBreakerConfigId },
      orderBy: { occurredAt: "desc" },
      take: limit,
    });
    return rows.map(toEventRow);
  }
}
