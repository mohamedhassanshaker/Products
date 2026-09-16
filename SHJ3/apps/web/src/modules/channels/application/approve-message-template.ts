import type { MessageTemplateRepository } from "../ports/message-template-repository.js";

export interface ApproveMessageTemplateInput {
  readonly id: string;
  readonly bspTemplateId: string;
  readonly now: Date;
}

/**
 * `POST /channels/whatsapp/templates/{id}/approve` (B10 tab 3 -> tab 4 unblock). "This is
 * the dependency that unblocks the campaign... requires `agents:publish` because it releases
 * outbound messaging capability" — the permission gate lives in the Server Action
 * (`agents:publish`, matching api.md's own reasoning), not here.
 *
 * Normally driven by the BSP webhook (§10.1 rule 5, the same `template_status_changed`
 * inbound event this action's own logic mirrors) — this use case exists for the local/mock
 * BSP adapter and for a manual override. No campaign fan-out is needed here: campaign state
 * is *derived* (`deriveCampaignDisplayState`) from the template's live `approvalStatus` on
 * every read, so approving the template unblocks every dependent campaign on the very next
 * read of `ListCampaigns`, with nothing to synchronise.
 */
export class ApproveMessageTemplate {
  constructor(private readonly deps: { readonly templates: MessageTemplateRepository }) {}

  async execute(input: ApproveMessageTemplateInput): Promise<void> {
    await this.deps.templates.approve({
      id: input.id,
      bspTemplateId: input.bspTemplateId,
      now: input.now,
    });
  }
}
