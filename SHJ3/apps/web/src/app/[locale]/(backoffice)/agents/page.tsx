import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../modules/iam/domain/permissions.js";
import { ListAgents } from "../../../../modules/agents/application/list-agents.js";
import type { AgentRegistryRow } from "../../../../modules/agents/ports/agent-repository.js";
import { agentRepository } from "./composition.js";
import { AgentsScreen } from "./agents-screen.js";
import {
  archiveAgentAction,
  cloneAgentAction,
  loadVersionHistoryAction,
  publishAgentVersionAction,
  rollbackAgentVersionAction,
  unpublishAgentAction,
} from "./actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly rows: readonly AgentRegistryRow[];
      readonly canPublish: boolean;
    };

/**
 * `/agents` (B2: Agent registry) — list, clone/publish/unpublish/archive/rollback.
 *
 * Follows `iam/page.tsx`'s exact shape: `requirePermission` runs inside `withStaffAuth`'s
 * bound tenant context before any query, every real read happens inside that same handler
 * (no ambient `TenantContext` survives past it — see `next-request-context.ts`'s own doc
 * comment), and the resolved `PageData` is plain data with no live repository handles.
 *
 * `canPublish` is resolved once here (whether the signed-in principal holds `agents:publish`)
 * so `AgentsScreen` can show/hide the Publish row-action without a second round trip — the
 * server check inside `publishAgentVersionAction` is still the real enforcement; this is only
 * the client hint (architecture.md §9's "the server check is the real one" rule).
 */
export default async function AgentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("agents.registry");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "agents:manage", "agents.page (visibility)");
      } catch (error) {
        if (error instanceof PermissionDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const { rows } = await new ListAgents({ agents: agentRepository() }).execute();
      const canPublish = principal.permissions.has("agents:publish");
      return { kind: "ok", rows, canPublish } as const;
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/agents`)}`}
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
      <AgentsScreen
        rows={pageData.rows}
        canPublish={pageData.canPublish}
        actions={{
          cloneAgent: cloneAgentAction,
          publishAgentVersion: publishAgentVersionAction,
          unpublishAgent: unpublishAgentAction,
          archiveAgent: archiveAgentAction,
          rollbackAgentVersion: rollbackAgentVersionAction,
          loadVersionHistory: loadVersionHistoryAction,
        }}
      />
    </div>
  );
}
