"use client";

/**
 * The B3 10-step wizard shell — wraps the shared `Wizard` organism
 * (`@/components/patterns/wizard/wizard`), owning `activeStepId` and per-step form state as a
 * controlled component (`Wizard` itself never advances steps on its own).
 *
 * ## Two different kinds of "save" in this screen, deliberately not conflated
 *
 * - **`onSaveDraft`** (fired on every step change and on a debounce after `notifyDirty()`)
 *   persists `stepStateJson` — an in-progress-edit resume aid (`SaveWizardDraftStep`) for the
 *   *currently active* step's not-yet-committed field values. If the browser crashes mid-edit,
 *   reopening `/agents/[id]/edit` re-hydrates real committed data (see `page.tsx`) — this JSON
 *   blob is a nice-to-have crash-recovery aid layered on top, not the source of truth.
 * - **"Save & continue"** (`onSaveAndContinue`) is what actually commits a step's fields to
 *   real tables, via the specific Server Action each step needs (`updateIdentityAction`,
 *   `updateVersionConfigAction`, `replaceChannelBindingsAction`, `setGuardrailOverrideAction`,
 *   ...) — `TR_AgentVersions_publishedImmutable` (error 51110) is the real guard against
 *   editing an already-published version; this screen never edits one (`GetOrCreateWizardDraft`
 *   always resolves to a Draft version).
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Wizard,
  type WizardStep,
  type WizardStepStatus,
} from "@/components/patterns/wizard/wizard";
import {
  WIZARD_STEP_IDS,
  type ChannelKey,
  type Tone,
  type WizardStepId,
} from "../../../../../../modules/agents/domain/agent.js";
import { publishedVersionNumber } from "../../../../../../modules/agents/domain/version.js";
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
import type { PublishGateBlockingReason } from "../../../../../../modules/agents/ports/publish-gate-checker.js";
import type { PublishAgentVersionActionResult } from "../../actions.js";
import type { SkillCatalogRow } from "../../../../../../modules/tools/application/list-skills.js";
import type {
  McpServerRow,
  McpToolRow,
} from "../../../../../../modules/tools/ports/mcp-server-repository.js";
import type { ApiConnectorCatalogRow } from "../../../../../../modules/tools/application/list-api-connectors.js";
import type { ToolBindingRow } from "../../../../../../modules/tools/ports/tool-binding-repository.js";
import type {
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
import { IdentityStep, InstructionsStep, ModelStep } from "./steps/basic-steps.js";
import { ToolsStep } from "./steps/tools-step.js";
import { KnowledgeStep } from "./steps/knowledge-step.js";
import { FlowsStep } from "./steps/flows-step.js";
import { TestStep } from "./steps/test-step.js";
import { ChannelsStep } from "./steps/channels-step.js";
import { GuardrailsStep } from "./steps/guardrails-step.js";
import { PublishStep } from "./steps/publish-step.js";

export interface WizardShellActions {
  readonly updateIdentity: typeof updateIdentityAction;
  readonly updateVersionConfig: typeof updateVersionConfigAction;
  readonly saveWizardDraftStep: typeof saveWizardDraftStepAction;
  readonly getDraftValidation: typeof getDraftValidationAction;
  readonly replaceChannelBindings: typeof replaceChannelBindingsAction;
  readonly setGuardrailOverride: typeof setGuardrailOverrideAction;
  readonly bindTool: typeof bindToolAction;
  readonly unbindTool: typeof unbindToolAction;
  readonly connectAndDiscoverMcpServer: typeof connectAndDiscoverMcpServerAction;
  readonly publishAgentVersion: typeof publishAgentVersionAction;
  readonly loadKnowledgeStepData: typeof loadKnowledgeStepDataAction;
  readonly replaceKnowledgeBindings: typeof replaceKnowledgeBindingsAction;
  readonly loadFlowsStepData: typeof loadFlowsStepDataAction;
  readonly createFlowNode: typeof createFlowNodeAction;
  readonly updateFlowNode: typeof updateFlowNodeAction;
  readonly deleteFlowNode: typeof deleteFlowNodeAction;
  readonly createFlowEdge: typeof createFlowEdgeAction;
  readonly updateFlowEdge: typeof updateFlowEdgeAction;
  readonly deleteFlowEdge: typeof deleteFlowEdgeAction;
  readonly setEntryNode: typeof setEntryNodeAction;
  readonly setEscapeNode: typeof setEscapeNodeAction;
  readonly proposeFlowEdit: typeof proposeFlowEditAction;
  readonly applyFlowEditPlan: typeof applyFlowEditPlanAction;
  readonly sendSandboxTurn: typeof sendSandboxTurnAction;
}

export interface WizardShellProps {
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
  readonly actions: WizardShellActions;
}

/** Every field this wizard edits, keyed by the step that owns it — the payload `onSaveDraft` serialises as `stepStateJson`, and what each step's local state is seeded from. */
interface FormState {
  name: string;
  description: string;
  systemPrompt: string;
  tone: Tone;
  primaryModel: string;
  fallbackModel: string;
  temperature: number;
  enabledChannelKeys: readonly ChannelKey[];
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

/**
 * FR-EVAL-08: a publish blocked by the B-9 gate must "name the agent, version, failing
 * set, its score, and the missed threshold" — a plain `t("publishError.gate_blocked")`
 * flat-key lookup (the shape every OTHER `reason` string here uses) cannot express this,
 * because the detail is structured data (`reasons[]`), not a string enum member. This
 * mirrors `evaluation`'s own `publish-gate-tab.tsx#toBlockingCondition` formatting (same
 * per-metric phrasing), duplicated rather than imported: this route may not import a
 * sibling feature module's UI file (`eslint.config.mjs`'s module-boundary rule), and the
 * formatting itself is presentational, not business logic, so a small local copy is the
 * correct shape here rather than a cross-feature dependency for a few lines of string work.
 */
function formatGateBlockedReason(t: Translator, reason: PublishGateBlockingReason): string {
  const isPercentAlready = reason.metric === "boundLocale";
  const observed = Math.round(isPercentAlready ? reason.observed : reason.observed * 100);
  const threshold = Math.round(isPercentAlready ? reason.threshold : reason.threshold * 100);
  switch (reason.metric) {
    case "boundLocale":
      return t("publishError.gateReason.boundLocale", {
        locale: reason.localeCode ?? "?",
        observed,
        threshold,
      });
    case "suiteFailure":
      return t("publishError.gateReason.suiteFailure");
    case "redTeam":
      return t("publishError.gateReason.redTeam", {
        goldenSetName: reason.goldenSetName ?? reason.metric,
        observed,
        threshold,
      });
    default:
      return t("publishError.gateReason.score", {
        goldenSetName: reason.goldenSetName ?? reason.metric,
        metric: reason.metric,
        observed,
        threshold,
      });
  }
}

function formatGateBlockedBanner(
  t: Translator,
  result: Extract<PublishAgentVersionActionResult, { reason: "gate_blocked" }>,
): string {
  const reasons = result.reasons.map((reason) => formatGateBlockedReason(t, reason));
  const reasonList =
    reasons.length > 0 ? reasons.join(" ") : t("publishError.gateReason.suiteFailure");
  return t("publishError.gate_blocked", {
    agentName: result.agentName,
    versionLabel: result.versionLabel,
    reasons: reasonList,
  });
}

/**
 * review-comments-3's "link with agent publish function": an agent version cannot publish
 * while any of its bound flows isn't ready — `checkFlowReadiness` (`agents/actions.ts`)
 * returns exactly which one and why, in the same closed reason set the old Flows-step
 * Publish button used to surface directly (`agents.wizard.flows.publishBlocked.*`, now moved
 * here since the whole flow-readiness gate is now checked at agent-publish time).
 */
function formatFlowNotReadyBanner(
  t: Translator,
  result: Extract<PublishAgentVersionActionResult, { reason: "flow_not_ready" }>,
): string {
  return t("publishError.flow_not_ready", {
    reason: t(`publishError.flowReason.${result.blockingReason}`, {
      defaultValue: result.blockingReason,
    }),
  });
}

export function WizardShell({
  agent,
  draft,
  draftVersion,
  channelBindings,
  knowledgeBindings,
  flowBindings,
  toolBindings,
  skills,
  mcpServers,
  mcpToolsByServer,
  apiConnectors,
  guardrails,
  missingSteps: initialMissingSteps,
  canPublish,
  actions,
}: WizardShellProps): React.ReactElement {
  const t = useTranslations("agents.wizard");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const registryHref = `/${locale}/agents`;
  const [activeStepId, setActiveStepId] = React.useState<WizardStepId>(
    WIZARD_STEP_IDS[draft.lastStep - 1] ?? "identity",
  );
  const [missingSteps, setMissingSteps] =
    React.useState<readonly WizardStepId[]>(initialMissingSteps);
  const [stepDone, setStepDone] = React.useState<Partial<Record<WizardStepId, boolean>>>({
    instructions: draftVersion.systemPrompt.trim().length > 0,
    model: true,
    tools: toolBindings.length > 0,
    // Same "reasonable initial guess before the step's own load resolves the real state"
    // reasoning as `flows` below — `KnowledgeStep`'s own `onBindingsChange` corrects this
    // once its load completes.
    knowledge: knowledgeBindings.some((b) => b.isEnabled),
    // A real flow binding already existing is a reasonable initial guess before
    // `FlowsStep`'s own load resolves the true "has at least one node" state via
    // `onNodesChange` below — avoids a flash of "untouched" on reopening a flow that was
    // already built.
    flows: flowBindings.length > 0,
    guardrails: true,
  });
  const [formState, setFormState] = React.useState<FormState>({
    name: agent.name,
    description: agent.description ?? "",
    systemPrompt: draftVersion.systemPrompt,
    tone: draftVersion.tone,
    primaryModel: draftVersion.primaryModel,
    fallbackModel: draftVersion.fallbackModel ?? "",
    temperature: draftVersion.temperature,
    enabledChannelKeys: channelBindings.filter((b) => b.isEnabled).map((b) => b.channelKey),
  });
  const [banner, setBanner] = React.useState<{
    readonly kind: "error" | "success";
    readonly text: string;
  } | null>(null);
  const [publishing, setPublishing] = React.useState(false);

  async function refreshValidation(): Promise<void> {
    const result = await actions.getDraftValidation({
      agentId: agent.id,
      agentVersionId: draft.agentVersionId,
    });
    setMissingSteps(result.missingSteps);
  }

  const stepStatus = React.useCallback(
    (stepId: WizardStepId): WizardStepStatus => {
      if (stepId === "publish") return missingSteps.length > 0 ? "blocked" : "in-progress";
      if (stepId === "identity" || stepId === "channels") {
        return missingSteps.includes(stepId) ? "invalid" : "complete";
      }
      if (stepId === "test") return "untouched";
      return stepDone[stepId] ? "complete" : "untouched";
    },
    [missingSteps, stepDone],
  );

  const steps: readonly WizardStep[] = WIZARD_STEP_IDS.map((stepId) => ({
    id: stepId,
    label: t(`steps.${stepId}`),
    status: stepStatus(stepId),
  }));

  /** What "Publish" would make this version's label become — v0.x drafts jump to v1.0; a re-forked draft off a Published version stays the same major.minor it already carries. */
  const publishedLabel =
    draftVersion.status === "Draft" && draftVersion.version.major === 0
      ? `v${publishedVersionNumber(draftVersion.version).major}.${publishedVersionNumber(draftVersion.version).minor}`
      : draftVersion.label;

  function goToStep(stepId: WizardStepId): void {
    setActiveStepId(stepId);
  }

  function nextStepId(): WizardStepId | null {
    const index = WIZARD_STEP_IDS.indexOf(activeStepId);
    return WIZARD_STEP_IDS[index + 1] ?? null;
  }

  async function persistDraftState(stepId: string): Promise<void> {
    await actions.saveWizardDraftStep({
      draftId: draft.id,
      lastStep: WIZARD_STEP_IDS.indexOf(activeStepId) + 1,
      stepStateJson: JSON.stringify(formState),
    });
    void stepId;
  }

  async function handleSaveAndContinue(): Promise<void> {
    setBanner(null);
    try {
      switch (activeStepId) {
        case "identity": {
          const result = await actions.updateIdentity({
            agentId: agent.id,
            name: formState.name,
            description:
              formState.description.trim().length > 0 ? formState.description.trim() : null,
          });
          if (!result.ok) return setBanner({ kind: "error", text: result.error });
          await refreshValidation();
          break;
        }
        case "instructions": {
          const result = await actions.updateVersionConfig({
            agentVersionId: draft.agentVersionId,
            systemPrompt: formState.systemPrompt,
            tone: formState.tone,
          });
          if (!result.ok)
            return setBanner({
              kind: "error",
              text: t(`immutableError`, { message: result.message }),
            });
          setStepDone((current) => ({
            ...current,
            instructions: formState.systemPrompt.trim().length > 0,
          }));
          break;
        }
        case "model": {
          const result = await actions.updateVersionConfig({
            agentVersionId: draft.agentVersionId,
            primaryModel: formState.primaryModel,
            fallbackModel:
              formState.fallbackModel.trim().length > 0 ? formState.fallbackModel.trim() : null,
            temperature: formState.temperature,
          });
          if (!result.ok)
            return setBanner({
              kind: "error",
              text: t(`immutableError`, { message: result.message }),
            });
          break;
        }
        case "channels": {
          const result = await actions.replaceChannelBindings({
            agentVersionId: draft.agentVersionId,
            bindings: formState.enabledChannelKeys.map((channelKey) => ({
              channelKey,
              isEnabled: true,
            })),
          });
          if (!result.ok) return setBanner({ kind: "error", text: result.error });
          await refreshValidation();
          break;
        }
        default:
          // tools/knowledge/flows/guardrails/test each persist their own field-level
          // changes immediately (bind/unbind, guardrail overrides) rather than through
          // this batched commit — "Save & continue" on those steps only navigates.
          break;
      }
      await persistDraftState(activeStepId);
      const next = nextStepId();
      if (next) setActiveStepId(next);
    } catch (error) {
      setBanner({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handlePublish(): Promise<void> {
    setBanner(null);
    setPublishing(true);
    try {
      const result = await actions.publishAgentVersion({
        agentId: agent.id,
        agentVersionId: draft.agentVersionId,
        changeSummary: null,
      });
      if (!result.ok) {
        setBanner({
          kind: "error",
          text:
            result.reason === "gate_blocked"
              ? formatGateBlockedBanner(t, result)
              : result.reason === "flow_not_ready"
                ? formatFlowNotReadyBanner(t, result)
                : t(`publishError.${result.reason}`, { defaultValue: result.reason }),
        });
        return;
      }
      setBanner({ kind: "success", text: t("publishSuccess", { label: result.label }) });
      router.push(registryHref);
      router.refresh();
    } catch (error) {
      setBanner({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">
        {t("editPageTitle", { name: agent.name })}
      </h1>
      {banner ? (
        <InlineAlert variant={banner.kind === "error" ? "destructive" : "warning"}>
          {banner.text}
        </InlineAlert>
      ) : null}
      <Wizard
        steps={steps}
        activeStepId={activeStepId}
        onStepChange={(stepId) => goToStep(stepId as WizardStepId)}
        onBack={() => {
          const index = WIZARD_STEP_IDS.indexOf(activeStepId);
          const previous = WIZARD_STEP_IDS[index - 1];
          if (previous) setActiveStepId(previous);
        }}
        onSaveAndContinue={() => void handleSaveAndContinue()}
        onPublish={() => void handlePublish()}
        onSaveDraft={(stepId) => persistDraftState(stepId)}
        hideHeadingForStepIds={["flows"]}
        ariaLabel={t("ariaLabel")}
        backLabel={t("backLabel")}
        saveAndContinueLabel={t("saveAndContinueLabel")}
        publishLabel={canPublish ? t("publishLabel") : t("publishLabelNoPermission")}
        saveDraftLabel={t("saveDraftLabel")}
        savingDraftLabel={t("savingDraftLabel")}
        draftSavedLabel={t("draftSavedLabel")}
        draftErrorLabel={t("draftErrorLabel")}
        renderStep={(step, stepIndex, { notifyDirty }) => {
          void stepIndex; // unused — `Wizard` always passes it, this shell keys off `step.id` instead
          switch (step.id as WizardStepId) {
            case "identity":
              return (
                <IdentityStep
                  name={formState.name}
                  description={formState.description}
                  ownerTenantId={agent.ownerTenantId}
                  onChange={(patch) => {
                    setFormState((s) => ({ ...s, ...patch }));
                    notifyDirty();
                  }}
                />
              );
            case "instructions":
              return (
                <InstructionsStep
                  systemPrompt={formState.systemPrompt}
                  tone={formState.tone}
                  onChange={(patch) => {
                    setFormState((s) => ({ ...s, ...patch }));
                    notifyDirty();
                  }}
                />
              );
            case "model":
              return (
                <ModelStep
                  primaryModel={formState.primaryModel}
                  fallbackModel={formState.fallbackModel}
                  temperature={formState.temperature}
                  onChange={(patch) => {
                    setFormState((s) => ({ ...s, ...patch }));
                    notifyDirty();
                  }}
                />
              );
            case "tools":
              return (
                <ToolsStep
                  agentVersionId={draft.agentVersionId}
                  skills={skills}
                  mcpServers={mcpServers}
                  mcpToolsByServer={mcpToolsByServer}
                  apiConnectors={apiConnectors}
                  initialBindings={toolBindings}
                  bindTool={actions.bindTool}
                  unbindTool={actions.unbindTool}
                  connectAndDiscoverMcpServer={actions.connectAndDiscoverMcpServer}
                  onBindingsChange={(hasAny) =>
                    setStepDone((current) => ({ ...current, tools: hasAny }))
                  }
                />
              );
            case "knowledge":
              return (
                <KnowledgeStep
                  agentVersionId={draft.agentVersionId}
                  loadKnowledgeStepData={actions.loadKnowledgeStepData}
                  replaceKnowledgeBindings={actions.replaceKnowledgeBindings}
                  onBindingsChange={(hasAny) =>
                    setStepDone((current) => ({ ...current, knowledge: hasAny }))
                  }
                />
              );
            case "flows":
              return (
                <FlowsStep
                  agentVersionId={draft.agentVersionId}
                  ownerTenantId={agent.ownerTenantId}
                  agentName={agent.name}
                  toolBindings={toolBindings}
                  skills={skills}
                  mcpServers={mcpServers}
                  mcpToolsByServer={mcpToolsByServer}
                  apiConnectors={apiConnectors}
                  loadFlowsStepData={actions.loadFlowsStepData}
                  createFlowNode={actions.createFlowNode}
                  updateFlowNode={actions.updateFlowNode}
                  deleteFlowNode={actions.deleteFlowNode}
                  createFlowEdge={actions.createFlowEdge}
                  updateFlowEdge={actions.updateFlowEdge}
                  deleteFlowEdge={actions.deleteFlowEdge}
                  setEntryNode={actions.setEntryNode}
                  setEscapeNode={actions.setEscapeNode}
                  proposeFlowEdit={actions.proposeFlowEdit}
                  applyFlowEditPlan={actions.applyFlowEditPlan}
                  onNodesChange={(hasAny) =>
                    setStepDone((current) => ({ ...current, flows: hasAny }))
                  }
                />
              );
            case "guardrails":
              return (
                <GuardrailsStep
                  agentId={agent.id}
                  guardrails={guardrails}
                  setGuardrailOverride={actions.setGuardrailOverride}
                />
              );
            case "channels":
              return (
                <ChannelsStep
                  enabledChannelKeys={formState.enabledChannelKeys}
                  onChange={(keys) => {
                    setFormState((s) => ({ ...s, enabledChannelKeys: keys }));
                    notifyDirty();
                  }}
                />
              );
            case "test":
              return (
                <TestStep
                  agentId={agent.id}
                  agentVersionId={draft.agentVersionId}
                  ownerTenantId={agent.ownerTenantId}
                  agentName={agent.name}
                  locale={locale}
                  loadFlowsStepData={actions.loadFlowsStepData}
                  sendSandboxTurn={actions.sendSandboxTurn}
                />
              );
            case "publish":
              return (
                <PublishStep
                  currentLabel={draftVersion.label}
                  publishedLabel={publishedLabel}
                  blocked={missingSteps.length > 0}
                  missingSteps={missingSteps}
                  canPublish={canPublish}
                  publishing={publishing}
                />
              );
            default:
              return null;
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => router.push(registryHref)}
      >
        {t("backToRegistry")}
      </Button>
    </div>
  );
}
