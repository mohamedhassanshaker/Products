import yaml from "js-yaml";
import type { TenantContext } from "@nextbot/db";
import type { AgentDefinitionArtifact, SkillWhereUsedResponse, UpgradeConsumersRequest, UpgradeConsumersResponse } from "@nextbot/contracts";
import { getSkill, getSkillVersion } from "@nextbot/skills";
import { getAgentDefinition, getAgentDefinitionVersion } from "../infrastructure/agent-definition-repository.js";
import {
  listConsumerDefinitionIdsForSkill,
  resolveHeadVersionForDefinition,
  getPinForSkill,
  findPendingUpgradeDraft,
} from "../infrastructure/agent-version-skill-repository.js";
import { createAgentDefinitionVersion } from "./agent-definition-service.js";

/**
 * ADR-0015 §2.3/§2.4, LLD §14.5.4 — the where-used index and the "upgrade
 * consumers" action. Both live in `agent-platform` (not `skills`) because they
 * read/write `agent_definition_version`/`agent_version_skill`, which
 * `agent-platform` owns — `skills` never depends on `agent-platform` (that edge
 * would be a cycle; see the module allow-list's own comment).
 */

interface ConsumerFact {
  agentDefinitionId: string;
  headVersionId: string;
  headVersionLabel: string;
  headVersionStatus: string;
  pinnedVersionNumber: number | null;
}

/** For every agent definition that has ever composed this skill (any of its own
 * versions), resolves that definition's current head (latest non-Draft version)
 * and how that head version is currently pinned to this skill, if at all. */
async function collectConsumerFacts(ctx: TenantContext, skillId: string): Promise<ConsumerFact[]> {
  const definitionIds = await listConsumerDefinitionIdsForSkill(ctx, skillId);
  const facts: ConsumerFact[] = [];
  for (const agentDefinitionId of definitionIds) {
    const head = await resolveHeadVersionForDefinition(ctx, agentDefinitionId);
    if (!head) continue; // every version is Draft — nothing "in production use" to report yet
    const pin = await getPinForSkill(ctx, head.id, skillId);
    facts.push({
      agentDefinitionId,
      headVersionId: head.id,
      headVersionLabel: head.version,
      headVersionStatus: head.status,
      pinnedVersionNumber: pin ? (await getSkillVersion(ctx, pin.skillVersionId)).version : null,
    });
  }
  return facts;
}

/** ADR-0015 §2.3 — "the Skills Library's where-used panel is a read of that index."
 * Workflows (Phase 15) will union in `workflow_version_skill` once that module
 * exists; only the agent-version half is reachable today. */
export async function getSkillWhereUsed(ctx: TenantContext, skillId: string): Promise<SkillWhereUsedResponse> {
  const skill = await getSkill(ctx, skillId);
  const currentPublishedVersion = skill.currentVersionId ? (await getSkillVersion(ctx, skill.currentVersionId)).version : null;
  const facts = await collectConsumerFacts(ctx, skillId);

  const consumers = await Promise.all(
    facts
      .filter((f) => f.pinnedVersionNumber !== null)
      .map(async (f) => {
        const definition = await getAgentDefinition(ctx, f.agentDefinitionId);
        const pendingDraft = currentPublishedVersion
          ? await findExistingPendingDraft(ctx, f, skillId, currentPublishedVersion)
          : null;
        return {
          consumerKind: "AgentVersion" as const,
          consumerId: f.headVersionId,
          consumerLabel: `${definition.name} ${f.headVersionLabel}`,
          consumerStatus: f.headVersionStatus,
          pinnedSkillVersion: f.pinnedVersionNumber!,
          behindBy: currentPublishedVersion ? Math.max(0, currentPublishedVersion - f.pinnedVersionNumber!) : 0,
          pendingUpgradeDraftId: pendingDraft,
        };
      }),
  );

  return { consumers, currentPublishedVersion };
}

async function findExistingPendingDraft(ctx: TenantContext, fact: ConsumerFact, skillId: string, currentPublishedVersion: number): Promise<string | null> {
  const skill = await getSkill(ctx, skillId);
  if (!skill.currentVersionId || fact.pinnedVersionNumber === currentPublishedVersion) return null;
  const pending = await findPendingUpgradeDraft(ctx, fact.agentDefinitionId, fact.headVersionId, skill.currentVersionId);
  return pending?.id ?? null;
}

/** Bumps a semver-shaped label's patch component (mirrors the console's own
 * `suggestNextVersion` — kept in sync deliberately, not imported, since this is a
 * server-side job and that helper lives in `apps/web`'s client component). Falls
 * back to a `-skill-upgrade` suffix for a non-semver label, same degrade the
 * console uses for a "Restore"-sourced label. */
