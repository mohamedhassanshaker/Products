import type { TenantContext } from "@nextbot/db";
import { resolveGraphRuntime, type AgentGraphDefinition, type RunEvent } from "@nextbot/ai-registry";
import { runBoundedRetrieval } from "@nextbot/knowledge";
import { callModelGatewayStructuredPinned } from "@nextbot/model-gateway";
import type { CreateEvalCaseRequest, CreateEvalSuiteRequest, EvalRunKindValue, EvalRubric } from "@nextbot/contracts";
import { JudgeVerdictSchema, type JudgeVerdict } from "../domain/eval-judge-schemas.js";
import { getAgentDefinition, getAgentDefinitionVersion, setVersionEvalBinding } from "../infrastructure/agent-definition-repository.js";
import { appendContinuousRegressionEvent } from "../infrastructure/continuous-eval-events.js";
import {
  createEvalSuite as insertEvalSuite,
  createEvalCase as insertEvalCase,
  listEvalSuites,
  getEvalSuite,
  listEvalCases,
  createEvalRun,
  finishEvalRun,
  getEvalRun,
  listEvalRunsForVersion,
  findPriorContinuousRun,
  insertEvalCaseResult,
  listEvalCaseResults,
  type EvalSuiteRow,
  type EvalCaseRow,
  type EvalRunRow,
} from "../infrastructure/eval-repository.js";
import { parseArtifactFromYaml, getVersionKnowledgeConfig } from "./agent-definition-service.js";
import { startAgentRun, completeAgentRun } from "./agent-run-service.js";

export async function createEvalSuite(ctx: TenantContext, input: CreateEvalSuiteRequest): Promise<EvalSuiteRow> {
  return insertEvalSuite(ctx, { ...input, gateMode: input.gateMode, regressionBaselineVersionId: input.regressionBaselineVersionId });
}

export { listEvalSuites, getEvalSuite, listEvalRunsForVersion, listEvalCaseResults };

export async function addEvalCase(ctx: TenantContext, evalSuiteId: string, input: CreateEvalCaseRequest): Promise<EvalCaseRow> {
  return insertEvalCase(ctx, { evalSuiteId, ...input });
}

export async function listCases(ctx: TenantContext, evalSuiteId: string): Promise<EvalCaseRow[]> {
  return listEvalCases(ctx, evalSuiteId);
}

async function collectEvents(iter: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-18) — grades a case's
 * `rubric` (and, for a retrieval-scoped agent version, groundedness/citation
 * precision) via a judge model pinned to `judgeRouteVersionId`. TypeBox
 * structured output, validated on the way back (`JudgeVerdictSchema`) — never
 * hand-parsed JSON, and never a hardcoded/vendor model id (the pinned route
 * version is resolved through the SAME Model Gateway v2 path every other
 * pinned call in this codebase uses).
 */
async function gradeRubric(
  ctx: TenantContext,
  input: {
    judgeRouteVersionId: string;
    rubric: EvalRubric;
    transcript: Array<{ sender: string; text: string }>;
    actualResponse: string;
    citations?: Array<{ documentTitle: string; snippet: string }>;
    agentRunId?: string;
  },
): Promise<JudgeVerdict> {
  const criteriaList = input.rubric.criteria.map((c) => `- (${c.id}, weight ${c.weight}): ${c.description}`).join("\n");
  const transcriptText = input.transcript.map((m) => `${m.sender}: ${m.text}`).join("\n");
  const citationsText = input.citations && input.citations.length > 0 ? input.citations.map((c) => `- ${c.documentTitle}: "${c.snippet}"`).join("\n") : "(none supplied)";
  const system = [
    "You are an impartial evaluation judge for a support agent's response.",
    "Score each rubric criterion from 0 (fails) to 1 (fully satisfies), with a short rationale.",
    "Also give an overallScore (0-1, the weighted average across criteria) and a boolean passed verdict.",
    "If citations are supplied, also score citationPrecision (0-1): the fraction of citations that are genuinely relevant to and supportive of the response.",
  ].join(" ");
  const user = [
    `Conversation transcript:\n${transcriptText}`,
    `Agent's actual response:\n${input.actualResponse}`,
    `Rubric criteria:\n${criteriaList}`,
    `Citations supplied with the response:\n${citationsText}`,
  ].join("\n\n");

  return callModelGatewayStructuredPinned(ctx, {
    routeVersionId: input.judgeRouteVersionId,
    routeKeyForLog: "eval.judge",
    schema: JudgeVerdictSchema,
    system,
    messages: [{ role: "user", content: user }],
    agentRunId: input.agentRunId,
  });
}

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-18, FR-KB-06 cross-
 * reference) — for a retrieval-scoped agent version, answers the case's last
 * transcript message through the SAME `runBoundedRetrieval` (`@nextbot/
 * knowledge`) the real turn pipeline calls for a knowledge-scoped agent's
 * "reply" action, rather than inventing a second grounding-check
 * implementation. Returns `null` for a non-knowledge-scoped version (the
 * caller falls back to the existing GraphRuntime path unchanged).
 */
