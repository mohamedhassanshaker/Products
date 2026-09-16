/**
 * `ServiceHealthSamples` — B14 tab 3. Pure status derivation (FR-GOV-18/19).
 *
 * ## Per-target budgets — a deliberate, named scope cut
 *
 * The wireframe's own seeded numbers (B14 tab 3) imply per-dependency latency budgets —
 * MCP tool calls at 300ms, Graph RAG retrieval at 350ms, WhatsApp egress at 250ms — but no
 * per-target budget CONFIGURATION exists anywhere in this codebase (grepped: no
 * `latencyBudgetMs`-shaped column on any target-adjacent table). Wiring a real
 * per-dependency configuration surface is out of scope for this wave; `TARGET_BUDGETS_MS`
 * below hard-codes the wireframe's own three named numbers for the targets this module
 * can actually compute from real data, and every other target falls back to
 * `docs/requirements.md`'s own global default ("`>1,500ms p95 or 5% error rate`",
 * FR-GOV-19). This is named plainly here and in the final report — not silently papered
 * over as if a real config surface existed.
 */

export const SERVICE_HEALTH_STATUSES = ["Healthy", "Degraded", "Down"] as const;
export type ServiceHealthStatus = (typeof SERVICE_HEALTH_STATUSES)[number];

/** `ServiceHealthSamples.targetKind` — the two targets this module can compute a real
 *  sample for from `OrchestrationTraceSteps` (§ this module's own `RecordServiceHealthSample`
 *  doc comment: no OTel-consuming worker exists yet to populate every row continuously). */
export const COMPUTABLE_TARGET_KINDS = ["McpTool", "GraphRetrieval"] as const;
export type ComputableTargetKind = (typeof COMPUTABLE_TARGET_KINDS)[number];

/** FR-GOV-19's own stated global threshold, applied whenever a target has no named budget. */
export const GLOBAL_ERROR_RATE_THRESHOLD = 0.05;
export const GLOBAL_LATENCY_BUDGET_MS = 1500;

/** The wireframe's three seeded, named per-target budgets (ms) — see this file's module
 *  comment. Keyed by `targetKey`, not `targetKind`, since two MCP tools could plausibly
 *  carry different budgets once real configuration exists; today every key not listed
 *  here falls back to the global default. */
export const TARGET_BUDGETS_MS: Readonly<Record<string, number>> = {
  "mcp-tool": 300,
  "graph-rag-retrieval": 350,
  "whatsapp-egress": 250,
};

export function budgetForTarget(targetKey: string | null): number {
  if (targetKey && targetKey in TARGET_BUDGETS_MS) return TARGET_BUDGETS_MS[targetKey]!;
  return GLOBAL_LATENCY_BUDGET_MS;
}

/** FR-GOV-19: `Degraded` if `errorRate > 0.05` OR `p95LatencyMs` exceeds the target's own
 *  budget, else `Healthy`. `Down` is never computed here — it is a status this module's
 *  schema reserves for a manual/future signal (e.g. zero samples in a window at all),
 *  not one this wave's aggregation produces. */
export function deriveHealthStatus(input: {
  readonly errorRate: number;
  readonly p95LatencyMs: number;
  readonly targetKey: string | null;
}): Exclude<ServiceHealthStatus, "Down"> {
  const budget = budgetForTarget(input.targetKey);
  if (input.errorRate > GLOBAL_ERROR_RATE_THRESHOLD || input.p95LatencyMs > budget)
    return "Degraded";
  return "Healthy";
}

/** Nearest-rank p95 over a real sample of durations — no interpolation, matching how a
 *  small, real trace-step sample should be reasoned about (the exact rank is always one
 *  of the observed values, never a value nothing actually measured). Returns `0` for an
 *  empty sample rather than `NaN`/throwing — an empty window is a real, valid case (no
 *  traffic), not an error. */
export function p95(durationsMs: readonly number[]): number {
  if (durationsMs.length === 0) return 0;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))]!;
}

export function errorRateOf(total: number, nonOk: number): number {
  if (total === 0) return 0;
  return nonOk / total;
}
