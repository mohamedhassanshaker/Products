import type { TenantContext } from "@nextbot/db";
import { callModelGatewayStructuredPinned } from "@nextbot/model-gateway";
import { SufficiencySchema } from "../../domain/retrieval-agent-schemas.js";
import { estimateCompletionCallCostUsd } from "./retrieval-types.js";

export interface SufficiencyCheckResult {
  sufficient: boolean;
  missingConcepts: string[];
  costUsd: string;
}

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06, LLD §14.4.4 step 4) — "a
 * sufficiency check after each retrieval decides whether to expand another hop or
 * answer" (Blueprint §7.5). A real, cheap-route structured-output call
 * (`SufficiencySchema`, never hand-parsed) through the SAME `plannerRoute` the query
 * classifier uses — this is the model's OPINION only; `retrieval-executor.ts`'s own
 * `expansions < maxExpansions` counter is what actually bounds the loop (FR-KB-06:
 * "the sufficiency check's opinion cannot extend them"), never this function itself.
 *
 * `evidenceSummary` is a short, already-truncated digest (never the full raw chunk
 * text — keeps this cheap-route call's own prompt small and its cost genuinely low,
 * matching the Blueprint's "routing on a cheap model" cost-lever principle).
 */
export async function checkSufficiency(
  ctx: TenantContext,
  params: { plannerRouteVersionId: string; query: string; evidenceSummary: string },
): Promise<SufficiencyCheckResult> {
  const system =
    "You assess whether the evidence gathered so far is sufficient to answer the customer's question with a grounded, " +
    "cited answer. If the evidence only tangentially relates or leaves an important part of the question unaddressed, " +
    "say so and name what's missing. Respond only with the required JSON shape.";
  const userContent = `Question: ${params.query}\n\nEvidence gathered so far:\n${params.evidenceSummary || "(none)"}`;
  const result = await callModelGatewayStructuredPinned(ctx, {
    routeVersionId: params.plannerRouteVersionId,
    routeKeyForLog: "knowledge.retrieval-agent.sufficiency",
    schema: SufficiencySchema,
    system,
    messages: [{ role: "user", content: userContent }],
  });
  const costUsd = await estimateCompletionCallCostUsd(ctx, params.plannerRouteVersionId, system + userContent, JSON.stringify(result));
  return { sufficient: result.sufficient, missingConcepts: result.missingConcepts, costUsd };
}
