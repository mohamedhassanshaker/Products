/**
 * The one genuinely cross-feature call this module makes: `evaluation`'s
 * `AddCaseFromTranscript` use case (`modules/evaluation/application/
 * add-case-from-transcript.ts`). `analytics` and `evaluation` are both listed in
 * `eslint.config.mjs`'s `FEATURE_MODULES`, so `boundaries/element-types` forbids
 * `modules/analytics/**` importing anything from `modules/evaluation/**` directly — "A
 * feature may use... itself — but NOT a sibling feature. Cross-feature work goes through
 * a published port or a domain event."
 *
 * So this port is that published port: `application/add-conversation-to-golden-set.ts`
 * depends on `GoldenCasePort` only. The concrete implementation — a thin adapter that
 * calls the real `AddCaseFromTranscript` — is wired up in the **composition root**
 * (`app/[locale]/(backoffice)/command-centre/composition.ts`), which is allowed to import
 * both feature modules because route/composition code is the "app" boundary type, not a
 * "feature" one. This is the same shape the lint rule's own doc comment describes, not a
 * workaround of it.
 *
 * The shape below mirrors `AddCaseFromTranscript.execute`'s real input/output exactly —
 * copied from the module's own file at integration time, not re-derived — so the
 * composition-root adapter is a pure pass-through with no translation logic of its own.
 */

export interface AddGoldenCaseFromTranscriptInput {
  readonly goldenSetId: string;
  readonly sourceConversationId: string;
  readonly prompt: string;
  readonly expectedBehaviour: string;
  readonly mustRefuse: boolean;
  readonly localeCode: string;
  readonly addedByStaffUserId: string;
  readonly now: Date;
}

export type AddGoldenCaseFromTranscriptResult =
  | { readonly ok: true; readonly value: { readonly caseId: string; readonly caseCount: number } }
  | {
      readonly ok: false;
      readonly error: "evaluation.golden_set_not_found" | "evaluation.case_already_added";
    };

export interface GoldenCasePort {
  addFromTranscript(
    input: AddGoldenCaseFromTranscriptInput,
  ): Promise<AddGoldenCaseFromTranscriptResult>;
}
