/**
 * `GoldenSets` + `GoldenCases` — combined in one file, following `escalation`'s own
 * precedent of combining tightly-coupled concerns (`ports/handover-routing-config-
 * repository.ts` sits alongside `ports/routing-rule-repository.ts` for the same reason):
 * a case belongs to exactly one set, `TR_GoldenCases_recount` maintains the parent's
 * `caseCount` as a DB side effect no caller ever computes itself, and every real screen
 * (B13 tab 1) reads both together.
 */

import type { GoldenSetKind } from "../domain/vocabulary.js";

export interface GoldenSetRow {
  readonly id: string;
  readonly name: string;
  readonly ownerTenantId: string;
  readonly description: string | null;
  readonly kind: GoldenSetKind;
  /** Required when `kind === "LanguageParity"` (`CK_GoldenSets_parityHasLocale`). */
  readonly localeCode: string | null;
  /** Trigger-maintained (`TR_GoldenCases_recount`) — never write this field yourself. */
  readonly caseCount: number;
  readonly lastScore: number | null;
  readonly lastRunAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GoldenCaseRow {
  readonly id: string;
  readonly goldenSetId: string;
  readonly ordinal: number;
  readonly prompt: string;
  readonly expectedBehaviour: string;
  /** JSON array of tool-binding-id strings, in expected call order — this module's own
   *  documented shape (nothing else in the codebase defines one; see
   *  `application/run-golden-set-now.ts`'s own doc comment on tool-accuracy scoring). */
  readonly expectedToolCallsJson: string | null;
  readonly expectedCitationSourceIdsJson: string | null;
  readonly mustRefuse: boolean;
  readonly localeCode: string;
  readonly sourceConversationId: string | null;
  readonly addedByStaffUserId: string;
  readonly addedAt: Date;
  readonly isEnabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewGoldenSetInput {
  readonly name: string;
  readonly ownerTenantId: string;
  readonly description: string | null;
  readonly kind: GoldenSetKind;
  readonly localeCode: string | null;
  readonly now: Date;
}

export interface NewGoldenCaseInput {
  readonly goldenSetId: string;
  readonly prompt: string;
  readonly expectedBehaviour: string;
  readonly expectedToolCallsJson: string | null;
  readonly expectedCitationSourceIdsJson: string | null;
  readonly mustRefuse: boolean;
  readonly localeCode: string;
  readonly sourceConversationId: string | null;
  readonly addedByStaffUserId: string;
  readonly now: Date;
}

export interface UpdateGoldenCaseInput {
  readonly prompt?: string;
  readonly expectedBehaviour?: string;
  readonly expectedToolCallsJson?: string | null;
  readonly expectedCitationSourceIdsJson?: string | null;
  readonly mustRefuse?: boolean;
  readonly localeCode?: string;
  readonly isEnabled?: boolean;
  readonly now: Date;
}

export interface GoldenSetRepository {
  list(): Promise<readonly GoldenSetRow[]>;
  findById(goldenSetId: string): Promise<GoldenSetRow | null>;
  create(input: NewGoldenSetInput): Promise<GoldenSetRow>;
  /** `lastScore`/`lastRunAt` only — plain columns this module owns (unlike `caseCount`). */
  updateScore(goldenSetId: string, score: number | null, at: Date): Promise<void>;
}

export interface GoldenCaseRepository {
  /** Enabled, non-deleted cases, ordered by `ordinal` — a scoring run's own case list. */
  listForSet(goldenSetId: string): Promise<readonly GoldenCaseRow[]>;
  findById(goldenCaseId: string): Promise<GoldenCaseRow | null>;
  nextOrdinal(goldenSetId: string): Promise<number>;

  /**
   * Inserts one case. Real DB constraints this can violate, surfaced to the caller as a
   * raw Prisma error (never swallowed here — `application/add-case-from-transcript.ts`
   * is the one place a `P2002` on `UQ_GoldenCases_sourceConversation` gets translated to
   * `evaluation.case_already_added`, matching this codebase's established "the use case
   * translates the constraint, the adapter does not" convention for this exact class of
   * error, e.g. `RoutingRuleRepository.reorder`'s own doc comment)."
   */
  add(input: NewGoldenCaseInput): Promise<GoldenCaseRow>;
  update(goldenCaseId: string, patch: UpdateGoldenCaseInput): Promise<GoldenCaseRow>;
  /** Soft delete (`deletedAt`) — `TR_GoldenCases_recount` fires on this too, so
   *  `GoldenSet.caseCount` drops in the same statement. */
  remove(goldenCaseId: string, now: Date): Promise<void>;
}
