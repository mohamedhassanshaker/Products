"use server";

/**
 * Server Actions for `/agents` (B2 registry) and the B3 wizard (`/agents/new`,
 * `/agents/[id]/edit`) — every write either screen performs.
 *
 * Every action requires `agents:manage`, except `publishAgentVersionAction`, which requires
 * `agents:publish` — the separation of duties `iam.roles.ruleSummary` names: Agent Designer
 * can build (`agents:manage`) but only Super Admin/Entity Admin can publish. Checked here,
 * the caller, matching `iam/actions.ts`'s own convention (the use case itself never checks
 * it — api.md §12 invariant 2).
 *
 * Mirrors `iam/actions.ts`'s error-handling shape: each action catches its own use case's
 * thrown errors and returns a structured `{ok:false, error}` rather than letting them surface
 * as Next's generic unhandled Server Action error overlay. Where a use case already returns a
 * discriminated `{ok:false, reason:"..."}` result (almost everything in `modules/agents`/
 * `modules/tools` — see those modules' own doc comments: business-rule failures are values,
 * not thrown errors), that structured result is returned directly rather than collapsed into
 * a string, exactly like `updateRolePermissionsAction` already does for the one IAM action
 * whose caller needs to distinguish *which* rejection reason it got.
 */

import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { CreateAgent } from "../../../../modules/agents/application/create-agent.js";
import { CloneAgent } from "../../../../modules/agents/application/clone-agent.js";
import { PublishAgentVersion } from "../../../../modules/agents/application/publish-agent-version.js";
import type { PublishAgentVersionResult } from "../../../../modules/agents/application/publish-agent-version.js";
import { UnpublishAgent } from "../../../../modules/agents/application/unpublish-agent.js";
import { ArchiveAgent } from "../../../../modules/agents/application/archive-agent.js";
import { RollbackAgentVersion } from "../../../../modules/agents/application/rollback-agent-version.js";
import { EditAgent } from "../../../../modules/agents/application/edit-agent.js";
import { UpdateAgentVersionConfig } from "../../../../modules/agents/application/update-agent-version-config.js";
import {
  GetVersionHistory,
  ListAgentVersions,
} from "../../../../modules/agents/application/get-version-history.js";
import type {
  AgentVersionHistoryEntryRow,
  AgentVersionSummary,
} from "../../../../modules/agents/ports/agent-repository.js";
import { SaveWizardDraftStep } from "../../../../modules/agents/application/save-wizard-draft-step.js";
import { GetDraftValidation } from "../../../../modules/agents/application/get-draft-validation.js";
import { ReplaceChannelBindings } from "../../../../modules/agents/application/replace-channel-bindings.js";
import { ReplaceFlowBindings } from "../../../../modules/agents/application/replace-flow-bindings.js";
import { SetGuardrailOverride } from "../../../../modules/agents/application/set-guardrail-override.js";
import { ReplaceKnowledgeBindings } from "../../../../modules/agents/application/replace-knowledge-bindings.js";
import type {
  ChannelBindingRow,
  KnowledgeBindingRow,
} from "../../../../modules/agents/ports/agent-bindings-repository.js";
import type { KnowledgeCollectionRow } from "../../../../modules/knowledge/ports/knowledge-source-repository.js";
import type { Tone, WizardStepId } from "../../../../modules/agents/domain/agent.js";
import { GetOrCreateDraftFlowVersion } from "../../../../modules/flows/application/get-or-create-draft-flow-version.js";
import { GetFlowCanvas } from "../../../../modules/flows/application/get-flow-canvas.js";
import { PublishFlowVersion } from "../../../../modules/flows/application/publish-flow-version.js";
import type { PublishFlowVersionResult } from "../../../../modules/flows/application/publish-flow-version.js";
import { canPublishFlowVersion } from "../../../../modules/flows/domain/flow-version.js";
import type { FlowRepository } from "../../../../modules/flows/ports/flow-repository.js";
import { buildFlowCanvasModel } from "./[id]/edit/steps/flow-canvas-mapping.js";
import { hasFreeTextEscapePath } from "../../../../components/patterns/flow-canvas/flow-canvas-types.js";
import { CreateFlowNode } from "../../../../modules/flows/application/create-flow-node.js";
import { UpdateFlowNode } from "../../../../modules/flows/application/update-flow-node.js";
import { DeleteFlowNode } from "../../../../modules/flows/application/delete-flow-node.js";
import { CreateFlowEdge } from "../../../../modules/flows/application/create-flow-edge.js";
import { UpdateFlowEdge } from "../../../../modules/flows/application/update-flow-edge.js";
import { DeleteFlowEdge } from "../../../../modules/flows/application/delete-flow-edge.js";
import { SetEntryNode } from "../../../../modules/flows/application/set-entry-node.js";
import { SetEscapeNode } from "../../../../modules/flows/application/set-escape-node.js";
import { GetFlowAssistantConfig } from "../../../../modules/flows/application/get-flow-assistant-config.js";
import { GUARDRAIL_POLICY_KEYS } from "../../../../modules/agents/application/get-guardrail-settings.js";
import { WIZARD_CHANNEL_KEYS } from "../../../../modules/agents/domain/agent.js";
import type { ChannelKey } from "../../../../modules/agents/domain/agent.js";
import type {
  AgentCreationPlan,
  GuardrailOverrideProposal as AgentCreationGuardrailOverride,
  ToolBindingProposal as AgentCreationToolBinding,
} from "../../../../modules/agents/ports/agent-creation-ai-client.js";
import { UpdateFlowAssistantConfig } from "../../../../modules/flows/application/update-flow-assistant-config.js";
import type { UpdateFlowAssistantConfigResult } from "../../../../modules/flows/application/update-flow-assistant-config.js";
import type { FlowNodeFields } from "../../../../modules/flows/domain/flow-node.js";
import type { FlowEdgeFields } from "../../../../modules/flows/domain/flow-edge.js";
import type {
  FlowEdgeRow,
  FlowNodeRow,
  FlowVersionRow,
} from "../../../../modules/flows/ports/flow-repository.js";
import type { SendSandboxTurnResult } from "../../../../modules/flows/ports/flow-sandbox-client.js";
import type {
  FlowEditConversationTurn,
  FlowEditOperation,
  FlowEditOperationKind,
} from "../../../../modules/flows/ports/flow-edit-ai-client.js";
import { BindTool } from "../../../../modules/tools/application/bind-tool.js";
import { UnbindTool } from "../../../../modules/tools/application/unbind-tool.js";
import { ConnectAndDiscoverMcpServer } from "../../../../modules/tools/application/connect-and-discover-mcp-server.js";
import { ListSkills } from "../../../../modules/tools/application/list-skills.js";
import { ListMcpServers } from "../../../../modules/tools/application/list-mcp-servers.js";
import { ListApiConnectors } from "../../../../modules/tools/application/list-api-connectors.js";
import type {
  RequiredAssuranceLevel,
  ToolBindingTargetKind,
} from "../../../../modules/tools/domain/tool-catalog.js";
import {
  agentBindingsRepository,
  agentCreationAiClient,
  agentRepository,
  apiConnectorRepository,
  flowAssistantConfigRepository,
  flowEditAiClient,
  flowRepository,
  flowSandboxClient,
  knowledgeSourceRepository,
  mcpDiscoveryClient,
  mcpServerRepository,
  policyOverrideRepository,
  publishGateChecker,
  realClock,
  resolveOwnerTenantId,
  skillRepository,
  toolBindingRepository,
  wizardDraftRepository,
} from "./composition.js";

