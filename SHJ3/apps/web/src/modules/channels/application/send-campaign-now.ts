import { createHash } from "node:crypto";
import { isWithinQuietHours } from "../domain/quiet-hours.js";
import type { SuppressionReason } from "../domain/vocabulary.js";
import type { CampaignRepository } from "../ports/campaign-repository.js";
import type { ConsentRepository } from "../ports/consent-repository.js";
import type { QuietHoursRepository } from "../ports/quiet-hours-repository.js";

export interface CampaignRecipient {
  readonly subjectHash: string;
  readonly citizenIdentityId: string | null;
}

export interface SendCampaignNowInput {
  readonly campaignId: string;
  /** Resolved by the caller from `Campaign.audienceDefinitionJson` — audience-segment
   *  resolution (matching a query against `CitizenIdentity`/billing/booking data) is a real,
   *  separate feature this pass does not build; see this method's own doc comment. */
  readonly recipients: readonly CampaignRecipient[];
  /** Identifies THIS firing of the trigger (a scheduled run, a manual click) — folded into
   *  `CampaignSend.idempotencyKey` alongside `campaignId`/`recipientHash`, matching the real
   *  model's own doc comment. A distinct value per call is what makes two separate manual
   *  clicks two separate campaigns of sends rather than colliding. */
  readonly triggerOccurrenceKey: string;
  /** "A simple, honest counter is fine" (the wave's own brief) — the remaining sends this
   *  campaign may make before its next cap reset; `undefined` means uncapped. */
  readonly remainingDailyCap?: number;
  readonly now: Date;
}

export type SendCampaignNowResult =
  | {
      readonly ok: true;
      readonly sent: number;
      readonly suppressed: number;
      readonly throttled: number;
    }
  | { readonly ok: false; readonly reason: "channels.template_not_approved" }
  | { readonly ok: false; readonly reason: "channels.quiet_hours" };

function idempotencyKeyFor(
  campaignId: string,
  recipientHash: string,
  triggerOccurrenceKey: string,
): string {
  // VarChar(120) — hashed so no combination of real-world input lengths can overflow it,
  // while staying fully deterministic for the same (campaign, recipient, occurrence) triple.
  return createHash("sha256")
    .update(`${campaignId}:${recipientHash}:${triggerOccurrenceKey}`)
    .digest("hex");
}

/**
 * `POST /channels/campaigns/{id}/send-now` (B10 tab 4). Implements api.md §10.3's seven
 * send-time checks — "checked at send time... not only at configuration time," because
 * between arming a campaign and its trigger firing, the template can be revoked, the citizen
 * can reply `STOP`, and the clock can reach 21:00.
 *
 * Checks 1 (template approved) and 4 (quiet hours) abort the WHOLE batch up front, matching
 * the table's own wording ("whole batch aborts" / "returns `409` up front"). Checks 2+3
 * (recorded opt-in / not suppressed) collapse into one `ConsentState` read per recipient —
 * `ConsentState.state === 'OptedIn'` IS "not on a suppression list" here, since a `STOP` is
 * recorded as an `OptOut` ledger entry that this same projection reflects (this wave's own
 * brief: "`ConsentState`'s revoked/STOP state covers this"). Check 5 (session window) needs
 * no code here: every campaign send is a *template* send by construction (`MessageTemplate`-
 * backed), and a template send is exactly api.md §9.11's "only way to open a closed session
 * window" — it is never blocked by the window, so nothing to check. Check 6 (rate/cap) is
 * the plain counter `remainingDailyCap` describes. Check 7 (idempotency) is enforced by
 * `CampaignRepository.recordSend`'s own real `UQ_CampaignSends_idempotencyKey` backstop.
 *
 * **Deliberately out of scope for this pass** (documented, not silently dropped): resolving
 * `Campaign.audienceDefinitionJson` into a live recipient list is a real, separate query
 * engine over citizen/billing/booking data that does not exist anywhere in this codebase yet
 * — `recipients` is supplied by the caller so this use case's own real job (the seven checks)
 * is testable and correct independent of how an audience eventually gets resolved. Likewise,
 * "recipient re-queued to 07:00" for a background worker is not built — this pass covers the
 * interactive send-now action's own upfront quiet-hours refusal only, which is what api.md's
 * `409 channels.quiet_hours` line actually describes for this endpoint.
 */
export class SendCampaignNow {
  constructor(
    private readonly deps: {
      readonly campaigns: CampaignRepository;
      readonly consent: ConsentRepository;
      readonly quietHours: QuietHoursRepository;
    },
  ) {}

  async execute(input: SendCampaignNowInput): Promise<SendCampaignNowResult> {
    const campaign = await this.deps.campaigns.findById(input.campaignId);
    if (!campaign || campaign.templateApprovalStatus !== "Approved") {
      return { ok: false, reason: "channels.template_not_approved" };
    }

    if (campaign.respectQuietHours) {
      const quietHoursConfig = await this.deps.quietHours.getSingleton();
      if (quietHoursConfig && isWithinQuietHours(input.now, quietHoursConfig)) {
        return { ok: false, reason: "channels.quiet_hours" };
      }
    }

    let sent = 0;
    let suppressed = 0;
    let throttled = 0;
    let remainingCap = input.remainingDailyCap;

    for (const recipient of input.recipients) {
      if (remainingCap !== undefined && remainingCap <= 0) {
        throttled += 1;
        continue;
      }

      const consent = await this.deps.consent.currentState(
        recipient.subjectHash,
        campaign.messageTemplateChannelKey,
        "ProactiveMessaging",
      );
      const suppressionReason: SuppressionReason | null =
        !consent || consent.state !== "OptedIn" ? "NoOptIn" : null;

      const idempotencyKey = idempotencyKeyFor(
        input.campaignId,
        recipient.subjectHash,
        input.triggerOccurrenceKey,
      );

      const { inserted } = await this.deps.campaigns.recordSend({
        campaignId: input.campaignId,
        messageTemplateId: campaign.messageTemplateId,
        recipientHash: recipient.subjectHash,
        citizenIdentityId: recipient.citizenIdentityId,
        state: suppressionReason ? "Suppressed" : "Sent",
        suppressionReason,
        idempotencyKey,
        now: input.now,
      });

      if (!inserted) continue; // check 7 — duplicate skipped silently

      if (suppressionReason) {
        suppressed += 1;
      } else {
        sent += 1;
        if (remainingCap !== undefined) remainingCap -= 1;
      }
    }

    if (sent > 0) await this.deps.campaigns.incrementSentThisMonth(input.campaignId, input.now);

    return { ok: true, sent, suppressed, throttled };
  }
}
