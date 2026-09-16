import type { ConversationExplorerRepository } from "../ports/conversation-explorer-repository.js";
import type {
  AddGoldenCaseFromTranscriptResult,
  GoldenCasePort,
} from "../ports/golden-case-port.js";

export class ConversationHasNoSeedError extends Error {
  readonly code = "analytics.conversation_has_no_seed";
  constructor() {
    super(
      "This conversation has no citizen turn / assistant answer pair to seed a golden case from.",
    );
    this.name = "ConversationHasNoSeedError";
  }
}

export interface AddConversationToGoldenSetInput {
  readonly conversationId: string;
  readonly goldenSetId: string;
  readonly mustRefuse: boolean;
  /** Staff-typed override for the case's `expectedBehaviour`. When omitted (or blank),
   *  defaults to a copy of the conversation's own actual response text — see this class's
   *  own doc comment for why. */
  readonly expectedBehaviourOverride?: string;
  readonly staffUserId: string;
  readonly now: Date;
}

/**
 * B1 tab 2's **Add to golden set** button.
 *
 * **The prompt/expectedBehaviour mapping, named plainly.** A real past transcript does
 * not carry an "expected" response — it carries what the assistant *actually* said,
 * which is precisely the thing being flagged (good or bad) by whoever clicks this
 * button. So:
 *  - `prompt` = the citizen's own first turn in the conversation (`ConversationExplorer
 *    Repository.findGoldenCaseSeed`'s `promptText`) — the real question that opened the
 *    interaction being flagged, not a paraphrase.
 *  - `expectedBehaviour` = the staff member's own typed description of what the
 *    assistant *should* do, when they provide one (`expectedBehaviourOverride`);
 *    otherwise it **defaults to a copy of the assistant's actual past response**
 *    (`actualResponseText`), on the reasoning that a transcript worth adding to a golden
 *    set is usually one the staff member judged to be a *good* answer worth locking in
 *    as a regression case, and typing a full replacement by hand for every add would be
 *    friction for the common case. A staff member flagging a *bad* answer edits this
 *    field before saving, which the UI's own text area makes a one-line change, not a
 *    from-scratch write-up.
 *
 * The real cross-module call — `evaluation`'s `AddCaseFromTranscript` — is reached only
 * through `GoldenCasePort` (never a direct import of the sibling `evaluation` feature
 * module; see that port's own doc comment for the `eslint.config.mjs` boundary rule this
 * is working within). `evaluation.case_already_added` is returned to the caller
 * unchanged — the composition-root/UI layer is what turns it into the wireframe's
 * "disable the button with confirmation text" behaviour, since that is real cross-module
 * data (`UQ_GoldenCases_sourceConversation`), not something this use case fabricates.
 */
export class AddConversationToGoldenSet {
  constructor(
    private readonly deps: {
      readonly explorer: ConversationExplorerRepository;
      readonly goldenCases: GoldenCasePort;
    },
  ) {}

  async execute(
    input: AddConversationToGoldenSetInput,
  ): Promise<AddGoldenCaseFromTranscriptResult> {
    const seed = await this.deps.explorer.findGoldenCaseSeed(input.conversationId);
    if (!seed) throw new ConversationHasNoSeedError();

    const expectedBehaviour = input.expectedBehaviourOverride?.trim() || seed.actualResponseText;

    return this.deps.goldenCases.addFromTranscript({
      goldenSetId: input.goldenSetId,
      sourceConversationId: input.conversationId,
      prompt: seed.promptText,
      expectedBehaviour,
      mustRefuse: input.mustRefuse,
      localeCode: seed.localeCode,
      addedByStaffUserId: input.staffUserId,
      now: input.now,
    });
  }
}