const MANAGE_PERMISSION = "agents:manage" as const;
const PUBLISH_PERMISSION = "agents:publish" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The specific reason a flow version isn't ready to publish — the closed set both `publishFlowVersionAction` and the agent-publish path below can return. */
export type FlowReadinessBlockedReason =
  | "flows.escape_path_unreachable"
  | "flows.already_published"
  | "flows.entry_node_required"
  | "flows.escape_node_required";

/**
 * A pure, read-only readiness check for one flow version — never writes anything, so it is
 * safe to run for every bound flow *before* an agent version publish is allowed to proceed
 * (review-comments-3: "link with agent publish function" — an agent must not publish with a
 * flow that isn't ready). Mirrors `PublishFlowVersion.execute()`'s own checks
 * (`canPublishFlowVersion`, entry/escape presence) plus the one check that use case cannot
 * perform itself (R3/`hasFreeTextEscapePath`, which needs `buildFlowCanvasModel` — outside
 * what `modules/flows` may import). `PublishFlowVersion.execute()` re-checks the same
 * canPublishFlowVersion/entry/escape rules internally when actually called — this is
 * deliberate, harmless redundancy (defense in depth), not a maintenance hazard: the two call
 * sites answer different questions ("is it safe to check?" vs. "is it safe to write?").
 */
async function checkFlowReadiness(
  flows: FlowRepository,
  flowVersionId: string,
): Promise<{ readonly ready: true } | { readonly ready: false; readonly reason: FlowReadinessBlockedReason }> {
  const version = await flows.getFlowVersion(flowVersionId);
  if (!version) {
    throw new Error(
      `Cannot check readiness for flow version "${flowVersionId}": no such version.`,
    );
  }

  const check = canPublishFlowVersion(version.status);
  if (!check.allowed) return { ready: false, reason: check.reason };
  if (!version.entryNodeId) return { ready: false, reason: "flows.entry_node_required" };
  if (!version.escapeNodeId || !version.freeTextEscapeEnabled) {
    return { ready: false, reason: "flows.escape_node_required" };
  }

  const canvas = await new GetFlowCanvas({ flows }).execute({ flowVersionId });
  const model = buildFlowCanvasModel(canvas.nodes, canvas.edges);
  if (!hasFreeTextEscapePath(model)) {
    return { ready: false, reason: "flows.escape_path_unreachable" };
  }

  return { ready: true };
}

/**
 * Publishes one already-readiness-checked flow version — nothing else. Called only from
 * `publishAgentVersionAction`, strictly AFTER `PublishAgentVersion.execute()` has already
 * succeeded, which is exactly why this must NOT also fork a fresh Draft and re-point the
 * `AgentFlowBinding` at it the way `flows-step.tsx`'s old, now-removed standalone Publish
 * button used to: by this point the AgentVersion itself is already Published, and
 * `TR_AgentFlowBindings_publishedNeedsPublishedFlow` (`prisma/sql/001_constraints.sql`)
 * correctly forbids a Published agent version from binding a Draft flow version — a real bug
 * this function used to have (confirmed live: publishing threw `error 51111` after both rows
 * had already flipped to Published, leaving the binding stuck on the old flow version) until
 * this fix. The existing `AgentFlowBinding` already points at exactly this `flowVersionId`;
 * once that row is Published, the binding is trivially valid with no rebind at all. The next
 * time this agent is edited, a new draft `AgentVersion` is forked (this codebase's existing,
 * unrelated draft-resolution path) and `loadFlowsStepDataAction` forks/binds a fresh Draft
 * flow for THAT version, exactly as it already does for a brand-new agent version — there is
 * no "keep editing in place" case for a version that was just published and immediately
 * navigated away from (`wizard-shell.tsx`'s own `handlePublish` redirects to the registry).
 */
async function publishOneFlow(
  flows: FlowRepository,
  input: {
    readonly flowVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  },
): Promise<PublishFlowVersionResult> {
  return new PublishFlowVersion({ flows }).execute(input);
}

// ---------------------------------------------------------------------------
// Registry (B2)
// ---------------------------------------------------------------------------

export async function createAgentAction(input: {
  readonly name: string;
  readonly description: string | null;
}): Promise<ActionResult<{ readonly agentId: string; readonly agentVersionId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.createAgent");
        const ownerTenantId = await resolveOwnerTenantId();
        const result = await new CreateAgent({ agents: agentRepository() }).execute({
          name: input.name,
          description: input.description,
          ownerTenantId,
          createdByStaffUserId: principal.id,
          now: realClock().now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function cloneAgentAction(sourceAgentId: string): Promise<
  ActionResult<{
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly sourceLabel: string;
  }>
> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.cloneAgent");
        const result = await new CloneAgent({ agents: agentRepository() }).execute({
          sourceAgentId,
          actorStaffUserId: principal.id,
          now: realClock().now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { sourceAgentId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * B2 registry's real Publish action and B3 step 10's own Publish button.
 *
 * review-comments-3 ("remove [the flows step's own] publish and link with agent publish
 * function"): a flow no longer has its own manual publish affordance — publishing the agent
 * version now publishes every one of its enabled bound flows too, and blocks entirely
 * (before the agent version itself is touched) if any of them isn't ready. This is checked
 * BEFORE `PublishAgentVersion.execute()` is ever called — true all-or-nothing, mirroring how
 * `publishFlowVersionAction` already checks R3 before its own use case — so a blocked flow
 * never leaves the agent version published with a Draft flow silently left behind.
 */
export type PublishAgentVersionActionResult =
  | PublishAgentVersionResult
  | {
      readonly ok: false;
      readonly reason: "flow_not_ready";
      readonly flowId: string;
      readonly flowVersionId: string;
      readonly blockingReason: FlowReadinessBlockedReason;
    };

export async function publishAgentVersionAction(input: {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly changeSummary: string | null;
}): Promise<PublishAgentVersionActionResult> {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, PUBLISH_PERMISSION, "agents.publishAgentVersion");
      const flows = flowRepository();
      const bindings = agentBindingsRepository();
      const now = realClock().now();

      const flowBindings = await bindings.listFlowBindings(input.agentVersionId);
      const enabledFlowBindings = flowBindings.filter((b) => b.isEnabled);

      for (const binding of enabledFlowBindings) {
        const readiness = await checkFlowReadiness(flows, binding.flowVersionId);
        if (!readiness.ready) {
          return {
            ok: false,
            reason: "flow_not_ready",
            flowId: binding.flowId,
            flowVersionId: binding.flowVersionId,
            blockingReason: readiness.reason,
          } as const;
        }
      }

      const result = await new PublishAgentVersion({
        agents: agentRepository(),
        drafts: wizardDraftRepository(),
        // FR-AGENT-20 (B-9): the evaluation publish gate. See `publishGateChecker()`'s
        // own doc comment for why this is wired here (composition root) rather than
        // imported inside `modules/agents` itself.
        gate: publishGateChecker(),
      }).execute({ ...input, actorStaffUserId: principal.id, now });
      if (!result.ok) return result;

      if (enabledFlowBindings.length > 0) {
        for (const binding of enabledFlowBindings) {
          const flowResult = await publishOneFlow(flows, {
            flowVersionId: binding.flowVersionId,
            changeSummary: input.changeSummary,
            actorStaffUserId: principal.id,
            now,
          });
          if (!flowResult.ok) {
            // `checkFlowReadiness` already validated this exact flow version moments ago —
            // reaching this branch means it changed underneath us (a genuine concurrent-edit
            // race), not routine user error. Thrown, not returned: this file's own established
            // convention (`publishAgentVersionAction` has never wrapped itself in try/catch —
            // the caller, `wizard-shell.tsx`'s own `handlePublish`, already catches and
            // reports unexpected throws) is the honest response to a truly unexpected state,
            // not a reason to invent a new user-facing branch for something that should not
            // happen.
            throw new Error(
              `Flow "${binding.flowId}" failed to publish alongside its agent version despite ` +
                `passing its own readiness check moments earlier (reason: "${flowResult.reason}") ` +
                "— likely a concurrent edit.",
            );
          }
        }
      }

      return result;
    },
    { method: "POST", body: input },
  );
}

export async function unpublishAgentAction(agentId: string) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, PUBLISH_PERMISSION, "agents.unpublishAgent");
      return new UnpublishAgent({ agents: agentRepository() }).execute({
        agentId,
        actorStaffUserId: principal.id,
        now: realClock().now(),
      });
    },
    { method: "POST", body: { agentId } },
  );
}

