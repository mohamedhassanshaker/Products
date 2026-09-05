import yaml from "js-yaml";
import { Value } from "@sinclair/typebox/value";
import type { TenantContext } from "@nextbot/db";
import { diffArtifact, type ChangeSet } from "@nextbot/yaml-diff";
import { SkillArtifactSchema, SkillNotFoundError, SkillVersionNotFoundError, SkillVersionStatusInvalidError, type SkillArtifact } from "@nextbot/contracts";
import { hashSkillArtifact } from "../domain/skill-hash.js";
import { buildScopeDescriptor } from "../domain/scope-descriptor.js";
import { resolveSkillScopeReferences } from "./skill-reference-resolver.js";
import {
  createSkill as insertSkill,
  getSkill,
  listSkills as listSkillRows,
  insertSkillVersion,
  listSkillVersions,
  getSkillVersion,
  getLatestVersionNumber,
  publishSkillVersion as publishSkillVersionRow,
  deprecateSkillVersion as deprecateSkillVersionRow,
  findSkillByName,
  findSkillVersionByNumber,
  listSkillsWithSummary,
  type SkillRow,
  type SkillVersionRow,
  type SkillListItem,
} from "../infrastructure/skill-repository.js";

/**
 * Application service for the Skills Library (ADR-0015, LLD §14.5). A skill is
 * created with a real version 1 in one call — there is no "empty" skill. Every
 * subsequent edit creates version N+1, never mutating a prior version
 * (`insertSkillVersion` is the ONLY write path into `skill_version`'s content
 * columns; `publish`/`deprecate` below touch only the three columns LLD §14.5.1
 * names as exempt from immutability).
 */

function validateArtifact(artifact: unknown): SkillArtifact {
  if (!Value.Check(SkillArtifactSchema, artifact)) {
    const errors = [...Value.Errors(SkillArtifactSchema, artifact)].map((e) => `${e.path}: ${e.message}`);
    throw new Error(`Invalid skill artifact: ${errors.join("; ")}`);
  }
  return artifact;
}

/** Resolves scope references, computes the deterministic hash, and re-serializes
 * the artifact with its server-assigned version number (never trusting the
 * authored `artifact.version` — the DB's monotonic counter is authoritative, per
 * ADR-0015 §2.1's "an integer ordinal ... totally ordered"). */
async function prepareVersion(ctx: TenantContext, artifact: SkillArtifact, version: number) {
  const resolved = await resolveSkillScopeReferences(ctx, artifact.scope);
  const finalArtifact: SkillArtifact = { ...artifact, version };
  const yamlText = yaml.dump(finalArtifact);
  const yamlHash = hashSkillArtifact(finalArtifact);
  const scopeJson = buildScopeDescriptor(artifact.scope, resolved);
  return { resolved, finalArtifact, yamlText, yamlHash, scopeJson };
}

export async function createSkill(
  ctx: TenantContext,
  input: { name: string; description?: string; artifact: unknown },
  createdByUserId: string,
): Promise<{ skill: SkillRow; version: SkillVersionRow }> {
  const artifact = validateArtifact(input.artifact);
  // ADR-0015 §2.2 — "a dangling reference is never persisted." Resolve every
  // scope reference BEFORE the skill identity row is created at all: if this
  // throws, nothing — not even an empty `skill` row with zero versions — is
  // written (each of `insertSkill`/`insertSkillVersion` is its own transaction,
  // so ordering here is what keeps a failed create() from leaving an orphan).
  const prepared = await prepareVersion(ctx, artifact, 1);
  const skill = await insertSkill(ctx, { name: input.name, description: input.description, createdByUserId });
  const version = await insertSkillVersion(ctx, {
    skillId: skill.id,
    version: 1,
    yaml: prepared.yamlText,
    yamlHash: prepared.yamlHash,
    trigger: artifact.trigger,
    scopeCapabilityGroupIds: prepared.resolved.capabilityGroupIds,
    scopeToolIds: prepared.resolved.toolIds,
    scopeKnowledgeCollectionNames: artifact.scope.knowledge,
    scopeJson: prepared.scopeJson,
    instructions: artifact.instructions,
    successCriteria: artifact.successCriteria,
    escalateWhen: artifact.escalateWhen,
    evalCaseIds: [],
    createdByUserId,
  });
  return { skill, version };
}