async function runRetrievalScopedCase(
  ctx: TenantContext,
  agentDefinitionVersionId: string,
  query: string,
): Promise<{ answerText: string | null; citations: Array<{ documentTitle: string; snippet: string }>; groundednessScore: number } | null> {
  const resolved = await getVersionKnowledgeConfig(ctx, agentDefinitionVersionId);
  if (!resolved) return null;
  const result = await runBoundedRetrieval(ctx, {
    query,
    config: resolved.knowledgeConfig,
    plannerRouteVersionId: resolved.plannerRouteVersionId,
    answerRouteVersionId: resolved.answerRouteVersionId,
    agentDefinitionVersionId,
  });
  return {
    answerText: result.answerText,
    citations: result.citations.map((c) => ({ documentTitle: c.documentTitle, snippet: c.snippet })),
    // `runBoundedRetrieval`'s own invariant: `answerText` is non-null IFF the
    // outcome was genuinely grounded (never a model claiming grounding on its
    // own say-so) — reusing that real enforcement as the metric itself, rather
    // than re-deriving a second, independent grounding heuristic.
    groundednessScore: result.answerText !== null ? 1 : 0,
  };
}

/**
 * FR-AGT-06/FR-AGT-16/17/18 — runs every case in a suite against one agent
 * version and records a pass/fail verdict.
 *
 * **Scoping decision, flagged deliberately (unchanged from the original Phase
 * 12-predecessor dispatch).** This phase's eval execution invokes the agent
 * version's `GraphRuntime` (ADR-0003) directly, single-turn — it does not run
 * through `orchestration`'s full turn pipeline (guardrails, tier-engine, real
 * tool dispatch). A case whose `expectedToolCalls` is non-empty is recorded as
 * failed with an explicit `failureReason` (fail-closed) rather than pretending
 * to check something this harness cannot verify. **Extension this phase**: a
 * RETRIEVAL-scoped version (`spec.knowledge` configured) is instead answered
 * through `runBoundedRetrieval` (see `runRetrievalScopedCase` above) — the
 * real path such a version answers through in production — so its own
 * groundedness/citation-precision metrics are genuine, not a GraphRuntime
 * response the version would never actually produce for a knowledge-scoped
 * query.
 *
 * **`run_kind`/gate mode (FR-AGT-17/18)**: `runKind` defaults `PrePromotion`
 * (unchanged prior behavior). `gateMode` (`eval_suite.gate_mode`) additionally
 * gates on a REGRESSION BASELINE: the most recent prior `Continuous` run for
 * the same (suite, version) pair (`findPriorContinuousRun`) if one exists, or —
 * if none exists yet — the suite's own explicit `regressionBaselineVersionId`'s
 * most recent PASSED run of any kind. `AbsoluteThreshold` (unchanged) never
 * consults a baseline at all. A `Continuous` run's regression is recorded
 * (`regressed`) and raises `eval.regression_detected` — **a distinct alert
 * class from a pre-promotion gate failure** (FR-AGT-17's own wording): a
 * `Continuous` run's `regressed` flag never itself flips a `PrePromotion` run's
 * gate outcome, and a `PrePromotion`/`Manual` run's own regression (under
 * `RegressionBaseline`/`Both` gate mode) fails the run through the ordinary
 * `status` field exactly like an absolute-threshold miss always has, with no
 * new alert class for that already-existing mechanism.
 */
