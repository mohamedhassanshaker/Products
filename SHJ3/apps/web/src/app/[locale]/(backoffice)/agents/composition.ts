/**
 * Composition helpers for the `/agents` route tree (registry, `/agents/new`, `/agents/[id]/
 * edit`) — real adapters, constructed fresh per call. Matches `iam/composition.ts`'s own
 * precedent exactly: these are thin, stateless wrappers over the already-cached
 * `getPlatformDb()`/`getTenantDb()` clients, so a fresh object per call is simpler than
 * caching the wrapper itself.
 *
 * The standalone `/flow-designer` screen that used to also import these factory functions
 * directly was removed (review-comments-3) — the wizard's own Flows step is now the only
 * real consumer of the flow-authoring engine this module wires up.
 */

import { loadConfig } from "../../../../modules/platform/config.js";
import { getTenantDb } from "../../../../modules/platform/adapters/outbound/sql/tenant-db.js";
import type { Clock } from "../../../../modules/platform/ports/provisioning.js";
import { PrismaAgentRepository } from "../../../../modules/agents/adapters/outbound/sql/prisma-agent-repository.js";
import { PrismaAgentBindingsRepository } from "../../../../modules/agents/adapters/outbound/sql/prisma-agent-bindings-repository.js";
import { PrismaFlowRepository } from "../../../../modules/flows/adapters/outbound/sql/prisma-flow-repository.js";
import { PrismaFlowAssistantConfigRepository } from "../../../../modules/flows/adapters/outbound/sql/prisma-flow-assistant-config-repository.js";
import { PrismaWizardDraftRepository } from "../../../../modules/agents/adapters/outbound/sql/prisma-wizard-draft-repository.js";
import { PrismaPolicyOverrideRepository } from "../../../../modules/agents/adapters/outbound/sql/prisma-policy-override-repository.js";
import { PrismaSkillRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-skill-repository.js";
import { PrismaMcpServerRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-mcp-server-repository.js";
import { PrismaApiConnectorRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-api-connector-repository.js";
import { PrismaToolBindingRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-tool-binding-repository.js";
import { AiServiceMcpDiscoveryClient } from "../../../../modules/tools/adapters/outbound/ai/ai-service-mcp-discovery-client.js";
import { AiServiceFlowEditClient } from "../../../../modules/flows/adapters/outbound/ai/ai-service-flow-edit-client.js";
import { AiServiceAgentCreationClient } from "../../../../modules/agents/adapters/outbound/ai/ai-service-agent-creation-client.js";
import { AiServiceFlowSandboxClient } from "../../../../modules/flows/adapters/outbound/ai/ai-service-flow-sandbox-client.js";
import { PrismaKnowledgeSourceRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-knowledge-source-repository.js";
import { EvaluateGateForVersion } from "../../../../modules/evaluation/application/evaluate-gate-for-version.js";
import { PrismaPublishGateRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-publish-gate-repository.js";
import { PrismaRegressionRunRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-regression-run-repository.js";
import { PrismaLocaleReadinessRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-locale-readiness-repository.js";
import { PrismaGateEvaluationRepository } from "../../../../modules/evaluation/adapters/outbound/sql/prisma-gate-evaluation-repository.js";

export function agentRepository(): PrismaAgentRepository {
  return new PrismaAgentRepository();
}

export function agentBindingsRepository(): PrismaAgentBindingsRepository {
  return new PrismaAgentBindingsRepository();
}

/** B7 flows authoring (wizard step 6) — see `modules/flows/ports/flow-repository.ts`'s doc comment for why this module has no knowledge of `Agent`/`AgentFlowBinding` at all; that composition happens in `actions.ts`, this file's sibling. */
export function flowRepository(): PrismaFlowRepository {
  return new PrismaFlowRepository();
}

export function wizardDraftRepository(): PrismaWizardDraftRepository {
  return new PrismaWizardDraftRepository();
}

/** The AI settings screen's tenant-wide model config (`modules/flows/ports/flow-assistant-config-repository.ts`'s doc comment). */
export function flowAssistantConfigRepository(): PrismaFlowAssistantConfigRepository {
  return new PrismaFlowAssistantConfigRepository();
}

export function policyOverrideRepository(): PrismaPolicyOverrideRepository {
  return new PrismaPolicyOverrideRepository();
}

export function skillRepository(): PrismaSkillRepository {
  return new PrismaSkillRepository();
}

export function mcpServerRepository(): PrismaMcpServerRepository {
  return new PrismaMcpServerRepository();
}

export function apiConnectorRepository(): PrismaApiConnectorRepository {
  return new PrismaApiConnectorRepository();
}

export function toolBindingRepository(): PrismaToolBindingRepository {
  return new PrismaToolBindingRepository();
}

export function mcpDiscoveryClient(): AiServiceMcpDiscoveryClient {
  return new AiServiceMcpDiscoveryClient();
}

/** The AI flow-editing sidebar's propose call (B7 wave 3) — see `modules/flows/ports/flow-edit-ai-client.ts`'s doc comment for why this is a request/response proxy, not a stored write path. */
export function flowEditAiClient(): AiServiceFlowEditClient {
  return new AiServiceFlowEditClient();
}

/** The wizard's Test-step sandbox chat (review-comments-3) — see `modules/flows/ports/flow-sandbox-client.ts`'s doc comment for why this writes no real conversation data. */
export function flowSandboxClient(): AiServiceFlowSandboxClient {
  return new AiServiceFlowSandboxClient();
}

/** The `/agents` registry's "Create with AI" entry point's propose call — see `modules/agents/ports/agent-creation-ai-client.ts`'s doc comment for why this is a request/response proxy, not a stored write path. */
export function agentCreationAiClient(): AiServiceAgentCreationClient {
  return new AiServiceAgentCreationClient();
}

/**
 * The wizard's Knowledge step (review-comments-3: the step used to render a stub saying
 * Knowledge "isn't available yet" even though B6/B-4 has real, shipped `KnowledgeCollection`/
 * `KnowledgeSource` data — this file is `app`-classified, so it may import `modules/knowledge`
 * directly, the same structural cross-feature composition `flowRepository()` above already
 * does for `modules/flows`).
 */
export function knowledgeSourceRepository(): PrismaKnowledgeSourceRepository {
  return new PrismaKnowledgeSourceRepository();
}

/**
 * FR-AGENT-20's real publish-gate check (B-9). Named `publishGateChecker` rather than
 * `evaluateGateForVersion` here, matching the LOCAL name `agents/ports/publish-gate-
 * checker.ts` declares — this file is the one sanctioned place a structural, cross-feature
 * wire-up like this happens (`app`-classified composition, not a feature module), per that
 * port's own doc comment.
 */
export function publishGateChecker(): EvaluateGateForVersion {
  return new EvaluateGateForVersion({
    gate: new PrismaPublishGateRepository(),
    runs: new PrismaRegressionRunRepository(),
    locales: new PrismaLocaleReadinessRepository(),
    evaluations: new PrismaGateEvaluationRepository(),
  });
}

export function realClock(): Clock {
  return { now: () => new Date() };
}

/** `SHJ3_ENVIRONMENT`, validated at boot (`config.ts`) — matches `iam/composition.ts`'s identical helper. */
export function environment(): string {
  return loadConfig().environment;
}

/**
 * Resolves the ambient tenant's own `platform.Tenants.id` — the value `Agent.ownerTenantId`
 * (a real, ADR-0011 cross-schema FK) actually stores.
 *
 * `getPlatformDb()` cannot be used for this from a normal staff request: it requires
 * `platformScope`, which `withStaffAuth` deliberately does not set for routine tenant-scoped
 * traffic (ADR-0002 rule 5 — cross-tenant reads are limited to provisioning/analytics
 * rollups). `TenantProfile` is the mirrored singleton row every tenant schema carries
 * exactly for this: `getTenantDb()` already resolves to the right schema from the ambient
 * `TenantContext`, and `TenantProfile.tenantId` is the same id `platform.Tenants.id` holds,
 * copied in at provisioning (`prisma/tenant/schema.prisma`'s own doc comment on the model).
 */
export async function resolveOwnerTenantId(): Promise<string> {
  const profile = await getTenantDb("agents.resolveOwnerTenantId").tenantProfile.findUniqueOrThrow({
    where: { singletonKey: 1 },
  });
  return profile.tenantId;
}
