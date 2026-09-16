/**
 * B1's **Add to golden set** button (FR-EVAL-03/FR-EVAL-14, §6 "Click 'Add to golden set'
 * on a transcript -> Billing core journeys case count increments -> B1 -> B13"). A named
 * cross-module contract: the command-centre module (a parallel B-9 agent) calls this
 * exact class with this exact input/output shape — do not rename either without checking
 * that module first.
 */

import type { GoldenCaseRepository, GoldenSetRepository } from "../ports/golden-set-repository.js";

export interface AddCaseFromTranscriptInput {
  readonly goldenSetId: string;
  readonly sourceConversationId: string;
  readonly prompt: string;
  readonly expectedBehaviour: string;
  readonly mustRefuse: boolean;
  readonly localeCode: string;
  readonly addedByStaffUserId: string;
  readonly now: Date;
}

export type AddCaseFromTranscriptResult =
  | { readonly ok: true; readonly value: { readonly caseId: string; readonly caseCount: number } }
  | {
      readonly ok: false;
      readonly error: "evaluation.golden_set_not_found" | "evaluation.case_already_added";
    };

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

export class AddCaseFromTranscript {
  constructor(
    private readonly deps: {
      readonly cases: GoldenCaseRepository;
      readonly sets: GoldenSetRepository;
    },
  ) {}

  async execute(input: AddCaseFromTranscriptInput): Promise<AddCaseFromTranscriptResult> {
    const set = await this.deps.sets.findById(input.goldenSetId);
    if (!set) return { ok: false, error: "evaluation.golden_set_not_found" };

    try {
      await this.deps.cases.add({
        goldenSetId: input.goldenSetId,
        prompt: input.prompt,
        expectedBehaviour: input.expectedBehaviour,
        // `CK_GoldenCases_refusalHasNoTools`: a must-refuse case names no expected tool
        // calls — a transcript-sourced case never has one to record anyway (B1's own
        // "Add to golden set" flow supplies only a prompt/expected-behaviour pair).
        expectedToolCallsJson: null,
        expectedCitationSourceIdsJson: null,
        mustRefuse: input.mustRefuse,
        localeCode: input.localeCode,
        sourceConversationId: input.sourceConversationId,
        addedByStaffUserId: input.addedByStaffUserId,
        now: input.now,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return { ok: false, error: "evaluation.case_already_added" };
      }
      throw error;
    }

    // Read back the real, trigger-maintained `caseCount` (`TR_GoldenCases_recount`) —
    // never computed here.
    const refreshed = await this.deps.sets.findById(input.goldenSetId);
    const caseId = (await this.deps.cases.listForSet(input.goldenSetId)).find(
      (c) => c.sourceConversationId === input.sourceConversationId,
    )?.id;
    if (!refreshed || !caseId) {
      throw new Error(
        `AddCaseFromTranscript: the case/set just written for golden set "${input.goldenSetId}" ` +
          "could not be read back — this should be impossible immediately after a successful insert.",
      );
    }
    return { ok: true, value: { caseId, caseCount: refreshed.caseCount } };
  }
}
