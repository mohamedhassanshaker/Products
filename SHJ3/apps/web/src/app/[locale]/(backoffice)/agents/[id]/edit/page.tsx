import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../../../modules/iam/domain/permissions.js";
import { GetAgent } from "../../../../../../modules/agents/application/get-agent.js";
import { GetOrCreateWizardDraft } from "../../../../../../modules/agents/application/get-or-create-wizard-draft.js";
import { GetDraftValidation } from "../../../../../../modules/agents/application/get-draft-validation.js";
import { GetGuardrailSettings } from "../../../../../../modules/agents/application/get-guardrail-settings.js";
import { ListSkills } from "../../../../../../modules/tools/application/list-skills.js";
import { ListMcpServers } from "../../../../../../modules/tools/application/list-mcp-servers.js";
import { ListApiConnectors } from "../../../../../../modules/tools/application/list-api-connectors.js";
import type {
  AgentDetail,
  AgentVersionDetail,
} from "../../../../../../modules/agents/ports/agent-repository.js";
import type { WizardDraft } from "../../../../../../modules/agents/ports/wizard-draft-repository.js";
import type {
  ChannelBindingRow,
  FlowBindingRow,
  KnowledgeBindingRow,
} from "../../../../../../modules/agents/ports/agent-bindings-repository.js";
import type { GuardrailSettingRow } from "../../../../../../modules/agents/application/get-guardrail-settings.js";
import type { WizardStepId } from "../../../../../../modules/agents/domain/agent.js";
import type { SkillCatalogRow } from "../../../../../../modules/tools/application/list-skills.js";
import type {
  McpServerRow,
  McpToolRow,
} from "../../../../../../modules/tools/ports/mcp-server-repository.js";
import type { ApiConnectorCatalogRow } from "../../../../../../modules/tools/application/list-api-connectors.js";
import type { ToolBindingRow } from "../../../../../../modules/tools/ports/tool-binding-repository.js";
import {
  agentBindingsRepository,
  agentRepository,
  apiConnectorRepository,
  mcpServerRepository,
  policyOverrideRepository,
  skillRepository,
  toolBindingRepository,
  wizardDraftRepository,
} from "../../composition.js";
import { WizardShell } from "./wizard-shell.js";
import {
  applyFlowEditPlanAction,
  bindToolAction,
  connectAndDiscoverMcpServerAction,
  createFlowEdgeAction,
  createFlowNodeAction,
  deleteFlowEdgeAction,
  deleteFlowNodeAction,
  getDraftValidationAction,
  loadFlowsStepDataAction,
  loadKnowledgeStepDataAction,
  proposeFlowEditAction,
  publishAgentVersionAction,
  replaceChannelBindingsAction,
  replaceKnowledgeBindingsAction,
  saveWizardDraftStepAction,
  sendSandboxTurnAction,
  setEntryNodeAction,
  setEscapeNodeAction,
  setGuardrailOverrideAction,
  unbindToolAction,
  updateFlowEdgeAction,
  updateFlowNodeAction,
  updateIdentityAction,
  updateVersionConfigAction,
} from "../../actions.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not-found" }
  | {
      readonly kind: "ok";
      readonly agent: AgentDetail;
      readonly draft: WizardDraft;
      readonly draftVersion: AgentVersionDetail;
      readonly knowledgeBindings: readonly KnowledgeBindingRow[];
      readonly flowBindings: readonly FlowBindingRow[];
      readonly channelBindings: readonly ChannelBindingRow[];
      readonly toolBindings: readonly ToolBindingRow[];
      readonly skills: readonly SkillCatalogRow[];
      readonly mcpServers: readonly McpServerRow[];
      readonly mcpToolsByServer: Readonly<Record<string, readonly McpToolRow[]>>;
      readonly apiConnectors: readonly ApiConnectorCatalogRow[];
      readonly guardrails: readonly GuardrailSettingRow[];
      readonly missingSteps: readonly WizardStepId[];
      readonly canPublish: boolean;
    };

/**
 * `/agents/[id]/edit` — the B3 10-step wizard shell, steps "instructions" onward (step 1
 * "identity" is also editable here, via `updateIdentityAction`).
 *
 * Every real query happens inside `withStaffAuth`'s handler, matching `iam/page.tsx`'s own
 * rule — `getTenantDb()` needs the ambient `TenantContext` that only exists for the duration
 * of that callback.
 *
 * `GetOrCreateWizardDraft` is owner-scoped (`ownerStaffUserId: principal.id`): two different
 * staff users opening the same agent concurrently each get their own draft version — this
 * page does not attempt to merge or lock across editors, matching this wave's own documented
 * scope (`tasks/todo.md`'s B-3 research: "get-or-create wizard draft" forks a new Draft
 * `AgentVersion` off the current Published one when no draft already exists for that
 * owner+agent").
 */
