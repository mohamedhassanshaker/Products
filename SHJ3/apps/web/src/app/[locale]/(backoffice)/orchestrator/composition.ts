/**
 * Composition helpers for `/orchestrator` — identical precedent to `escalations/
 * composition.ts`/`channels/composition.ts`: thin, stateless wrappers over
 * `getTenantDb()`, constructed fresh per call, the one place in this route allowed to name
 * concrete adapters.
 *
 * `publishedAgentPort()` is the one adapter here that crosses a feature boundary on
 * purpose: `modules/orchestration/ports/published-agent-port.ts`'s own doc comment explains
 * why `modules/orchestration` cannot import `modules/agents` directly (`eslint.config.mjs`'s
 * `boundaries/element-types` — both are listed `FEATURE_MODULES`). This file is the "app"
 * boundary type, which is allowed to compose both, so the real cross-module wiring lives
 * here — the identical shape `command-centre/composition.ts`'s `GoldenCasePort`/
 * `EvaluationGoldenCaseAdapter` already establishes.
 */
import { getTenantDb } from "../../../../modules/platform/adapters/outbound/sql/tenant-db.js";
import { PrismaRouterConfigRepository } from "../../../../modules/orchestration/adapters/outbound/sql/prisma-router-config-repository.js";
import { PrismaOrchestrationTraceRepository } from "../../../../modules/orchestration/adapters/outbound/sql/prisma-orchestration-trace-repository.js";
import { PrismaPipelineRepository } from "../../../../modules/orchestration/adapters/outbound/sql/prisma-pipeline-repository.js";
import { PrismaAgentRepository } from "../../../../modules/agents/adapters/outbound/sql/prisma-agent-repository.js";
import { ListAgents } from "../../../../modules/agents/application/list-agents.js";
import { AiServiceOrchestrationPreviewClient } from "../../../../modules/orchestration/adapters/outbound/ai/ai-service-orchestration-preview-client.js";
import { AiServicePipelineValidationClient } from "../../../../modules/orchestration/adapters/outbound/ai/ai-service-pipeline-validation-client.js";
import type {
  PublishedAgentPort,
  PublishedAgentSummary,
} from "../../../../modules/orchestration/ports/published-agent-port.js";

export function routerConfigRepository(): PrismaRouterConfigRepository {
  return new PrismaRouterConfigRepository();
}

export function orchestrationTraceRepository(): PrismaOrchestrationTraceRepository {
  return new PrismaOrchestrationTraceRepository();
}

/** Reused directly by `page.tsx` (the "app" boundary type) to populate the "combine
 *  agents" multi-select and the trace-preview agent picker — mirrors `(backoffice)/agents/
 *  composition.ts`'s identical `agentRepository()` factory. */
export function agentRepository(): PrismaAgentRepository {
  return new PrismaAgentRepository();
}

class AgentsPublishedAgentAdapter implements PublishedAgentPort {
  async listPublished(): Promise<readonly PublishedAgentSummary[]> {
    const { rows } = await new ListAgents({ agents: new PrismaAgentRepository() }).execute({
      status: "Published",
    });
    return rows.map((row) => ({ id: row.id }));
  }
}

export function publishedAgentPort(): PublishedAgentPort {
  return new AgentsPublishedAgentAdapter();
}

export function orchestrationPreviewClient(): AiServiceOrchestrationPreviewClient {
  return new AiServiceOrchestrationPreviewClient();
}

export function pipelineRepository(): PrismaPipelineRepository {
  return new PrismaPipelineRepository();
}

export function pipelineValidationClient(): AiServicePipelineValidationClient {
  return new AiServicePipelineValidationClient();
}

/** The tenant's own id, mirrored into every tenant schema at provisioning — same precedent
 *  as `(backoffice)/agents/composition.ts::resolveOwnerTenantId`, duplicated here (not
 *  imported) since `boundaries/element-types` scopes each route's composition file to its
 *  own directory, not shared across routes. */
export async function resolveOwnerTenantId(): Promise<string> {
  const profile = await getTenantDb("orchestrator.resolveOwnerTenantId").tenantProfile.findUniqueOrThrow(
    { where: { singletonKey: 1 } },
  );
  return profile.tenantId;
}
