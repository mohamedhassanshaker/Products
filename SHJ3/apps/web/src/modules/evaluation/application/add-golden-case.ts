/** B13 tab 1's "Edit cases" manual add — as opposed to `AddCaseFromTranscript`, which is
 *  the transcript-sourced path from B1. No `sourceConversationId` here, so
 *  `UQ_GoldenCases_sourceConversation` never applies to a manually-authored case. */

import type { GoldenCaseRepository, GoldenCaseRow } from "../ports/golden-set-repository.js";

export interface AddGoldenCaseInput {
  readonly goldenSetId: string;
  readonly prompt: string;
  readonly expectedBehaviour: string;
  readonly expectedToolCallsJson: string | null;
  readonly mustRefuse: boolean;
  readonly localeCode: string;
  readonly addedByStaffUserId: string;
  readonly now: Date;
}

export class AddGoldenCase {
  constructor(private readonly deps: { readonly cases: GoldenCaseRepository }) {}

  async execute(input: AddGoldenCaseInput): Promise<GoldenCaseRow> {
    // `CK_GoldenCases_refusalHasNoTools` — checked here too, defence in depth: a
    // must-refuse case never carries expected tool calls.
    const expectedToolCallsJson = input.mustRefuse ? null : input.expectedToolCallsJson;
    return this.deps.cases.add({
      goldenSetId: input.goldenSetId,
      prompt: input.prompt,
      expectedBehaviour: input.expectedBehaviour,
      expectedToolCallsJson,
      expectedCitationSourceIdsJson: null,
      mustRefuse: input.mustRefuse,
      localeCode: input.localeCode,
      sourceConversationId: null,
      addedByStaffUserId: input.addedByStaffUserId,
      now: input.now,
    });
  }
}
