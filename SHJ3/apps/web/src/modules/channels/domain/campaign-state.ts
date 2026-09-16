/**
 * The B10 tab 4 three-state badge, derived exactly the way the real SQL projection does.
 *
 * `Blocked` is **not a stored column** (`prisma/tenant/schema.prisma`'s own doc comment on
 * `Campaign`) — storing it would create a second fact that can disagree with the template's
 * real approval status. The real enforcement is `TR_Campaigns_templateMustBeApproved` (a
 * database trigger) and the real read-side projection is the `CampaignStates` SQL view
 * (`prisma/sql/001_constraints.sql`):
 *
 * ```sql
 * CASE WHEN t.approvalStatus <> 'Approved' THEN 'Blocked'
 *      WHEN c.isEnabled = 1                THEN 'On'
 *      ELSE                                     'Off' END
 * ```
 *
 * This function is the same three-branch derivation, kept in TypeScript so the backoffice
 * repository layer can compute the badge from a single joined read (`Campaign` +
 * `MessageTemplate.approvalStatus`) without a second round trip to the view — and so the
 * exact same logic is unit-testable without a database. It must never be used to decide
 * whether a write is *allowed*: that enforcement is the trigger's job alone (see
 * `enable-campaign.ts`), precisely so a bug here can never widen what the database permits.
 */
import type { CampaignDisplayState, TemplateApprovalStatus } from "./vocabulary.js";

export function deriveCampaignDisplayState(input: {
  readonly isEnabled: boolean;
  readonly templateApprovalStatus: TemplateApprovalStatus;
}): CampaignDisplayState {
  if (input.templateApprovalStatus !== "Approved") return "Blocked";
  return input.isEnabled ? "On" : "Off";
}
