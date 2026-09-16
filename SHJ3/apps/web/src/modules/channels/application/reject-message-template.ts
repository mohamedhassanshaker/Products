import type { MessageTemplateRepository } from "../ports/message-template-repository.js";

export interface RejectMessageTemplateInput {
  readonly id: string;
  readonly reason: string;
  readonly now: Date;
}

/** `POST /channels/whatsapp/templates/{id}/reject` (B10 tab 3 `[ASSUMPTION]`). "Any campaign
 *  depending on it stays `blocked` and its toggle stays inert" — true automatically, since
 *  campaign state is derived from `approvalStatus`, never a second stored fact. */
export class RejectMessageTemplate {
  constructor(private readonly deps: { readonly templates: MessageTemplateRepository }) {}

  async execute(input: RejectMessageTemplateInput): Promise<void> {
    await this.deps.templates.reject({ id: input.id, reason: input.reason, now: input.now });
  }
}
