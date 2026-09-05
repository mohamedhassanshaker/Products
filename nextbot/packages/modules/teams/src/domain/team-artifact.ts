import { createHash } from "node:crypto";
import yaml from "js-yaml";
import { Value } from "@sinclair/typebox/value";
import { TeamArtifactSchema, TeamValidationError, type TeamArtifact } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-03, LLD §14.7.2) — the
 * authored team YAML artifact's parse/serialize/hash triple. Pure (`domain/`, no
 * I/O): everything here is decidable from the artifact text alone. Anything that
 * needs the database to decide — resolving a `definitionName@version` pin, checking
 * that the supervisor route is router-class, checking the sandbox run covered every
 * member — lives in `application/team-version-service.ts`, not here.
 */

/** Serializes an artifact back to YAML. Used by the version editor's round-trip and
 * by `team_version.yaml`, which is the stored source of truth for a version. */
export function serializeTeamArtifact(artifact: TeamArtifact): string {
  return yaml.dump(artifact);
}

/**
 * Parses and STRUCTURALLY VALIDATES an authored team YAML document.
 *
 * @throws {TeamValidationError} when the text is not valid YAML, or is valid YAML
 *   that does not satisfy `TeamArtifactSchema`. `additionalProperties: false`
 *   throughout that schema is load-bearing: a misspelled key (`failure_mode`
 *   instead of `failureMode`, say) must fail loudly rather than be silently
 *   dropped and then defaulted — FR-ORC-03's whole point is that an undeclared
 *   `failureMode` is a validation failure.
 */
export function parseTeamArtifact(text: string): TeamArtifact {
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (err) {
    throw new TeamValidationError(`Team artifact is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  return assertTeamArtifact(raw);
}

/** Validates an already-parsed value against `TeamArtifactSchema`, reporting every
 * failing path (not just the first) so the console can highlight each offending
 * field at once. */
export function assertTeamArtifact(raw: unknown): TeamArtifact {
  if (Value.Check(TeamArtifactSchema, raw)) return raw;
  const fields = [...Value.Errors(TeamArtifactSchema, raw)].map((e) => ({
    path: e.path || "(root)",
    code: "TEAM_ARTIFACT_INVALID",
    message: e.message,
  }));
  throw new TeamValidationError(
    `Team artifact failed structural validation: ${fields.map((f) => `${f.path}: ${f.message}`).join("; ")}`,
    fields,
  );
}

/** Recursively key-sorted canonical form — the same shape/rationale
 * `agent-platform`'s `canonicalize` documents (an array replacer on
 * `JSON.stringify` is a GLOBAL property allow-list, not a per-level sort, and has
 * already caused a real hash-collision bug in this codebase twice). */
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

/** Deterministic sha256 of a team artifact — `team_version.yaml_hash`, the value
 * `teams.immutability.int.test.ts` recomputes on read to prove a stored version was
 * never mutated. */
export function hashTeamArtifact(artifact: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(artifact)), "utf8").digest("hex");
}

/** Splits a `"<definitionName>@<version>"` pin. Returns `null` for anything that
 * isn't exactly that shape — callers turn that into a `TeamValidationError` naming
 * the offending field, rather than guessing at the author's intent. */
export function parseAgentPin(pin: string): { name: string; version: string } | null {
  const at = pin.lastIndexOf("@");
  if (at <= 0 || at === pin.length - 1) return null;
  return { name: pin.slice(0, at), version: pin.slice(at + 1) };
}