export async function archiveAgentAction(agentId: string) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.archiveAgent");
      return new ArchiveAgent({ agents: agentRepository() }).execute({
        agentId,
        actorStaffUserId: principal.id,
        now: realClock().now(),
      });
    },
    { method: "POST", body: { agentId } },
  );
}

export async function rollbackAgentVersionAction(input: {
  readonly agentId: string;
  readonly targetVersionId: string;
}) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.rollbackAgentVersion");
      return new RollbackAgentVersion({ agents: agentRepository() }).execute({
        ...input,
        actorStaffUserId: principal.id,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

/** Loads B2's "Version history" panel on demand — mirrors `loadUserEditContextAction`'s identical on-demand shape. */
export async function loadVersionHistoryAction(agentId: string): Promise<
  ActionResult<{
    readonly entries: readonly AgentVersionHistoryEntryRow[];
    readonly versions: readonly AgentVersionSummary[];
  }>
> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.loadVersionHistory");
        const [{ entries }, { versions }] = await Promise.all([
          new GetVersionHistory({ agents: agentRepository() }).execute({ agentId }),
          new ListAgentVersions({ agents: agentRepository() }).execute({ agentId }),
        ]);
        return { ok: true, value: { entries, versions } } as const;
      },
      { method: "POST", body: { agentId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Wizard (B3)
// ---------------------------------------------------------------------------

export async function saveWizardDraftStepAction(input: {
  readonly draftId: string;
  readonly lastStep: number;
  readonly stepStateJson: string;
}): Promise<void> {
  await withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.saveWizardDraftStep");
      await new SaveWizardDraftStep({ drafts: wizardDraftRepository() }).execute({
        ...input,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

export async function getDraftValidationAction(input: {
  readonly agentId: string;
  readonly agentVersionId: string;
}): Promise<{ readonly complete: boolean; readonly missingSteps: readonly WizardStepId[] }> {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.getDraftValidation");
      return new GetDraftValidation({
        agents: agentRepository(),
        bindings: agentBindingsRepository(),
      }).execute(input);
    },
    { method: "POST", body: input },
  );
}

export async function updateIdentityAction(input: {
  readonly agentId: string;
  readonly name?: string;
  readonly description?: string | null;
}): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.updateIdentity");
        await new EditAgent({ agents: agentRepository() }).execute(input);
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updateVersionConfigAction(input: {
  readonly agentVersionId: string;
  readonly systemPrompt?: string;
  readonly tone?: Tone;
  readonly primaryModel?: string;
  readonly fallbackModel?: string | null;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.updateVersionConfig");
      return new UpdateAgentVersionConfig({ agents: agentRepository() }).execute({
        ...input,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

export async function replaceChannelBindingsAction(input: {
  readonly agentVersionId: string;
  readonly bindings: readonly ChannelBindingRow[];
}): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.replaceChannelBindings");
        await new ReplaceChannelBindings({ bindings: agentBindingsRepository() }).execute({
          ...input,
          now: realClock().now(),
        });
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function setGuardrailOverrideAction(input: {
  readonly agentId: string;
  readonly policyKey: string;
  readonly mode: "Value" | "Disabled";
  readonly valueJson: string | null;
  readonly reason: string;
}) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.setGuardrailOverride");
      return new SetGuardrailOverride({ policies: policyOverrideRepository() }).execute({
        ...input,
        actorStaffUserId: principal.id,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

export async function bindToolAction(input: {
  readonly agentVersionId: string;
  readonly targetKind: ToolBindingTargetKind;
  readonly targetId: string;
  readonly requiredAssurance: RequiredAssuranceLevel;
}) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.bindTool");
      return new BindTool({ bindings: toolBindingRepository() }).execute({
        ...input,
        actorStaffUserId: principal.id,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

export async function unbindToolAction(input: {
  readonly agentVersionId: string;
  readonly targetKind: ToolBindingTargetKind;
  readonly targetId: string;
}) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.unbindTool");
      return new UnbindTool({ bindings: toolBindingRepository() }).execute(input);
    },
    { method: "POST", body: input },
  );
}

/** Wizard step 4 sub-tab B's "Connect & discover" — same use case `/tools` tab 2 calls, real shared data. */
export async function connectAndDiscoverMcpServerAction(mcpServerId: string) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.connectAndDiscoverMcpServer");
      return new ConnectAndDiscoverMcpServer({
        servers: mcpServerRepository(),
        discovery: mcpDiscoveryClient(),
      }).execute({ mcpServerId, now: realClock().now() });
    },
    { method: "POST", body: { mcpServerId } },
  );
}

// ---------------------------------------------------------------------------
// Knowledge (B3 step 5) — review-comments-3: this step used to be a permanent stub
// ("Knowledge collections aren't available yet") even though B6/B-4's real
// `KnowledgeCollection`/`AgentKnowledgeBindings` tables, and the `ReplaceKnowledgeBindings`
// use case, already existed and were already tested — only the step's own UI, and these two
// actions, were missing.
// ---------------------------------------------------------------------------

/**
 * Resolves the tenant's one real `KnowledgeCollection` (lazily created on first use,
 * `KnowledgeSourceRepository.ensureDefaultCollection` — B6 ships no multi-collection picker,
 * so binding is a single enable/disable toggle, not a selection among many) plus this agent
 * version's current bindings — the wizard's step 5 initial load, mirroring
 * `loadFlowsStepDataAction`'s identical "this step resolves its own backing resource lazily"
 * shape.
 */
export async function loadKnowledgeStepDataAction(input: {
  readonly agentVersionId: string;
}): Promise<
  ActionResult<{
    readonly collection: KnowledgeCollectionRow;
    readonly bindings: readonly KnowledgeBindingRow[];
  }>
> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.loadKnowledgeStepData");
        const [collection, bindings] = await Promise.all([
          knowledgeSourceRepository().ensureDefaultCollection(realClock().now()),
          agentBindingsRepository().listKnowledgeBindings(input.agentVersionId),
        ]);
        return { ok: true, value: { collection, bindings } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function replaceKnowledgeBindingsAction(input: {
  readonly agentVersionId: string;
  readonly bindings: readonly KnowledgeBindingRow[];
}): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.replaceKnowledgeBindings");
        await new ReplaceKnowledgeBindings({ bindings: agentBindingsRepository() }).execute({
          agentVersionId: input.agentVersionId,
          bindings: input.bindings,
          boundByStaffUserId: principal.id,
          now: realClock().now(),
        });
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Flows (B3 step 6 — B7's authoring layer over B5's execution engine)
// ---------------------------------------------------------------------------

/**
 * Resolves (creating if necessary) the one `Flow`/`FlowVersion` this agent version authors
 * against, then returns its full canvas — the wizard's step 6 initial load.
 *
 * Composes two feature modules deliberately at this app layer: `modules/flows` owns
 * `Flow`/`FlowVersion`/`FlowNode`/`FlowEdge` and knows nothing of agents;
 * `modules/agents`' `AgentBindingsRepository`/`ReplaceFlowBindings` own `AgentFlowBinding`
 * (which flow(s) this agent version uses) and know nothing of a flow's internal canvas. A
 * feature module may not import a sibling feature module (`eslint.config.mjs`'s
 * `boundaries/element-types`) — `composition.ts`'s own doc comment names this file as the
 * one sanctioned place that kind of structural cross-feature wiring happens.
 *
 * Binds the resolved flow with `ordinal: 0` ahead of whatever else this agent version might
 * already have bound, and re-points the binding whenever `GetOrCreateDraftFlowVersion` forks
 * a fresh Draft off a Published version (the previous binding would otherwise keep pointing
 * at an immutable snapshot the wizard can no longer edit).
 */
export async function loadFlowsStepDataAction(input: {
  readonly agentVersionId: string;
  readonly ownerTenantId: string;
  /** Used only the first time this agent version has no bound flow yet. */
  readonly newFlowName: string;
}): Promise<
  ActionResult<{
    readonly flowId: string;
    readonly flowVersionId: string;
    readonly version: FlowVersionRow;
    readonly nodes: readonly FlowNodeRow[];
    readonly edges: readonly FlowEdgeRow[];
  }>
> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.loadFlowsStepData");
        const bindings = agentBindingsRepository();
        const flows = flowRepository();
        const now = realClock().now();

        const existingBindings = await bindings.listFlowBindings(input.agentVersionId);
        const primary = existingBindings[0] ?? null;

        const { flowId, flowVersionId } = await new GetOrCreateDraftFlowVersion({ flows }).execute({
          existingFlowId: primary?.flowId ?? null,
          existingFlowVersionId: primary?.flowVersionId ?? null,
          newFlowName: input.newFlowName,
          ownerTenantId: input.ownerTenantId,
          actorStaffUserId: principal.id,
          now,
        });

        if (!primary || primary.flowVersionId !== flowVersionId) {
          const nextBindings = [
            { flowId, flowVersionId, isEnabled: true, ordinal: 0 },
            ...existingBindings
              .filter((b) => b.flowId !== flowId)
              .map((b, index) => ({ ...b, ordinal: index + 1 })),
          ];
          await new ReplaceFlowBindings({ bindings }).execute({
            agentVersionId: input.agentVersionId,
            bindings: nextBindings,
            now,
          });
        }

        const canvas = await new GetFlowCanvas({ flows }).execute({ flowVersionId });
        return { ok: true, value: { flowId, flowVersionId, ...canvas } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * Flow publishing is no longer its own standalone action (review-comments-3: "remove
 * publish and link with agent publish function") — the Flows step's manual Publish button is
 * gone, and publishing a flow only ever happens as part of publishing the agent version that
 * binds it (`publishAgentVersionAction` above, via the shared `checkFlowReadiness`/
 * `publishOneFlow` helpers it and this module's own flow CRUD actions rely on). There is
 * deliberately no `publishFlowVersionAction` anymore — keeping an unreachable one around
 * once its one real caller (`flows-step.tsx`'s old Publish button) was removed would be dead
 * code, not a reusable capability nothing has asked for.
 */

export async function createFlowNodeAction(
  input: FlowNodeFields & { readonly flowVersionId: string },
) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.createFlowNode");
      return new CreateFlowNode({ flows: flowRepository() }).execute({
        ...input,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

export async function updateFlowNodeAction(input: {
  readonly id: string;
  readonly flowVersionId: string;
  readonly title?: string;
  readonly canvasX?: number;
  readonly canvasY?: number;
  readonly messageText?: string | null;
  readonly quickActionSetKey?: string | null;
  readonly slotName?: string | null;
  readonly optionSourceKind?: FlowNodeFields["optionSourceKind"];
  readonly optionSourceRef?: string | null;
  readonly staticOptionsJson?: string | null;
  readonly toolBindingId?: string | null;
  readonly retryCount?: number | null;
  readonly retryOnTimeout?: boolean | null;
  readonly timeoutMs?: number | null;
  readonly onFailureNodeId?: string | null;
  readonly handoverReason?: FlowNodeFields["handoverReason"];
  readonly confidenceThreshold?: number | null;
  readonly conditionExpression?: string | null;
  readonly requiredAssurance?: FlowNodeFields["requiredAssurance"];
}) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.updateFlowNode");
      return new UpdateFlowNode({ flows: flowRepository() }).execute({
        ...input,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

export async function deleteFlowNodeAction(input: {
  readonly id: string;
  readonly flowVersionId: string;
}): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.deleteFlowNode");
        await new DeleteFlowNode({ flows: flowRepository() }).execute(input);
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function createFlowEdgeAction(
  input: FlowEdgeFields & { readonly flowVersionId: string },
) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.createFlowEdge");
      return new CreateFlowEdge({ flows: flowRepository() }).execute({
        ...input,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

export async function updateFlowEdgeAction(input: {
  readonly id: string;
  readonly flowVersionId: string;
  readonly label?: string | null;
  readonly ordinal?: number;
  readonly conditionExpression?: string | null;
  readonly isDefaultBranch?: boolean;
}) {
  return withStaffAuth(
    async ({ principal }) => {
      requirePermission(principal, MANAGE_PERMISSION, "agents.updateFlowEdge");
      return new UpdateFlowEdge({ flows: flowRepository() }).execute({
        ...input,
        now: realClock().now(),
      });
    },
    { method: "POST", body: input },
  );
}

export async function deleteFlowEdgeAction(input: {
  readonly id: string;
  readonly flowVersionId: string;
}): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.deleteFlowEdge");
        await new DeleteFlowEdge({ flows: flowRepository() }).execute(input);
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function setEntryNodeAction(input: {
  readonly flowVersionId: string;
  readonly nodeId: string;
}): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.setEntryNode");
        await new SetEntryNode({ flows: flowRepository() }).execute({
          ...input,
          now: realClock().now(),
        });
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function setEscapeNodeAction(input: {
  readonly flowVersionId: string;
  readonly nodeId: string;
}): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.setEscapeNode");
        await new SetEscapeNode({ flows: flowRepository() }).execute({
          ...input,
          now: realClock().now(),
        });
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * The standalone "AI settings" screen's save action — the tenant-wide model the Flow
 * Designer AI sidebar uses (`modules/flows/ports/flow-assistant-config-repository.ts`'s doc
 * comment). Gated by `MANAGE_PERMISSION`, the same permission Agent Designers already hold
 * to use the sidebar itself. The screen's initial load goes through `page.tsx` calling
 * `GetFlowAssistantConfig` directly, matching `orchestrator/page.tsx`'s own precedent for a
 * read-only-on-load, write-through-an-action screen.
 */
export async function updateFlowAssistantConfigAction(input: {
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
}): Promise<ActionResult<UpdateFlowAssistantConfigResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.updateFlowAssistantConfig");
        const result = await new UpdateFlowAssistantConfig({
          flowAssistantConfig: flowAssistantConfigRepository(),
        }).execute({
          ...input,
          updatedByStaffUserId: principal.id,
          now: realClock().now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * The AI flow-editing sidebar's "propose" call. Guarded by `MANAGE_PERMISSION` only — this
 * action writes nothing (`modules/flows/ports/flow-edit-ai-client.ts`'s doc comment), it
 * only asks `apps/ai` for a plan a staff user will review; applying an accepted operation
 * goes through `applyFlowEditPlanAction` below, which is where real writes (and their real
 * permission enforcement) happen.
 *
 * Sends the flow's own current node/edge snapshot with the request — `apps/ai` has neither
 * write access to `FlowNodes`/`FlowEdges` nor an authoring-shaped read of them, so this
 * screen's already-loaded canvas state is what grounds the model's proposal.
 */
export type ProposeFlowEditActionResult =
  | {
      readonly ok: true;
      readonly planSummary: string;
      readonly operations: readonly FlowEditOperation[];
      readonly warnings: readonly string[];
      readonly usedFallbackModel: boolean;
    }
  | { readonly ok: false; readonly error: string };

export async function proposeFlowEditAction(input: {
  readonly flowVersionId: string;
  readonly instruction: string;
  readonly conversationHistory: readonly FlowEditConversationTurn[];
}): Promise<ProposeFlowEditActionResult> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.proposeFlowEdit");
        const flows = flowRepository();
        const [nodes, edges, assistantConfig] = await Promise.all([
          flows.listNodes(input.flowVersionId),
          flows.listEdges(input.flowVersionId),
          new GetFlowAssistantConfig({
            flowAssistantConfig: flowAssistantConfigRepository(),
          }).execute({ now: realClock().now() }),
        ]);

        const result = await flowEditAiClient().proposeEdit({
          instruction: input.instruction,
          conversationHistory: input.conversationHistory,
          model: assistantConfig.primaryModel,
          fallbackModel: assistantConfig.fallbackModel,
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            messageText: n.messageText,
            slotName: n.slotName,
            optionSourceKind: n.optionSourceKind,
            toolBindingId: n.toolBindingId,
            handoverReason: n.handoverReason,
            conditionExpression: n.conditionExpression,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            fromNodeId: e.fromNodeId,
            toNodeId: e.toNodeId,
            label: e.label,
            isDefaultBranch: e.isDefaultBranch,
          })),
        });

        return {
          ok: true,
          planSummary: result.planSummary,
          operations: result.operations,
          warnings: result.warnings,
          usedFallbackModel: result.usedFallbackModel,
        } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * The order every accepted plan is applied in, regardless of the array order the model (or
 * the review UI) produced: every new node exists before anything can reference it, every new
 * edge exists before it can be updated, entry/escape designations land only once their
 * target node is real, and deletions happen last so nothing upstream loses a reference
 * mid-apply.
 */
const FLOW_EDIT_APPLY_ORDER: readonly FlowEditOperationKind[] = [
  "CreateNode",
  "CreateEdge",
  "UpdateNode",
  "UpdateEdge",
  "SetEntryNode",
  "SetEscapeNode",
  "DeleteEdge",
  "DeleteNode",
];

type ApplyOneFlowEditOperationOutcome =
  | { readonly ok: true; readonly placeholderId?: string; readonly realNodeId?: string }
  | { readonly ok: false; readonly detail: string };

/**
 * Executes exactly one operation through the same application-layer classes
 * `createFlowNodeAction`/`updateFlowNodeAction`/etc. call — the real, only write path for a
 * `FlowNode`/`FlowEdge`, never a new one. `resolve` turns a `placeholderId` this plan's own
 * earlier `CreateNode` assigned into the real id the repository just returned; an id that is
 * not a known placeholder is passed through unchanged (it is either a real existing node id,
 * or — if neither — the repository's own referential check rejects it, which is reported as
 * this operation's failure rather than silently ignored).
 */
async function applyOneFlowEditOperation(
  op: FlowEditOperation,
  flowVersionId: string,
  resolve: (id: string | null) => string | null,
): Promise<ApplyOneFlowEditOperationOutcome> {
  const flows = flowRepository();
  const now = realClock().now();

  switch (op.kind) {
    case "CreateNode": {
      if (op.nodeType === null || op.title === null) {
        return { ok: false, detail: "CreateNode is missing its node type or title." };
      }
      const result = await new CreateFlowNode({ flows }).execute({
        flowVersionId,
        type: op.nodeType,
        title: op.title,
        canvasX: 0,
        canvasY: 0,
        messageText: op.messageText,
        quickActionSetKey: op.quickActionSetKey,
        slotName: op.slotName,
        optionSourceKind: op.optionSourceKind,
        optionSourceRef: op.optionSourceRef,
        staticOptionsJson: op.staticOptionsJson,
        toolBindingId: op.toolBindingId,
        retryCount: op.retryCount,
        retryOnTimeout: op.retryOnTimeout,
        timeoutMs: op.timeoutMs,
        onFailureNodeId: resolve(op.onFailureNodeId),
        handoverReason: op.handoverReason,
        confidenceThreshold: null,
        conditionExpression: op.conditionExpression,
        requiredAssurance: op.requiredAssurance,
        now,
      });
      if (!result.ok) return { ok: false, detail: result.errors.join(" ") };
      return op.placeholderId !== null
        ? { ok: true, placeholderId: op.placeholderId, realNodeId: result.node.id }
        : { ok: true };
    }

    case "UpdateNode": {
      if (op.nodeId === null) return { ok: false, detail: "UpdateNode is missing its node id." };
      const result = await new UpdateFlowNode({ flows }).execute({
        id: resolve(op.nodeId) as string,
        flowVersionId,
        ...(op.title !== null && { title: op.title }),
        ...(op.messageText !== null && { messageText: op.messageText }),
        ...(op.quickActionSetKey !== null && { quickActionSetKey: op.quickActionSetKey }),
        ...(op.slotName !== null && { slotName: op.slotName }),
        ...(op.optionSourceKind !== null && { optionSourceKind: op.optionSourceKind }),
        ...(op.optionSourceRef !== null && { optionSourceRef: op.optionSourceRef }),
        ...(op.staticOptionsJson !== null && { staticOptionsJson: op.staticOptionsJson }),
        ...(op.toolBindingId !== null && { toolBindingId: op.toolBindingId }),
        ...(op.retryCount !== null && { retryCount: op.retryCount }),
        ...(op.retryOnTimeout !== null && { retryOnTimeout: op.retryOnTimeout }),
        ...(op.timeoutMs !== null && { timeoutMs: op.timeoutMs }),
        ...(op.onFailureNodeId !== null && { onFailureNodeId: resolve(op.onFailureNodeId) }),
        ...(op.handoverReason !== null && { handoverReason: op.handoverReason }),
        ...(op.conditionExpression !== null && { conditionExpression: op.conditionExpression }),
        ...(op.requiredAssurance !== null && { requiredAssurance: op.requiredAssurance }),
        now,
      });
      if (!result.ok) {
        return {
          ok: false,
          detail: result.reason === "flows.node_not_found" ? "Node not found." : result.errors.join(" "),
        };
      }
      return { ok: true };
    }

    case "DeleteNode": {
      if (op.nodeId === null) return { ok: false, detail: "DeleteNode is missing its node id." };
      await new DeleteFlowNode({ flows }).execute({
        id: resolve(op.nodeId) as string,
        flowVersionId,
      });
      return { ok: true };
    }

    case "CreateEdge": {
      if (op.fromNodeId === null || op.toNodeId === null) {
        return { ok: false, detail: "CreateEdge is missing an endpoint." };
      }
      const resolvedFromNodeId = resolve(op.fromNodeId) as string;
      // Mirrors `flows-step.tsx`'s own `nextOrdinalForSource` fix exactly — `UQ_FlowEdges_
      // from_ordinal (flowVersionId, fromNodeId, ordinal)` rejects a second edge at ordinal
      // 0 from the same source, which a menu-shaped node fanning out to several answers
      // (exactly what the AI now proposes for a business-scenario document) does on every
      // edge past the first. Read live rather than tracked in this loop's own state: each
      // prior CreateEdge in this same apply pass is already committed by the time this one
      // runs (operations apply sequentially), so a fresh read always reflects them too.
      const existingOrdinals = (await flows.listEdges(flowVersionId))
        .filter((e) => e.fromNodeId === resolvedFromNodeId)
        .map((e) => e.ordinal);
      const nextOrdinal = existingOrdinals.length > 0 ? Math.max(...existingOrdinals) + 1 : 0;

      const result = await new CreateFlowEdge({ flows }).execute({
        flowVersionId,
        fromNodeId: resolvedFromNodeId,
        toNodeId: resolve(op.toNodeId) as string,
        label: op.label,
        ordinal: nextOrdinal,
        conditionExpression: op.conditionExpression,
        isDefaultBranch: op.isDefaultBranch ?? false,
        now,
      });
      if (!result.ok) {
        return {
          ok: false,
          detail:
            result.reason === "flows.endpoint_wrong_version"
              ? "One endpoint belongs to a different flow version."
              : result.errors.join(" "),
        };
      }
      return { ok: true };
    }

    case "UpdateEdge": {
      if (op.edgeId === null) return { ok: false, detail: "UpdateEdge is missing its edge id." };
      const result = await new UpdateFlowEdge({ flows }).execute({
        id: resolve(op.edgeId) as string,
        flowVersionId,
        ...(op.label !== null && { label: op.label }),
        ...(op.conditionExpression !== null && { conditionExpression: op.conditionExpression }),
        ...(op.isDefaultBranch !== null && { isDefaultBranch: op.isDefaultBranch }),
        now,
      });
      if (!result.ok) return { ok: false, detail: "One endpoint belongs to a different flow version." };
      return { ok: true };
    }

    case "DeleteEdge": {
      if (op.edgeId === null) return { ok: false, detail: "DeleteEdge is missing its edge id." };
      await new DeleteFlowEdge({ flows }).execute({
        id: resolve(op.edgeId) as string,
        flowVersionId,
      });
      return { ok: true };
    }

    case "SetEntryNode": {
      if (op.nodeId === null) return { ok: false, detail: "SetEntryNode is missing its node id." };
      await new SetEntryNode({ flows }).execute({
        flowVersionId,
        nodeId: resolve(op.nodeId) as string,
        now,
      });
      return { ok: true };
    }

    case "SetEscapeNode": {
      if (op.nodeId === null) return { ok: false, detail: "SetEscapeNode is missing its node id." };
      await new SetEscapeNode({ flows }).execute({
        flowVersionId,
        nodeId: resolve(op.nodeId) as string,
        now,
      });
      return { ok: true };
    }
  }
}

/**
 * Applies the staff-approved subset of a proposed plan. Ships all-or-nothing in this wave —
 * the review UI is responsible for keeping the accepted subset dependency-closed (rejecting a
 * `CreateNode` auto-rejects anything referencing it), not this action computing a partial
 * closure — so a failure here stops the whole apply and reports exactly how far it got
 * (`appliedCount`), rather than silently applying a partial, dependency-broken result.
 */
export type ApplyFlowEditPlanActionResult =
  | {
      readonly ok: true;
      readonly flowVersionId: string;
      readonly nodes: readonly FlowNodeRow[];
      readonly edges: readonly FlowEdgeRow[];
      readonly appliedCount: number;
    }
  | {
      readonly ok: false;
      readonly reason: "flows.edit_plan_operation_failed";
      readonly operationIndex: number;
      readonly detail: string;
      readonly appliedCount: number;
    }
  | { readonly ok: false; readonly error: string };

export async function applyFlowEditPlanAction(input: {
  readonly flowVersionId: string;
  readonly operations: readonly FlowEditOperation[];
}): Promise<ApplyFlowEditPlanActionResult> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.applyFlowEditPlan");

        const ordered = [...input.operations].sort(
          (a, b) =>
            FLOW_EDIT_APPLY_ORDER.indexOf(a.kind) - FLOW_EDIT_APPLY_ORDER.indexOf(b.kind),
        );

        const placeholderToRealNodeId = new Map<string, string>();
        const resolve = (id: string | null): string | null =>
          id === null ? null : (placeholderToRealNodeId.get(id) ?? id);

        let appliedCount = 0;
        for (const op of ordered) {
          const outcome = await applyOneFlowEditOperation(op, input.flowVersionId, resolve);
          if (!outcome.ok) {
            return {
              ok: false,
              reason: "flows.edit_plan_operation_failed",
              operationIndex: input.operations.indexOf(op),
              detail: outcome.detail,
              appliedCount,
            } as const;
          }
          if (outcome.placeholderId !== undefined && outcome.realNodeId !== undefined) {
            placeholderToRealNodeId.set(outcome.placeholderId, outcome.realNodeId);
          }
          appliedCount += 1;
        }

        const flows = flowRepository();
        const [nodes, edges] = await Promise.all([
          flows.listNodes(input.flowVersionId),
          flows.listEdges(input.flowVersionId),
        ]);
        return {
          ok: true,
          flowVersionId: input.flowVersionId,
          nodes,
          edges,
          appliedCount,
        } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// "Create with AI" (B2 registry) — describe a business need, review a proposed agent,
// create it in one go. Reuses the exact same catalog-grounded "propose → human reviews →
// apply" shape the Flows step's AI sidebar already established, plus (at apply time) that
// sidebar's own propose/apply machinery for the one flow-shaped field this plan carries
// (`flowInstruction`) — see `modules/agents/ports/agent-creation-ai-client.ts`'s doc comment
// for why flow-graph generation is deliberately NOT duplicated in the new AI call itself.
// ---------------------------------------------------------------------------

/** One real, existing bindable target — id plus a human-readable name, so the review screen never has to show a raw id (`AgentCreationPlan.toolBindings`/`guardrailOverrides` only carry ids/keys). */
export interface AgentCreationCatalogEntry {
  readonly id: string;
  readonly name: string;
}

export interface ProposeAgentCreationActionResult {
  readonly plan: AgentCreationPlan;
  readonly catalogs: {
    readonly skills: readonly AgentCreationCatalogEntry[];
    readonly mcpTools: readonly AgentCreationCatalogEntry[];
    readonly apiConnectors: readonly AgentCreationCatalogEntry[];
    readonly guardrailPolicies: readonly { readonly policyKey: string; readonly title: string }[];
  };
}

/**
 * Gathers the tenant's real, existing catalogs (skills, MCP tools, API connectors,
 * unlocked guardrail policies, knowledge-collection existence) and asks the AI service to
 * propose a whole new agent. Writes nothing — mirrors `proposeFlowEditAction`'s own
 * "propose is read-only" invariant exactly. Returns the catalogs alongside the plan so the
 * review screen can render real names for the ids/keys the plan proposed.
 */
export async function proposeAgentCreationAction(input: {
  readonly businessDescription: string;
}): Promise<ActionResult<ProposeAgentCreationActionResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.proposeAgentCreation");

        const bindings = toolBindingRepository();
        const servers = mcpServerRepository();
        const [skillsResult, serversResult, connectorsResult, guardrailPolicies, assistantConfig] =
          await Promise.all([
            new ListSkills({ skills: skillRepository(), bindings }).execute(),
            new ListMcpServers({ servers }).execute(),
            new ListApiConnectors({ connectors: apiConnectorRepository(), bindings }).execute(),
            policyOverrideRepository().listGuardrailPolicies(GUARDRAIL_POLICY_KEYS),
            new GetFlowAssistantConfig({
              flowAssistantConfig: flowAssistantConfigRepository(),
            }).execute({ now: realClock().now() }),
          ]);

        const mcpToolLists = await Promise.all(
          serversResult.rows
            .filter((server) => server.connectionState === "Connected")
            .map(async (server) => ({
              server,
              tools: await servers.listTools(server.id),
            })),
        );

        const plan = await agentCreationAiClient().proposeCreation({
          businessDescription: input.businessDescription,
          skills: skillsResult.rows.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
          })),
          mcpTools: mcpToolLists.flatMap(({ server, tools }) =>
            tools.map((t) => ({ id: t.id, name: t.name, serverName: server.name })),
          ),
          apiConnectors: connectorsResult.rows.map((c) => ({ id: c.id, name: c.name })),
          guardrailPolicies: guardrailPolicies
            .filter((p) => !p.isLocked)
            .map((p) => ({ policyKey: p.policyKey, title: p.title, detail: p.detail })),
          // This propose step must write nothing (mirrors `proposeFlowEditAction`'s own
          // invariant) — `ensureDefaultCollection` is the only read path this port exposes,
          // and it lazily CREATES on first use, so it is never called here. Knowledge is a
          // single, always-lazily-creatable collection per tenant (step 5's own established
          // convention), so treating it as "exists" for the AI's own grounding is honest: it
          // genuinely will exist, idempotently, the moment `applyAgentCreationPlanAction`
          // enables it.
          knowledgeCollectionExists: true,
          model: assistantConfig.primaryModel,
          fallbackModel: assistantConfig.fallbackModel,
        });

        return {
          ok: true,
          value: {
            plan,
            catalogs: {
              skills: skillsResult.rows.map((s) => ({ id: s.id, name: s.name })),
              mcpTools: mcpToolLists.flatMap(({ server, tools }) =>
                tools.map((t) => ({ id: t.id, name: `${t.name} (${server.name})` })),
              ),
              apiConnectors: connectorsResult.rows.map((c) => ({ id: c.id, name: c.name })),
              guardrailPolicies: guardrailPolicies
                .filter((p) => !p.isLocked)
                .map((p) => ({ policyKey: p.policyKey, title: p.title })),
            },
          },
        } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** One group's outcome from `applyAgentCreationPlanAction` — rendered as a "here's what happened" checklist on the review screen, since the apply sequence stops (never rolls back) at the first group that fails. */
export interface AgentCreationGroupOutcome {
  readonly group: "identity" | "model" | "channels" | "guardrails" | "tools" | "knowledge" | "flow";
  readonly ok: boolean;
  readonly appliedCount?: number;
  readonly total?: number;
  readonly detail?: string;
}

export type ApplyAgentCreationPlanActionResult =
  | {
      readonly ok: true;
      readonly agentId: string;
      readonly agentVersionId: string;
      readonly groups: readonly AgentCreationGroupOutcome[];
      readonly stoppedAtGroup: string | null;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Applies the staff-reviewed (and possibly edited) subset of a proposed agent-creation plan.
 *
 * No shared transaction wraps this sequence — exactly like a human manually walking the
 * wizard one step at a time, each group below is its own independent, already-existing write
 * path. So this stops at the first group that fails and reports exactly where (never rolling
 * back what already succeeded, per this feature's own documented failure semantics): the
 * agent already exists from the Identity group onward, and the wizard is explicitly designed
 * for partial, resumable state, so the caller always redirects into `/agents/[id]/edit`
 * afterward regardless of how far this got.
 */
export async function applyAgentCreationPlanAction(input: {
  readonly name: string;
  readonly description: string | null;
  readonly systemPrompt: string;
  readonly tone: Tone;
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly temperature: number;
  readonly channelKeys: readonly ChannelKey[];
  readonly guardrailOverrides: readonly AgentCreationGuardrailOverride[];
  readonly toolBindings: readonly AgentCreationToolBinding[];
  readonly enableKnowledge: boolean;
  readonly flowInstruction: string;
}): Promise<ApplyAgentCreationPlanActionResult> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.applyAgentCreationPlan");
        const now = realClock().now();
        const groups: AgentCreationGroupOutcome[] = [];

        const ownerTenantId = await resolveOwnerTenantId();
        const created = await new CreateAgent({ agents: agentRepository() }).execute({
          name: input.name,
          description: input.description,
          ownerTenantId,
          createdByStaffUserId: principal.id,
          now,
        });
        const { agentId, agentVersionId } = created;
        groups.push({ group: "identity", ok: true });

        try {
          const configResult = await new UpdateAgentVersionConfig({
            agents: agentRepository(),
          }).execute({
            agentVersionId,
            systemPrompt: input.systemPrompt,
            tone: input.tone,
            primaryModel: input.primaryModel,
            fallbackModel: input.fallbackModel,
            temperature: input.temperature,
            now,
          });
          if (!configResult.ok) {
            groups.push({ group: "model", ok: false, detail: configResult.message });
            return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: "model" } as const;
          }
          groups.push({ group: "model", ok: true });
        } catch (error) {
          groups.push({ group: "model", ok: false, detail: failureMessage(error) });
          return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: "model" } as const;
        }

        try {
          // Mirrors `wizard-shell.tsx`'s own `replaceChannelBindings` call exactly: only the
          // accepted keys are sent, each `isEnabled: true` — not a full-enum true/false matrix.
          const channelBindings: ChannelBindingRow[] = input.channelKeys
            .filter((key) => (WIZARD_CHANNEL_KEYS as readonly ChannelKey[]).includes(key))
            .map((channelKey) => ({ channelKey, isEnabled: true }));
          await new ReplaceChannelBindings({ bindings: agentBindingsRepository() }).execute({
            agentVersionId,
            bindings: channelBindings,
            now,
          });
          groups.push({ group: "channels", ok: true });
        } catch (error) {
          groups.push({ group: "channels", ok: false, detail: failureMessage(error) });
          return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: "channels" } as const;
        }

        try {
          let appliedCount = 0;
          for (const override of input.guardrailOverrides) {
            const result = await new SetGuardrailOverride({
              policies: policyOverrideRepository(),
            }).execute({
              agentId,
              policyKey: override.policyKey,
              mode: override.mode,
              valueJson: override.valueJson,
              reason: override.reason,
              actorStaffUserId: principal.id,
              now,
            });
            if (!result.ok) {
              groups.push({
                group: "guardrails",
                ok: false,
                appliedCount,
                total: input.guardrailOverrides.length,
                detail: `"${override.policyKey}" is locked.`,
              });
              return {
                ok: true,
                agentId,
                agentVersionId,
                groups,
                stoppedAtGroup: "guardrails",
              } as const;
            }
            appliedCount += 1;
          }
          groups.push({
            group: "guardrails",
            ok: true,
            appliedCount,
            total: input.guardrailOverrides.length,
          });
        } catch (error) {
          groups.push({
            group: "guardrails",
            ok: false,
            total: input.guardrailOverrides.length,
            detail: failureMessage(error),
          });
          return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: "guardrails" } as const;
        }

        {
          let appliedCount = 0;
          for (const binding of input.toolBindings) {
            try {
              const result = await new BindTool({ bindings: toolBindingRepository() }).execute({
                agentVersionId,
                targetKind: binding.targetKind,
                targetId: binding.targetId,
                requiredAssurance: binding.requiredAssurance,
                actorStaffUserId: principal.id,
                now,
              });
              if (!result.ok) throw new Error(result.reason);
            } catch (error) {
              groups.push({
                group: "tools",
                ok: false,
                appliedCount,
                total: input.toolBindings.length,
                detail: failureMessage(error),
              });
              return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: "tools" } as const;
            }
            appliedCount += 1;
          }
          groups.push({ group: "tools", ok: true, appliedCount, total: input.toolBindings.length });
        }

        try {
          if (input.enableKnowledge) {
            const collection = await knowledgeSourceRepository().ensureDefaultCollection(now);
            await new ReplaceKnowledgeBindings({ bindings: agentBindingsRepository() }).execute({
              agentVersionId,
              bindings: [{ knowledgeCollectionId: collection.id, isEnabled: true }],
              boundByStaffUserId: principal.id,
              now,
            });
          }
          groups.push({ group: "knowledge", ok: true });
        } catch (error) {
          groups.push({ group: "knowledge", ok: false, detail: failureMessage(error) });
          return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: "knowledge" } as const;
        }

        try {
          const flowBindings = agentBindingsRepository();
          const { flowId, flowVersionId } = await new GetOrCreateDraftFlowVersion({
            flows: flowRepository(),
          }).execute({
            existingFlowId: null,
            existingFlowVersionId: null,
            newFlowName: `${input.name} flow`,
            ownerTenantId,
            actorStaffUserId: principal.id,
            now,
          });
          await new ReplaceFlowBindings({ bindings: flowBindings }).execute({
            agentVersionId,
            bindings: [{ flowId, flowVersionId, isEnabled: true, ordinal: 0 }],
            now,
          });

          const flowAssistantConfig = await new GetFlowAssistantConfig({
            flowAssistantConfig: flowAssistantConfigRepository(),
          }).execute({ now });
          const flowPlan = await flowEditAiClient().proposeEdit({
            instruction: input.flowInstruction,
            conversationHistory: [],
            nodes: [],
            edges: [],
            model: flowAssistantConfig.primaryModel,
            fallbackModel: flowAssistantConfig.fallbackModel,
          });

          const ordered = [...flowPlan.operations].sort(
            (a, b) => FLOW_EDIT_APPLY_ORDER.indexOf(a.kind) - FLOW_EDIT_APPLY_ORDER.indexOf(b.kind),
          );
          const placeholderToRealNodeId = new Map<string, string>();
          const resolve = (id: string | null): string | null =>
            id === null ? null : (placeholderToRealNodeId.get(id) ?? id);

          let appliedCount = 0;
          for (const op of ordered) {
            const outcome = await applyOneFlowEditOperation(op, flowVersionId, resolve);
            if (!outcome.ok) {
              groups.push({
                group: "flow",
                ok: false,
                appliedCount,
                total: flowPlan.operations.length,
                detail: outcome.detail,
              });
              return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: "flow" } as const;
            }
            if (outcome.placeholderId !== undefined && outcome.realNodeId !== undefined) {
              placeholderToRealNodeId.set(outcome.placeholderId, outcome.realNodeId);
            }
            appliedCount += 1;
          }
          groups.push({
            group: "flow",
            ok: true,
            appliedCount,
            total: flowPlan.operations.length,
          });
        } catch (error) {
          groups.push({ group: "flow", ok: false, detail: failureMessage(error) });
          return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: "flow" } as const;
        }

        return { ok: true, agentId, agentVersionId, groups, stoppedAtGroup: null } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Sandbox testing (B3 step 9) — review-comments-3: this step used to be a permanent stub
// ("the sandbox runtime doesn't exist yet") even though a real conversation/flow-execution
// engine has existed and shipped for real citizen channels all along — it was simply never
// wired to this backoffice step. `sendSandboxTurnAction` calls `apps/ai`'s new
// `POST /v1/sandbox/turns` (`sandbox_router.py`), which runs the CURRENT DRAFT flow version
// through the real, unchanged `ProcessTurn`/`ExecuteFlowStep` pipeline, writing no real
// `Conversations`/`ConversationTurns`/`EscalationTickets` rows and simulating (never really
// invoking) any bound `ApiConnector` tool call — see that port's own doc comment.
//
// There is no separate "start session" action: the session id is a plain client-minted
// `crypto.randomUUID()` (the same convention the AI flow-editing sidebar's own turn ids
// already use, `flows-step.tsx`), and the Draft `flowVersionId` this step runs against is
// resolved via the already-existing `loadFlowsStepDataAction` — nothing new to add there.
// ---------------------------------------------------------------------------

export async function sendSandboxTurnAction(input: {
  readonly sandboxSessionId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly flowVersionId: string;
  readonly turnId: string;
  readonly turnOrdinal: number;
  readonly content: string;
  readonly locale: string;
}): Promise<ActionResult<SendSandboxTurnResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.sendSandboxTurn");
        const result = await flowSandboxClient().sendSandboxTurn(input);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** Re-reads step 4's three catalogues + this version's current bindings after a bind/unbind or a discovery, so the client can refresh without a full page reload. */
export async function loadToolsStepDataAction(agentVersionId: string): Promise<
  ActionResult<{
    readonly skills: Awaited<ReturnType<ListSkills["execute"]>>["rows"];
    readonly servers: Awaited<ReturnType<ListMcpServers["execute"]>>["rows"];
    readonly connectors: Awaited<ReturnType<ListApiConnectors["execute"]>>["rows"];
    readonly versionBindings: Awaited<
      ReturnType<ReturnType<typeof toolBindingRepository>["listForVersion"]>
    >;
  }>
> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "agents.loadToolsStepData");
        const bindings = toolBindingRepository();
        const [skillsResult, serversResult, connectorsResult, versionBindings] = await Promise.all([
          new ListSkills({ skills: skillRepository(), bindings }).execute(),
          new ListMcpServers({ servers: mcpServerRepository() }).execute(),
          new ListApiConnectors({ connectors: apiConnectorRepository(), bindings }).execute(),
          bindings.listForVersion(agentVersionId),
        ]);
        return {
          ok: true,
          value: {
            skills: skillsResult.rows,
            servers: serversResult.rows,
            connectors: connectorsResult.rows,
            versionBindings,
          },
        } as const;
      },
      { method: "POST", body: { agentVersionId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
