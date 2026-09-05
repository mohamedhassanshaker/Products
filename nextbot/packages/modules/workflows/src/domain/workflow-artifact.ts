import { createHash } from "node:crypto";
import yaml from "js-yaml";
import { Value } from "@sinclair/typebox/value";
import { WorkflowGraphSchema, WorkflowGraphValidationError, type WorkflowGraph, type WorkflowGraphIssue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.1) —
 * the authored workflow YAML artifact's parse/serialize/hash triple. Pure
 * (`domain/`, no I/O): everything here is decidable from the artifact text alone.
 * Anything that needs the database (resolving a pinned reference, calling the
 * authz evaluator) lives in `application/graph-validator.ts` /
 * `application/workflow-service.ts`, not here — mirrors `teams/domain/
 * team-artifact.ts`'s own split exactly.
 */

/** Serializes an artifact back to YAML. Used by the version editor's round-trip
 * and by `workflow_version.yaml`, the stored source of truth for a version. */
export function serializeWorkflowArtifact(artifact: WorkflowGraph): string {
  return yaml.dump(artifact);
}

/**
 * Parses and STRUCTURALLY VALIDATES an authored workflow YAML document.
 *
 * @throws {WorkflowGraphValidationError} when the text is not valid YAML, or is
 *   valid YAML that does not satisfy `WorkflowGraphSchema`. `additionalProperties:
 *   false` throughout that schema is load-bearing: a misspelled key must fail
 *   loudly rather than be silently dropped and defaulted.
 */
export function parseWorkflowArtifact(text: string): WorkflowGraph {
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (err) {
    throw new WorkflowGraphValidationError([
      { code: "WORKFLOW_ARTIFACT_INVALID_YAML", message: `Workflow artifact is not valid YAML: ${err instanceof Error ? err.message : String(err)}`, path: null },
    ]);
  }
  return assertWorkflowGraph(raw);
}

/** Validates an already-parsed value against `WorkflowGraphSchema`, reporting
 * every failing path (not just the first) so the console can highlight each
 * offending field at once. */
export function assertWorkflowGraph(raw: unknown): WorkflowGraph {
  if (Value.Check(WorkflowGraphSchema, raw)) return raw;
  const issues: WorkflowGraphIssue[] = [...Value.Errors(WorkflowGraphSchema, raw)].map((e) => ({
    path: e.path || "(root)",
    code: "WORKFLOW_ARTIFACT_INVALID",
    message: e.message,
  }));
  throw new WorkflowGraphValidationError(issues);
}

/** Recursively key-sorted canonical form — the same shape/rationale
 * `agent-platform`'s `canonicalize`/`teams`' `canonicalize` document (an array
 * replacer on `JSON.stringify` is a GLOBAL property allow-list, not a per-level
 * sort, and has already caused a real hash-collision bug in this codebase twice). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Deterministic sha256 of a workflow artifact — `workflow_version.yaml_hash`, the
 * value `workflows.immutability.int.test.ts` recomputes on read to prove a stored
 * version was never mutated.
 *
 * **`spec.layout` is EXCLUDED** (LLD §14.6.1) — canvas positions/zoom are cosmetic;
 * moving a box is never a new version. Every other field participates unchanged.
 */
export function hashWorkflowArtifact(artifact: WorkflowGraph): string {
  const specWithoutLayout: typeof artifact.spec = { ...artifact.spec };
  delete specWithoutLayout.layout;
  const hashable = { ...artifact, spec: specWithoutLayout };
  return createHash("sha256").update(JSON.stringify(canonicalize(hashable)), "utf8").digest("hex");
}