export async function createSkillVersion(ctx: TenantContext, skillId: string, artifactInput: unknown, createdByUserId: string): Promise<SkillVersionRow> {
  const artifact = validateArtifact(artifactInput);
  await getSkill(ctx, skillId); // 404s if not found/not this tenant's
  const nextVersion = (await getLatestVersionNumber(ctx, skillId)) + 1;
  const prepared = await prepareVersion(ctx, artifact, nextVersion);
  return insertSkillVersion(ctx, {
    skillId,
    version: nextVersion,
    yaml: prepared.yamlText,
    yamlHash: prepared.yamlHash,
    trigger: artifact.trigger,
    scopeCapabilityGroupIds: prepared.resolved.capabilityGroupIds,
    scopeToolIds: prepared.resolved.toolIds,
    scopeKnowledgeCollectionNames: artifact.scope.knowledge,
    scopeJson: prepared.scopeJson,
    instructions: artifact.instructions,
    successCriteria: artifact.successCriteria,
    escalateWhen: artifact.escalateWhen,
    evalCaseIds: [],
    createdByUserId,
  });
}

export async function listSkills(ctx: TenantContext): Promise<SkillRow[]> {
  return listSkillRows(ctx);
}

/** The Skills Library list's own shape (name, version, trigger summary) — see
 * `SkillListItem`'s doc comment for why where-used count is resolved separately. */
export async function listSkillsForLibrary(ctx: TenantContext): Promise<SkillListItem[]> {
  return listSkillsWithSummary(ctx);
}

export async function getSkillById(ctx: TenantContext, id: string): Promise<SkillRow> {
  return getSkill(ctx, id);
}

export async function listVersions(ctx: TenantContext, skillId: string): Promise<SkillVersionRow[]> {
  await getSkill(ctx, skillId);
  return listSkillVersions(ctx, skillId);
}

export async function getVersion(ctx: TenantContext, versionId: string): Promise<SkillVersionRow> {
  return getSkillVersion(ctx, versionId);
}

export async function publishVersion(ctx: TenantContext, versionId: string, publishedByUserId: string): Promise<SkillVersionRow> {
  const current = await getSkillVersion(ctx, versionId);
  if (current.status !== "Draft") {
    throw new SkillVersionStatusInvalidError(`Skill version '${versionId}' is '${current.status}', not 'Draft' — only a Draft version can be published.`);
  }
  return publishSkillVersionRow(ctx, versionId, publishedByUserId);
}

export async function deprecateVersion(ctx: TenantContext, versionId: string, note?: string): Promise<SkillVersionRow> {
  const current = await getSkillVersion(ctx, versionId);
  if (current.status === "Deprecated") {
    throw new SkillVersionStatusInvalidError(`Skill version '${versionId}' is already Deprecated.`);
  }
  return deprecateSkillVersionRow(ctx, versionId, note);
}

/** ADR-0016 (FR-AGT-19) — the Git-independent structural diff, reused verbatim
 * (never a second diff mechanism) from Phase 0's `@nextbot/yaml-diff`. */
export async function structuralDiffVersions(ctx: TenantContext, versionAId: string, versionBId: string): Promise<ChangeSet> {
  const [a, b] = await Promise.all([getSkillVersion(ctx, versionAId), getSkillVersion(ctx, versionBId)]);
  return diffArtifact("SkillVersion", a.yaml, b.yaml);
}

/**
 * ADR-0015 §2.1 — resolves an exact `"name@version"` pin (e.g. an agent version's
 * `spec.skills[i]`, or the Blueprint's own `refund_request@3`) to the real,
 * immutable `skill_version` row it names. This is the composition-time lookup
 * `agent-platform`'s `createAgentDefinitionVersion` calls to materialize a pin into
 * `agent_version_skill` — never a late-bound, name-only reference (composition
 * resolves at save time, not turn time).
 */
export interface ResolvedSkillPin {
  skillId: string;
  skillVersionId: string;
  skillName: string;
  version: number;
}

export async function resolveSkillPin(ctx: TenantContext, pin: string): Promise<ResolvedSkillPin> {
  const at = pin.lastIndexOf("@");
  if (at <= 0 || at === pin.length - 1) {
    throw new SkillVersionNotFoundError(pin);
  }
  const name = pin.slice(0, at);
  const versionNumber = Number(pin.slice(at + 1));
  const skill = await findSkillByName(ctx, name);
  if (!skill) throw new SkillNotFoundError(pin);
  const version = await findSkillVersionByNumber(ctx, skill.id, versionNumber);
  if (!version) throw new SkillVersionNotFoundError(pin);
  return { skillId: skill.id, skillVersionId: version.id, skillName: skill.name, version: version.version };
}

export function serializeArtifactToYaml(artifact: SkillArtifact): string {
  return yaml.dump(artifact);
}

export function parseArtifactFromYaml(text: string): unknown {
  return yaml.load(text);
}
