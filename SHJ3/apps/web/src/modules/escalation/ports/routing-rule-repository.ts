import type { RuleAttribute, RuleOperator, RuleTargetKind } from "../domain/routing-rule-engine.js";

export interface RoutingRuleRow {
  readonly id: string;
  readonly ordinal: number;
  readonly attribute: RuleAttribute;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly targetKind: RuleTargetKind;
  readonly targetTeamId: string | null;
  readonly alertSupervisor: boolean;
  readonly isEnabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewRoutingRuleInput {
  readonly attribute: RuleAttribute;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly targetKind: RuleTargetKind;
  readonly targetTeamId: string | null;
  readonly alertSupervisor: boolean;
  readonly staffUserId: string;
  readonly now: Date;
}

export interface UpdateRoutingRuleInput {
  readonly attribute: RuleAttribute;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly targetKind: RuleTargetKind;
  readonly targetTeamId: string | null;
  readonly alertSupervisor: boolean;
  readonly staffUserId: string;
  readonly now: Date;
}

/** Thrown by `reorder` when the caller's believed current order no longer matches the
 *  persisted one — this module's own stand-in for api.md §6.8's `If-Match`/`ETag`
 *  mechanism (there is no HTTP layer here to carry a header through; a Server Action
 *  compares the full ordered id list it was shown against the list actually persisted,
 *  which is the same optimistic-concurrency guarantee by a different transport). */
export class RoutingRuleOrderConflictError extends Error {
  readonly code = "routing_rule.order_conflict";
  constructor(readonly currentOrder: readonly string[]) {
    super("The routing-rule order has changed since it was last read.");
    this.name = "RoutingRuleOrderConflictError";
  }
}

export interface RoutingRuleRepository {
  /** Ordinal ascending — precedence order, always. */
  list(): Promise<readonly RoutingRuleRow[]>;
  findById(id: string): Promise<RoutingRuleRow | null>;
  /** `MAX(ordinal) + 1`, or `1` for the first rule — new rules are always appended last
   *  (api.md §6.8: "adding a rule never silently changes existing routing"). */
  nextOrdinal(): Promise<number>;
  create(input: NewRoutingRuleInput): Promise<RoutingRuleRow>;
  update(id: string, input: UpdateRoutingRuleInput): Promise<RoutingRuleRow>;
  delete(id: string): Promise<void>;
  setEnabled(id: string, isEnabled: boolean, now: Date): Promise<void>;

  /**
   * Replace the full ordinal assignment for every currently-existing rule id in
   * `orderedIds` (first element -> ordinal 1, and so on). `expectedCurrentOrder` is the
   * complete ordered id list the caller believes is still current; a mismatch throws
   * `RoutingRuleOrderConflictError` with the real current order, and nothing is
   * written.
   */
  reorder(orderedIds: readonly string[], expectedCurrentOrder: readonly string[]): Promise<void>;
}
