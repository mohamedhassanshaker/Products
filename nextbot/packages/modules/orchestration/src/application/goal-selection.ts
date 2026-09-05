import { Type, type Static } from "@sinclair/typebox";
import { generateStructured } from "@nextbot/ai-registry";

/**
 * Goal/tool-selection reasoning (LLD §7.2/§7.4) — the turn pipeline's only model
 * call this phase. Per LLD §7.2 this is the **sole** sanctioned way a model
 * completion becomes application data: a TypeBox schema is passed to
 * `generateStructured`, which re-validates the return itself; nothing here parses
 * free text or regex-extracts JSON.
 *
 * The tool catalog offered to the model is **already permission-filtered** before
 * this call is made (`buildAgentVisibleCatalog` in `turn-pipeline.ts`, mirroring the
 * `ToolHandle` doc's rule in `@nextbot/ai-registry`: "by the time a tool reaches the
 * model, it is already permission-filtered") — `resolvePermission` is still
 * re-invoked per selected call at the tier-engine stage (defense in depth), never
 * bypassed because the model only *saw* allowed tools.
 */
export const GoalSelectionResultSchema = Type.Object({
  action: Type.Union([Type.Literal("call_tool"), Type.Literal("reply"), Type.Literal("not_understood")]),
  toolName: Type.Optional(Type.String()),
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  replyText: Type.Optional(Type.String()),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});
export type GoalSelectionResult = Static<typeof GoalSelectionResultSchema>;

export interface CatalogEntryForSelection {
  toolId: string;
  name: string;
  description: string;
}

export async function selectGoalAndTool(
  customerText: string,
  catalog: CatalogEntryForSelection[],
): Promise<GoalSelectionResult> {
  const catalogDescription = catalog.length
    ? catalog.map((c) => `- ${c.name} (id=${c.toolId}): ${c.description}`).join("\n")
    : "(no tools are available to you for this customer)";

  const result = await generateStructured({
    routeKey: "reasoning.planner",
    schema: GoalSelectionResultSchema,
    system:
      "You are NextBot's turn-level goal/tool-selection reasoner. Given the customer's message and the list of " +
      "tools you are permitted to call, decide whether to call exactly one tool, reply directly, or say you did " +
      "not understand. Respond only with the required JSON shape. Available tools:\n" +
      catalogDescription,
    messages: [{ role: "user", content: customerText }],
  });

  // Defense in depth: even though the prompt only offered the permitted catalog, a
  // model can still hallucinate a tool id — treat that exactly like `param-extract`'s
  // `UnknownTool` outcome (reject to a not-understood/plain-reply path), never a
  // free pass into dispatch.
  if (result.action === "call_tool" && !catalog.some((c) => c.toolId === result.toolName)) {
    return { action: "not_understood", confidence: result.confidence };
  }
  return result;
}
