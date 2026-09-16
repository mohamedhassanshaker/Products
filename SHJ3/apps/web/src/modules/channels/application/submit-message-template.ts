import { placeholderCountMatchesVariables } from "../domain/template-placeholders.js";
import type { ChannelsReason } from "../domain/errors.js";
import type {
  MessageTemplateRepository,
  MessageTemplateRow,
} from "../ports/message-template-repository.js";

export interface SubmitMessageTemplateInput {
  readonly name: string;
  readonly channelKey: string;
  readonly category: string;
  readonly bodySample: string;
  readonly variables: readonly string[];
  readonly localeCode: string;
  readonly submittedByStaffUserId: string;
  readonly now: Date;
}

export type SubmitMessageTemplateResult =
  | { readonly ok: true; readonly template: MessageTemplateRow }
  | { readonly ok: false; readonly reason: ChannelsReason };

/** `POST /channels/whatsapp/templates` (B10 tab 3 `+ Submit new template`). "Submitted
 *  templates enter as `Pending`" (FR-CHAN-12) — enforced by the repository, not this input.
 *  Duplicate `(name, localeCode)` → `409` in api.md's own contract; surfaced here as the same
 *  closed-vocabulary reason shape the rest of this module uses. */
export class SubmitMessageTemplate {
  constructor(private readonly deps: { readonly templates: MessageTemplateRepository }) {}

  async execute(input: SubmitMessageTemplateInput): Promise<SubmitMessageTemplateResult> {
    if (!placeholderCountMatchesVariables(input.bodySample, input.variables.length)) {
      return { ok: false, reason: "channels.template_placeholder_mismatch" };
    }
    const existing = await this.deps.templates.findByNameAndLocale(input.name, input.localeCode);
    if (existing) {
      return { ok: false, reason: "channels.template_duplicate_name" };
    }

    const template = await this.deps.templates.create({
      name: input.name,
      channelKey: input.channelKey,
      category: input.category,
      bodySample: input.bodySample,
      variables: input.variables,
      localeCode: input.localeCode,
      submittedByStaffUserId: input.submittedByStaffUserId,
      now: input.now,
    });
    return { ok: true, template };
  }
}
