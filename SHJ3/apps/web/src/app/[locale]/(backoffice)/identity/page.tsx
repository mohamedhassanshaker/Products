import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../modules/iam/domain/permissions.js";
import type { StepUpRuleRow } from "../../../../modules/identity/ports/step-up-rule-repository.js";
import { STEP_UP_ACTIONS } from "../../../../modules/identity/domain/step-up.js";
import type { RefundRequestRow } from "../../../../modules/transactions/ports/refund-request-repository.js";
import type { TransactionRow } from "../../../../modules/transactions/ports/transaction-repository.js";
import {
  refundRequestRepository,
  stepUpRuleRepository,
  transactionRepository,
  verificationConfigRepository,
} from "./composition.js";
import { IdentityScreen } from "./identity-screen.js";
import { approveRefundAction, declineRefundAction, setStepUpRuleAction } from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly stepUpRules: readonly StepUpRuleRow[];
      readonly pendingRefunds: readonly RefundRequestRow[];
      readonly transactionsById: ReadonlyMap<string, TransactionRow>;
      readonly accountOwnershipCheckEnabled: boolean;
    };

/**
 * `/identity` (B11: Identity & transactions) — the step-up gate's own
 * back-office half (B11 tab 2) and the refund approve/decline flow (B11 tab
 * 4). Gated on `users:manage`, api.md §6.10/§6.11's own `[ASSUMPTION]`: the
 * B9 matrix has no identity/finance row, and this configuration decides
 * whether money can move against an unverified person, so it takes the
 * narrowest permission in the matrix.
 *
 * Every query runs inside `withStaffAuth`'s handler, identical to
 * `tools/page.tsx`'s own reasoning — `getTenantDb()` resolves from the
 * ambient `TenantContext` `withStaffAuth` establishes for the callback's
 * duration only.
 */
export default async function IdentityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("identity");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "users:manage", "identity.page (visibility)");
      } catch (error) {
        if (error instanceof PermissionDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const rules = stepUpRuleRepository();
      const [seededRules, verificationConfig, pendingRefunds] = await Promise.all([
        rules.list(),
        verificationConfigRepository().get(),
        refundRequestRepository().listPending(),
      ]);

      // A fresh tenant that has never visited this screen has no seeded rows —
      // rendered here as the closed action vocabulary with no override, which
      // `EvaluateStepUp`'s own "no row = gates nothing" reading already treats
      // identically at runtime (see that use case's own doc comment).
      const byAction = new Map(seededRules.map((r) => [r.actionKey, r]));
      const stepUpRules: StepUpRuleRow[] = STEP_UP_ACTIONS.map(
        (actionKey) =>
          byAction.get(actionKey) ?? {
            id: "",
            actionKey,
            requiredAssurance: "Anonymous",
            isEnabled: false,
            ordinal: 0,
          },
      );

      const transactions = transactionRepository();
      const transactionRows = await Promise.all(
        pendingRefunds.map((r) => transactions.findById(r.transactionId)),
      );
      const transactionsById = new Map<string, TransactionRow>();
      for (const row of transactionRows) {
        if (row) transactionsById.set(row.id, row);
      }

      return {
        kind: "ok",
        stepUpRules,
        pendingRefunds,
        transactionsById,
        accountOwnershipCheckEnabled: verificationConfig.accountOwnershipCheckEnabled,
      } as const;
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      pageData = { kind: "unauthenticated" };
    } else {
      throw error;
    }
  }

  if (pageData.kind === "unauthenticated") {
    const tCommon = await getTranslations("common");
    return (
      <div className="flex flex-col gap-4">
        <SignInPrompt
          heading={t("pageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/identity`)}`}
          signInLabel={tCommon("signInCta")}
        />
      </div>
    );
  }

  if (pageData.kind === "forbidden") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("permissionDeniedHeading")}</h1>
        <p className="text-sm text-muted-foreground">{t("permissionDeniedBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
      <IdentityScreen
        stepUpRules={pageData.stepUpRules}
        pendingRefunds={pageData.pendingRefunds}
        transactionsById={pageData.transactionsById}
        accountOwnershipCheckEnabled={pageData.accountOwnershipCheckEnabled}
        actions={{
          setStepUpRule: setStepUpRuleAction,
          approveRefund: approveRefundAction,
          declineRefund: declineRefundAction,
        }}
      />
    </div>
  );
}
