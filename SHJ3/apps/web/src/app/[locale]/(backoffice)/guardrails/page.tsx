import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { isAllowed } from "../../../../modules/iam/domain/permissions.js";
import { ListGuardrailPolicies } from "../../../../modules/guardrails/application/list-guardrail-policies.js";
import { ListPolicyOverrides } from "../../../../modules/guardrails/application/list-policy-overrides.js";
import type { GlobalPolicyRow } from "../../../../modules/guardrails/ports/policy-catalogue-repository.js";
import type { PolicyOverrideDirectoryRow } from "../../../../modules/guardrails/ports/policy-override-directory-repository.js";
import { policyCatalogueRepository, policyOverrideDirectoryRepository } from "./composition.js";
import { GuardrailsScreen } from "./guardrails-screen.js";
import {
  listGuardrailPoliciesAction,
  listPolicyOverridesAction,
  updateGuardrailPolicyValueAction,
} from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly policies: readonly GlobalPolicyRow[];
      readonly overrides: readonly PolicyOverrideDirectoryRow[];
    };

const PERMISSION = "governance:manage" as const;

/**
 * `/guardrails` (Screen 3) — the GLOBAL policy catalogue admin view: every `platform.
 * Policy` row, which are structurally locked, a real edit affordance for unlocked ones,
 * and a read-only directory of every agent's per-agent override and why. Deliberately
 * distinct from `guardrails-step.tsx` (the agent wizard's own step 7), which stays the
 * only place a per-agent override is actually written — see this module's own doc
 * comments for the full reasoning.
 *
 * Gated on `governance:manage`, the same permission `/governance` uses — this screen
 * shares that module's "even Super Admin cannot bypass a structural lock" theme, and no
 * separate permission exists for the global guardrail catalogue specifically (confirmed
 * against `modules/iam/domain/permissions.ts`'s real, current 11-permission matrix before
 * reusing this one).
 */
export default async function GuardrailsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("guardrails");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      if (!isAllowed(principal.permissions, PERMISSION)) return { kind: "forbidden" } as const;

      const [{ policies }, { overrides }] = await Promise.all([
        new ListGuardrailPolicies({ policies: policyCatalogueRepository() }).execute(),
        new ListPolicyOverrides({ overrides: policyOverrideDirectoryRepository() }).execute(),
      ]);

      return { kind: "ok", policies, overrides } as const;
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/guardrails`)}`}
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
      <GuardrailsScreen
        policies={pageData.policies}
        overrides={pageData.overrides}
        locale={locale}
        actions={{
          listGuardrailPolicies: listGuardrailPoliciesAction,
          updateGuardrailPolicyValue: updateGuardrailPolicyValueAction,
          listPolicyOverrides: listPolicyOverridesAction,
        }}
      />
    </div>
  );
}
