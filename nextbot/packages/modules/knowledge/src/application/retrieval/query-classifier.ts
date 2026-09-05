import type { TenantContext } from "@nextbot/db";
import { callModelGatewayStructuredPinned } from "@nextbot/model-gateway";
import { QueryClassificationSchema } from "../../domain/retrieval-agent-schemas.js";
import { findAnchorEntitiesByQueryMention } from "../../infrastructure/graph-repository.js";
import { estimateCompletionCallCostUsd } from "./retrieval-types.js";

export type ClassifiedStrategy = "Vector" | "GraphLocal" | "GraphGlobal";

export interface QueryClassificationResult {
  strategy: ClassifiedStrategy;
  /** Number of entity mentions the deterministic anchor check found — `0` means the
   *  cheap-route classifier call was never made at all (see doc below). */
  anchorCount: number;
  costUsd: string;
}

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05, Blueprint §7.5) — the
 * `strategy: auto` query classifier the Blueprint's own text describes: "narrow
 * entity-anchored questions go graph-local, broad thematic questions go graph-global,
 * anything without a graph anchor falls back to vector."
 *
 * Two-step, cost-conscious design (mirrors the Blueprint's own "routing on a cheap
 * model" cost-lever principle, §11):
 *
 * 1. **Deterministic anchor check FIRST, no model call.** Reuses Phase 9's own
 *    `findAnchorEntitiesByQueryMention` (a literal substring match against this
 *    generation's `graph_entity.canonical_name`/`aliases`) — if the query mentions no
 *    recognizable entity, there is no graph to be "narrow" or "broad" ABOUT, so the
 *    Vector fallback is the only sensible answer and no model call is worth making.
 * 2. **Only when an anchor exists**, one real, cheap structured-output call through
 *    the agent version's own `plannerRoute` (`spec.plannerRoute`, default
 *    `"chat.router"` — ADR-0011 §2.2's standard cheap "classification/routing" role,
 *    ALREADY the convention this codebase uses for `TeamVersion.supervisorRouteVersionId`
 *    and this exact YAML block's own `plannerRoute: chat.router # classification and
 *    sufficiency checks` comment) decides narrow-vs-broad — never a frontier-class
 *    route, never hand-parsed free text (`QueryClassificationSchema`, TypeBox,
 *    re-validated by `generateStructured` on the way back).
 */
export async function classifyRetrievalStrategy(
  ctx: TenantContext,
  params: { generationId: string; query: string; plannerRouteVersionId: string },
): Promise<QueryClassificationResult> {
  const anchors = await findAnchorEntitiesByQueryMention(ctx, params.generationId, params.query, 10);
  if (anchors.length === 0) {
    return { strategy: "Vector", anchorCount: 0, costUsd: "0.00000000" };
  }

  const anchorNames = anchors.map((a) => a.canonicalName).join(", ");
  const system =
    "You classify a customer question for a knowledge-retrieval router. The question mentions at least one recognizable " +
    "entity in a knowledge graph. Decide: is this a NARROW question whose answer centers on those specific entities and " +
    "their direct relationships (respond 'narrow'), or a BROAD, thematic question asking what an entire policy/topic " +
    "covers overall (respond 'broad')? Respond only with the required JSON shape.";
  const result = await callModelGatewayStructuredPinned(ctx, {
    routeVersionId: params.plannerRouteVersionId,
    routeKeyForLog: "knowledge.retrieval-agent.classify",
    schema: QueryClassificationSchema,
    system,
    messages: [{ role: "user", content: `Question: ${params.query}\n\nEntities recognized in the question: ${anchorNames}` }],
  });

  const costUsd = await estimateCompletionCallCostUsd(ctx, params.plannerRouteVersionId, system + params.query, JSON.stringify(result));
  return { strategy: result.scope === "narrow" ? "GraphLocal" : "GraphGlobal", anchorCount: anchors.length, costUsd };
}
