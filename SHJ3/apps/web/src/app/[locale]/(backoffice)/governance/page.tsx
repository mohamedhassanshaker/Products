import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../modules/iam/domain/permissions.js";
import { ListEnvironments } from "../../../../modules/governance/application/list-environments.js";
import { ListPendingPromotions } from "../../../../modules/governance/application/list-pending-promotions.js";
import { ListAuditLog } from "../../../../modules/governance/application/list-audit-log.js";
import { GetObservability } from "../../../../modules/governance/application/get-observability.js";
import {
  GetPrivacyConfig,
  type GetPrivacyConfigResult,
} from "../../../../modules/governance/application/get-privacy-config.js";
import type { EnvironmentRow } from "../../../../modules/governance/ports/environment-repository.js";
import type { PromotionRequestRow } from "../../../../modules/governance/ports/promotion-repository.js";
import type { AuditLogPage } from "../../../../modules/governance/ports/audit-log-repository.js";
import type { ServiceHealthSampleRow } from "../../../../modules/governance/ports/service-health-repository.js";
import type { ErasureRequestRow } from "../../../../modules/governance/ports/erasure-request-repository.js";
import {
  auditLogRepository,
  environmentRepository,
  erasureRequestRepository,
  privacyConfigRepository,
  promotionRequestRepository,
  serviceHealthRepository,
} from "./composition.js";
import { GovernanceScreen } from "./governance-screen.js";
import {
  approvePromotionAction,
  createErasureRequestAction,
  getAuditEntryAction,
  getObservabilityAction,
  getPrivacyConfigAction,
  listAuditLogAction,
  listErasureRequestsAction,
  listRetentionSweepRunsAction,
  processErasureRequestAction,
  recomputeObservabilityAction,
  rejectPromotionAction,
  requestPromotionAction,
  runRetentionSweepAction,
  updatePrivacyConfigAction,
} from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly environments: readonly EnvironmentRow[];
      readonly pendingPromotions: readonly PromotionRequestRow[];
      readonly auditLog: AuditLogPage;
      readonly observability: readonly ServiceHealthSampleRow[];
      readonly privacyConfig: GetPrivacyConfigResult;
      readonly erasureRequests: readonly ErasureRequestRow[];
    };

const PERMISSION = "governance:manage" as const;

/**
 * `/governance` (B14) — Environments & promotions, Audit log, Observability, Privacy &
 * data. One permission gates the whole surface (`governance:manage`); every query runs
 * inside `withStaffAuth`'s handler, matching `escalations/page.tsx`'s own precedent.
 */
export default async function GovernancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("governance");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      if (!isAllowed(principal.permissions, PERMISSION)) return { kind: "forbidden" } as const;

      const [
        environments,
        pendingPromotions,
        auditLog,
        observability,
        privacyConfig,
        erasureRequests,
      ] = await Promise.all([
        new ListEnvironments({ environments: environmentRepository() }).execute(),
        new ListPendingPromotions({ promotions: promotionRequestRepository() }).execute(),
        new ListAuditLog({ auditLog: auditLogRepository() }).execute({ limit: 50 }),
        new GetObservability({ samples: serviceHealthRepository() }).execute(),
        new GetPrivacyConfig({ privacyConfig: privacyConfigRepository() }).execute(),
        erasureRequestRepository().list(),
      ]);

      return {
        kind: "ok",
        environments,
        pendingPromotions,
        auditLog,
        observability,
        privacyConfig,
        erasureRequests,
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/governance`)}`}
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
      <GovernanceScreen
        environments={pageData.environments}
        pendingPromotions={pageData.pendingPromotions}
        auditLog={pageData.auditLog}
        observability={pageData.observability}
        privacyConfig={pageData.privacyConfig}
        erasureRequests={pageData.erasureRequests}
        actions={{
          requestPromotion: requestPromotionAction,
          approvePromotion: approvePromotionAction,
          rejectPromotion: rejectPromotionAction,
          listAuditLog: listAuditLogAction,
          getAuditEntry: getAuditEntryAction,
          getObservability: getObservabilityAction,
          recomputeObservability: recomputeObservabilityAction,
          getPrivacyConfig: getPrivacyConfigAction,
          updatePrivacyConfig: updatePrivacyConfigAction,
          listErasureRequests: listErasureRequestsAction,
          createErasureRequest: createErasureRequestAction,
          processErasureRequest: processErasureRequestAction,
          runRetentionSweep: runRetentionSweepAction,
          listRetentionSweepRuns: listRetentionSweepRunsAction,
        }}
      />
    </div>
  );
}