export async function runEvalSuite(
  ctx: TenantContext,
  input: { agentDefinitionVersionId: string; triggeredBy: "VersionSubmitted" | "Manual" | "Scheduled"; runKind?: EvalRunKindValue },
): Promise<EvalRunRow> {
  const runKind: EvalRunKindValue = input.runKind ?? "PrePromotion";
  const version = await getAgentDefinitionVersion(ctx, input.agentDefinitionVersionId);
  if (!version.evalSuiteId) throw new Error("This version has no eval suite bound yet.");
  const suite = await getEvalSuite(ctx, version.evalSuiteId);
  const cases = await listEvalCases(ctx, suite.id);
  const definition = await getAgentDefinition(ctx, version.agentDefinitionId);

  const run = await createEvalRun(ctx, {
    evalSuiteId: suite.id,
    agentDefinitionVersionId: version.id,
    definitionHash: version.definitionHash,
    triggeredBy: input.triggeredBy,
    runKind,
  });

  // A `graph_type` with no installed adapter (NFR-12 seam — only `ADK`/`CustomFSM`
  // are installed, see `ai-registry`'s `resolveGraphRuntime`) cannot run any eval
  // case at all. Rather than let this throw uncaught (leaving `run` stuck at
  // `Running` forever) or silently skip cases, the whole run is recorded `Error` —
  // which the promotion gate treats the same as `Failed` (never `Passed`), so this
  // is actually a *stronger* fail-closed guarantee than the explicit
  // `GRAPH_TYPE_NOT_INSTALLED` check at the `Approved -> Production` step: a version
  // whose graph type isn't installed can never even pass its eval gate.
  let runtime;
  try {
    runtime = resolveGraphRuntime(version.graphType);
  } catch (err) {
    await finishEvalRun(ctx, run.id, { status: "Error", passRatePct: 0 });
    await setVersionEvalBinding(ctx, version.id, { lastEvalRunId: run.id });
    throw err instanceof Error ? err : new Error(String(err));
  }

  const artifact = parseArtifactFromYaml(version.definitionYaml) as { spec: { instructions: string } };
  const graphDefinition: AgentGraphDefinition = {
    name: definition.name,
    instructions: artifact.spec.instructions,
    modelRouteKey: version.modelRouteKey,
    tools: [],
  };
  const compiled = runtime.load(graphDefinition);

  let passedCount = 0;
  const startedAt = Date.now();
  for (const evalCase of cases) {
    const caseStarted = Date.now();
    const lastMessage = evalCase.inputTranscript.at(-1)?.text ?? "";
    let actualResponse = "";
    let passed = true;
    let failureReason: string | undefined;
    let citations: Array<{ documentTitle: string; snippet: string }> = [];
    let groundednessScore: number | undefined;

    if (evalCase.expectedToolCalls && evalCase.expectedToolCalls.length > 0) {
      passed = false;
      failureReason = "Tool-call expectations cannot be evaluated until Phase 12 wires real tool dispatch through the turn pipeline.";
    } else {
      const { run: agentRun, span } = await startAgentRun(ctx, { agentDefinitionVersionId: version.id, trigger: "EvalCase" });
      try {
        const retrievalScoped = await runRetrievalScopedCase(ctx, version.id, lastMessage);
        if (retrievalScoped) {
          actualResponse = retrievalScoped.answerText ?? "";
          citations = retrievalScoped.citations;
          groundednessScore = retrievalScoped.groundednessScore;
          if (evalCase.expectedResponsePattern) {
            passed = retrievalScoped.answerText !== null && new RegExp(evalCase.expectedResponsePattern, "i").test(retrievalScoped.answerText);
            if (!passed) failureReason = `Response did not match the expected pattern '${evalCase.expectedResponsePattern}'.`;
          }
        } else {
          const events = await collectEvents(runtime.start(compiled, { text: lastMessage }, { runId: agentRun.id, tenantId: ctx.tenantId, userId: "eval-harness" }));
          const finalEvent = events.find((e): e is Extract<RunEvent, { type: "Final" }> => e.type === "Final");
          actualResponse = finalEvent?.text ?? "";
          if (evalCase.expectedResponsePattern) {
            passed = new RegExp(evalCase.expectedResponsePattern, "i").test(actualResponse);
            if (!passed) failureReason = `Response did not match the expected pattern '${evalCase.expectedResponsePattern}'.`;
          }
        }
        await completeAgentRun(ctx, agentRun, span, { status: "Succeeded" });
      } catch (err) {
        passed = false;
        failureReason = `Run failed: ${(err as Error).message}`;
        await completeAgentRun(ctx, agentRun, span, { status: "Failed" });
      }
    }

    let rubricScores: Record<string, { score: number; rationale: string }> | undefined;
    let citationPrecision: number | undefined;
    if (evalCase.rubric && evalCase.judgeRouteVersionId && actualResponse) {
      try {
        const verdict = await gradeRubric(ctx, {
          judgeRouteVersionId: evalCase.judgeRouteVersionId,
          rubric: evalCase.rubric,
          transcript: evalCase.inputTranscript,
          actualResponse,
          citations,
        });
        rubricScores = verdict.criteria;
        citationPrecision = verdict.citationPrecision;
        // The rubric's own verdict is combined with (never silently overridden
        // by) an already-failed pattern-match check — a case can decline
        // either way but never appear to pass on the strength of the judge
        // alone when its own pattern already failed.
        passed = passed && verdict.passed;
        if (!verdict.passed && !failureReason) failureReason = "Judge rubric verdict: did not pass.";
      } catch (err) {
        // A judge-model failure degrades to the pattern-match verdict alone
        // (never silently marks the case Passed) — logged, not thrown, so one
        // case's judge outage doesn't abort the whole run.
        console.error(`[agent-platform] gradeRubric failed for eval case ${evalCase.id}`, err);
      }
    }

    await insertEvalCaseResult(ctx, {
      evalRunId: run.id,
      evalCaseId: evalCase.id,
      passed,
      actualResponse,
      failureReason,
      latencyMs: Date.now() - caseStarted,
      rubricScores,
      groundednessScore,
      citationPrecision,
    });
    if (passed) passedCount += 1;
  }

  const passRatePct = cases.length > 0 ? (passedCount / cases.length) * 100 : 100;
  const meetsThreshold = passRatePct >= Number(suite.passThresholdPct);

  // Regression-baseline comparison (FR-AGT-18): only consulted when the suite's
  // own gate mode asks for it — `AbsoluteThreshold` never looks at a baseline.
  let regressed = false;
  let baselineRunId: string | undefined;
  if (suite.gateMode === "RegressionBaseline" || suite.gateMode === "Both") {
    const priorContinuous = await findPriorContinuousRun(ctx, suite.id, version.id, run.id);
    const baselineRun =
      priorContinuous ??
      (suite.regressionBaselineVersionId
        ? (await listEvalRunsForVersion(ctx, suite.regressionBaselineVersionId)).filter((r) => r.evalSuiteId === suite.id && r.status === "Passed").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
        : undefined);
    if (baselineRun?.passRatePct !== null && baselineRun?.passRatePct !== undefined) {
      baselineRunId = baselineRun.id;
      regressed = passRatePct < Number(baselineRun.passRatePct);
    }
  }

  const status = suite.gateMode === "RegressionBaseline" ? (regressed ? "Failed" : "Passed") : suite.gateMode === "Both" ? (meetsThreshold && !regressed ? "Passed" : "Failed") : meetsThreshold ? "Passed" : "Failed";

  await finishEvalRun(ctx, run.id, { status, passRatePct, p95LatencyMs: Date.now() - startedAt, baselineRunId, regressed });
  await setVersionEvalBinding(ctx, version.id, { lastEvalRunId: run.id });

  // FR-AGT-17 — a Continuous run's regression is its OWN, distinct alert class,
  // never conflated with a pre-promotion gate failure (which already has its
  // own, long-established signal: `status !== 'Passed'` blocking promotion).
  if (runKind === "Continuous" && regressed) {
    await appendContinuousRegressionEvent(ctx, { evalSuiteId: suite.id, agentDefinitionVersionId: version.id, evalRunId: run.id, passRatePct, baselineRunId });
  }

  return (await getEvalRun(ctx, run.id)) as EvalRunRow;
}