export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations("agents.wizard");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "agents:manage", "agents.edit (visibility)");
      } catch (error) {
        if (error instanceof PermissionDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const agents = agentRepository();
      const found = await new GetAgent({ agents }).execute({ agentId: id });
      if (!found) return { kind: "not-found" } as const;

      const draft = await new GetOrCreateWizardDraft({
        agents,
        drafts: wizardDraftRepository(),
      }).execute({ agentId: id, ownerStaffUserId: principal.id, now: new Date() });

      const draftVersion = await agents.getVersion(draft.agentVersionId);
      if (!draftVersion) {
        throw new Error(
          `Wizard draft "${draft.id}" points at agent version "${draft.agentVersionId}", which does not exist.`,
        );
      }

      const bindings = agentBindingsRepository();
      const [
        knowledgeBindings,
        flowBindings,
        channelBindings,
        toolBindings,
        skillsResult,
        serversResult,
        connectorsResult,
        guardrailsResult,
        validation,
      ] = await Promise.all([
        bindings.listKnowledgeBindings(draft.agentVersionId),
        bindings.listFlowBindings(draft.agentVersionId),
        bindings.listChannelBindings(draft.agentVersionId),
        toolBindingRepository().listForVersion(draft.agentVersionId),
        new ListSkills({ skills: skillRepository(), bindings: toolBindingRepository() }).execute(),
        new ListMcpServers({ servers: mcpServerRepository() }).execute(),
        new ListApiConnectors({
          connectors: apiConnectorRepository(),
          bindings: toolBindingRepository(),
        }).execute(),
        new GetGuardrailSettings({ policies: policyOverrideRepository() }).execute({ agentId: id }),
        new GetDraftValidation({ agents, bindings }).execute({
          agentId: id,
          agentVersionId: draft.agentVersionId,
        }),
      ]);

      // `ListMcpServers` deliberately returns no per-server tool list (that's a separate,
      // potentially large read) — step 4 sub-tab B needs each connected server's already-
      // discovered tools to render its bindable pills, so fetched here, one call per server.
      const mcpToolsEntries = await Promise.all(
        serversResult.rows.map(
          async (server) => [server.id, await mcpServerRepository().listTools(server.id)] as const,
        ),
      );
      const mcpToolsByServer = Object.fromEntries(mcpToolsEntries);

      return {
        kind: "ok",
        agent: found.agent,
        draft,
        draftVersion,
        knowledgeBindings,
        flowBindings,
        channelBindings,
        toolBindings,
        skills: skillsResult.rows,
        mcpServers: serversResult.rows,
        mcpToolsByServer,
        apiConnectors: connectorsResult.rows,
        guardrails: guardrailsResult.settings,
        missingSteps: validation.missingSteps,
        canPublish: principal.permissions.has("agents:publish"),
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
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/agents/${id}/edit`)}`}
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
  if (pageData.kind === "not-found") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("notFoundHeading")}</h1>
        <p className="text-sm text-muted-foreground">{t("notFoundBody")}</p>
      </div>
    );
  }

  return (
    <WizardShell
      agent={pageData.agent}
      draft={pageData.draft}
      draftVersion={pageData.draftVersion}
      knowledgeBindings={pageData.knowledgeBindings}
      flowBindings={pageData.flowBindings}
      channelBindings={pageData.channelBindings}
      toolBindings={pageData.toolBindings}
      skills={pageData.skills}
      mcpServers={pageData.mcpServers}
      mcpToolsByServer={pageData.mcpToolsByServer}
      apiConnectors={pageData.apiConnectors}
      guardrails={pageData.guardrails}
      missingSteps={pageData.missingSteps}
      canPublish={pageData.canPublish}
      actions={{
        updateIdentity: updateIdentityAction,
        updateVersionConfig: updateVersionConfigAction,
        saveWizardDraftStep: saveWizardDraftStepAction,
        getDraftValidation: getDraftValidationAction,
        replaceChannelBindings: replaceChannelBindingsAction,
        setGuardrailOverride: setGuardrailOverrideAction,
        bindTool: bindToolAction,
        unbindTool: unbindToolAction,
        connectAndDiscoverMcpServer: connectAndDiscoverMcpServerAction,
        publishAgentVersion: publishAgentVersionAction,
        loadKnowledgeStepData: loadKnowledgeStepDataAction,
        replaceKnowledgeBindings: replaceKnowledgeBindingsAction,
        loadFlowsStepData: loadFlowsStepDataAction,
        createFlowNode: createFlowNodeAction,
        updateFlowNode: updateFlowNodeAction,
        deleteFlowNode: deleteFlowNodeAction,
        createFlowEdge: createFlowEdgeAction,
        updateFlowEdge: updateFlowEdgeAction,
        deleteFlowEdge: deleteFlowEdgeAction,
        setEntryNode: setEntryNodeAction,
        setEscapeNode: setEscapeNodeAction,
        proposeFlowEdit: proposeFlowEditAction,
        applyFlowEditPlan: applyFlowEditPlanAction,
        sendSandboxTurn: sendSandboxTurnAction,
      }}
    />
  );
}