function bumpVersionLabel(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) return `${version}-skill-upgrade`;
  const [, major, minor, patch, rest] = match;
  return `${major}.${minor}.${Number(patch) + 1}${rest}`;
}

/**
 * ADR-0015 §2.4 — generates a new Draft agent version per stale consumer, each
 * re-pinned to `toSkillVersionId`, WITHOUT mutating the consumer's existing
 * immutable version. Every generated Draft goes through the ordinary promotion
 * gate like any other Draft — this function never sets a status other than
 * `Draft` (that's `createAgentDefinitionVersion`'s own hardcoded default; nothing
 * here can override it).
 */
export async function upgradeConsumers(ctx: TenantContext, skillId: string, request: UpgradeConsumersRequest, actingUserId: string | null): Promise<UpgradeConsumersResponse> {
  const targetVersion = await getSkillVersion(ctx, request.toSkillVersionId);
  const facts = await collectConsumerFacts(ctx, skillId);
  const scoped = request.consumerIds ? facts.filter((f) => request.consumerIds!.includes(f.headVersionId)) : facts;

  const created: UpgradeConsumersResponse["created"] = [];
  const skipped: UpgradeConsumersResponse["skipped"] = [];

  for (const fact of scoped) {
    if (fact.pinnedVersionNumber === null) {
      skipped.push({ consumerId: fact.headVersionId, reason: "ValidationFailed", detail: "This version does not currently compose the skill." });
      continue;
    }
    if (fact.pinnedVersionNumber >= targetVersion.version) {
      skipped.push({ consumerId: fact.headVersionId, reason: "AlreadyOnTargetVersion" });
      continue;
    }
    if (fact.headVersionStatus === "Deprecated") {
      skipped.push({ consumerId: fact.headVersionId, reason: "ConsumerDeprecated" });
      continue;
    }

    // ADR-0015 §2.4 step 1 — the idempotency guard: a pending (still-Draft, not yet
    // promoted) upgrade draft for this exact (consumer, target) pair already
    // exists. A partial unique index on `agent_definition_version` backstops this
    // at the database level; this check just avoids the round-trip when possible.
    const pending = await findPendingUpgradeDraft(ctx, fact.agentDefinitionId, fact.headVersionId, request.toSkillVersionId);
    if (pending) {
      skipped.push({ consumerId: fact.headVersionId, reason: "PendingUpgradeDraftExists", detail: `Draft version ${pending.version} is already pending.` });
      continue;
    }

    if (request.dryRun) {
      // Dry-run: report what *would* happen without writing anything.
      created.push({ consumerId: fact.headVersionId, newDraftVersionId: "dry-run", newVersionLabel: bumpVersionLabel(fact.headVersionLabel) });
      continue;
    }

    try {
      const source = await getAgentDefinitionVersion(ctx, fact.headVersionId);
      const parsed = yaml.load(source.definitionYaml) as { spec?: { skills?: string[] } } & Record<string, unknown>;
      const skill = await getSkill(ctx, skillId);
      const oldPin = `${skill.name}@${fact.pinnedVersionNumber}`;
      const newPin = `${skill.name}@${targetVersion.version}`;
      // ADR-0015 §2.4 step 4 — "unchanged pins for every other skill": mapping
      // over the FULL `spec.skills` array (not just the pin being upgraded) means
      // every other composed skill's pin string is carried forward verbatim, and
      // `createAgentDefinitionVersion` below re-resolves the whole array and
      // rewrites `agent_version_skill` fresh for this new draft — no separate
      // pin-copying step is needed.
      const spec = (parsed.spec ?? {}) as { skills?: string[] } & Record<string, unknown>;
      const newSkills = (spec.skills ?? []).map((p) => (p === oldPin ? newPin : p));
      const newArtifact = { ...parsed, spec: { ...spec, skills: newSkills } };
      const newVersionLabel = bumpVersionLabel(fact.headVersionLabel);

      const draft = await createAgentDefinitionVersion(
        ctx,
        fact.agentDefinitionId,
        { version: newVersionLabel, graphType: source.graphType, modelRouteKey: source.modelRouteKey, artifact: newArtifact as AgentDefinitionArtifact },
        actingUserId,
        { upgradeSourceVersionId: fact.headVersionId, upgradedSkillVersionId: request.toSkillVersionId },
      );
      created.push({ consumerId: fact.headVersionId, newDraftVersionId: draft.id, newVersionLabel: draft.version });
    } catch (err) {
      // ADR-0015 §2.4 — "failures are per-consumer... does not block upgrades for
      // the other consumers." A validation failure (e.g. the new skill version
      // references a tool this consumer's agent isn't permitted) is reported by
      // name, never thrown up and aborting the whole batch.
      skipped.push({ consumerId: fact.headVersionId, reason: "ValidationFailed", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  return { created, skipped };
}
