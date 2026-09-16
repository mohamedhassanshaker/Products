import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  RuleAttribute,
  RuleOperator,
  RuleTargetKind,
} from "../../../domain/routing-rule-engine.js";
import {
  RoutingRuleOrderConflictError,
  type NewRoutingRuleInput,
  type RoutingRuleRepository,
  type RoutingRuleRow,
  type UpdateRoutingRuleInput,
} from "../../../ports/routing-rule-repository.js";

/**
 * `CK_RoutingRules_ordinalPositive CHECK (ordinal > 0)` (read directly from
 * `prisma/sql/001_constraints.sql`, not assumed) rules out the schema doc comment's own
 * literal "park at ordinal = -1" as something an individual `UPDATE` statement could
 * ever hold even transiently — SQL Server validates a `CHECK` constraint at the end of
 * *each* statement, not deferred to `COMMIT`, so a negative value would fail the very
 * statement that tried to set it. The reorder below instead uses the standard
 * disjoint-offset technique for reassigning a live `UNIQUE` sequence without deferred
 * constraints: every affected rule first moves to `OFFSET + finalPosition` (always
 * positive, and guaranteed not to collide with any rule's *current* ordinal, since real
 * ordinals never approach `OFFSET`), then a second pass subtracts `OFFSET` back down to
 * the real `1..N` value. Both passes run as one Prisma `$transaction` array — one SQL
 * transaction, fully atomic — so a crash mid-reorder rolls back to the original order
 * rather than leaving any rule at an offset value.
 */
const REORDER_OFFSET = 1_000_000;

function toRow(row: {
  id: string;
  ordinal: number;
  attribute: string;
  operator: string;
  value: string;
  targetKind: string;
  targetTeamId: string | null;
  alertSupervisor: boolean;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): RoutingRuleRow {
  return {
    id: row.id,
    ordinal: row.ordinal,
    attribute: row.attribute as RuleAttribute,
    operator: row.operator as RuleOperator,
    value: row.value,
    targetKind: row.targetKind as RuleTargetKind,
    targetTeamId: row.targetTeamId,
    alertSupervisor: row.alertSupervisor,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaRoutingRuleRepository implements RoutingRuleRepository {
  async list(): Promise<readonly RoutingRuleRow[]> {
    const rows = await getTenantDb("routing rules list").routingRule.findMany({
      orderBy: { ordinal: "asc" },
    });
    return rows.map(toRow);
  }

  async findById(id: string): Promise<RoutingRuleRow | null> {
    const row = await getTenantDb("routing rule read").routingRule.findUnique({ where: { id } });
    return row ? toRow(row) : null;
  }

  async nextOrdinal(): Promise<number> {
    const top = await getTenantDb("routing rule next ordinal").routingRule.findFirst({
      orderBy: { ordinal: "desc" },
      select: { ordinal: true },
    });
    return (top?.ordinal ?? 0) + 1;
  }

  async create(input: NewRoutingRuleInput): Promise<RoutingRuleRow> {
    const ordinal = await this.nextOrdinal();
    const row = await getTenantDb("routing rule create").routingRule.create({
      data: {
        id: newUlid(input.now),
        ordinal,
        attribute: input.attribute,
        operator: input.operator,
        value: input.value,
        targetKind: input.targetKind,
        targetTeamId: input.targetTeamId,
        alertSupervisor: input.alertSupervisor,
        isEnabled: true,
        createdByStaffUserId: input.staffUserId,
        updatedByStaffUserId: input.staffUserId,
        createdAt: input.now,
      },
    });
    return toRow(row);
  }

  async update(id: string, input: UpdateRoutingRuleInput): Promise<RoutingRuleRow> {
    const row = await getTenantDb("routing rule update").routingRule.update({
      where: { id },
      data: {
        attribute: input.attribute,
        operator: input.operator,
        value: input.value,
        targetKind: input.targetKind,
        targetTeamId: input.targetTeamId,
        alertSupervisor: input.alertSupervisor,
        updatedByStaffUserId: input.staffUserId,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }

  async delete(id: string): Promise<void> {
    // Hard-deleted (§1.4 — "a soft-deleted rule that still occupied an ordinal would
    // silently change routing precedence"). Deliberately leaves a gap in the ordinal
    // sequence rather than compacting it: compaction would itself be a silent
    // precedence change for every rule after the deleted one, which is exactly what
    // this module's own reorder path exists to make an explicit, admin-driven action.
    await getTenantDb("routing rule delete").routingRule.delete({ where: { id } });
  }

  async setEnabled(id: string, isEnabled: boolean, now: Date): Promise<void> {
    await getTenantDb("routing rule set enabled").routingRule.update({
      where: { id },
      data: { isEnabled, updatedAt: now },
    });
  }

  async reorder(
    orderedIds: readonly string[],
    expectedCurrentOrder: readonly string[],
  ): Promise<void> {
    const db = getTenantDb("routing rule reorder");
    const current = await db.routingRule.findMany({
      orderBy: { ordinal: "asc" },
      select: { id: true },
    });
    const currentOrder = current.map((row) => row.id);

    const matchesExpected =
      currentOrder.length === expectedCurrentOrder.length &&
      currentOrder.every((id, index) => id === expectedCurrentOrder[index]);
    if (!matchesExpected) throw new RoutingRuleOrderConflictError(currentOrder);

    const matchesTarget =
      currentOrder.length === orderedIds.length &&
      [...currentOrder].sort().every((id, index) => id === [...orderedIds].sort()[index]);
    if (!matchesTarget) {
      throw new Error(
        "reorder() received an id list that does not name exactly the current rule set.",
      );
    }

    await db.$transaction([
      ...orderedIds.map((id, index) =>
        db.routingRule.update({ where: { id }, data: { ordinal: REORDER_OFFSET + index + 1 } }),
      ),
      ...orderedIds.map((id, index) =>
        db.routingRule.update({ where: { id }, data: { ordinal: index + 1 } }),
      ),
    ]);
  }
}
