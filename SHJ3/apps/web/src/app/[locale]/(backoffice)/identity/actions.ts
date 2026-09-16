"use server";

/**
 * Server Actions for `/identity` (B11: Identity & transactions) — every write
 * on this screen. Mirrors `(backoffice)/tools/actions.ts`'s exact
 * `withStaffAuth` + `requirePermission` + `ActionResult` convention.
 *
 * ## Permission, per api.md §6.10/§6.11's own `[ASSUMPTION]`
 *
 * The B9 matrix has no identity or finance row. `users:manage` (Super Admin
 * only) is the narrowest permission in the matrix, and this configuration
 * decides whether money can move against an unverified person — api.md's own
 * reasoning for choosing it here, transcribed rather than re-derived.
 */

import { revalidatePath } from "next/cache";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { SetStepUpRule } from "../../../../modules/identity/application/set-step-up-rule.js";
import { SetAccountOwnershipCheck } from "../../../../modules/identity/application/set-account-ownership-check.js";
import { TenantAuditSink } from "../../../../modules/platform/adapters/outbound/sql/audit-sink.js";
import type { RequiredAssuranceLevel } from "../../../../modules/tools/domain/tool-catalog.js";
import type { StepUpAction } from "../../../../modules/identity/domain/step-up.js";
import { ApproveRefund } from "../../../../modules/transactions/application/approve-refund.js";
import { DeclineRefund } from "../../../../modules/transactions/application/decline-refund.js";
import {
  now,
  paymentEventRepository,
  paymentGateway,
  refundRequestRepository,
  stepUpRuleRepository,
  transactionRepository,
  verificationConfigRepository,
} from "./composition.js";

const MANAGE_PERMISSION = "users:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function setStepUpRuleAction(
  actionKey: StepUpAction,
  requiredAssurance: RequiredAssuranceLevel,
): Promise<ActionResult<{ readonly ok: boolean; readonly reason?: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "identity.setStepUpRule");
        const result = await new SetStepUpRule({
          rules: stepUpRuleRepository(),
          audit: new TenantAuditSink(),
        }).execute({ actionKey, requiredAssurance, actor: principal, now: now() });
        revalidatePath("/identity");
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { actionKey, requiredAssurance } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function setAccountOwnershipCheckAction(
  enabled: boolean,
  reason: string | null,
): Promise<ActionResult<{ readonly ok: boolean }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "identity.setAccountOwnershipCheck");
        const result = await new SetAccountOwnershipCheck({
          config: verificationConfigRepository(),
          audit: new TenantAuditSink(),
        }).execute({ enabled, reason, actor: principal, now: now() });
        revalidatePath("/identity");
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { enabled, reason } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function approveRefundAction(
  refundRequestId: string,
): Promise<ActionResult<{ readonly ok: boolean; readonly reason?: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "identity.approveRefund");
        const result = await new ApproveRefund({
          gateway: paymentGateway(),
          refunds: refundRequestRepository(),
          transactions: transactionRepository(),
          events: paymentEventRepository(),
          audit: new TenantAuditSink(),
        }).execute({ refundRequestId, actor: principal, now: now() });
        revalidatePath("/identity");
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { refundRequestId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function declineRefundAction(
  refundRequestId: string,
  reason: string,
): Promise<ActionResult<{ readonly ok: boolean; readonly reason?: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "identity.declineRefund");
        const result = await new DeclineRefund({
          refunds: refundRequestRepository(),
          transactions: transactionRepository(),
          audit: new TenantAuditSink(),
        }).execute({ refundRequestId, reason, actor: principal, now: now() });
        revalidatePath("/identity");
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { refundRequestId, reason } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
