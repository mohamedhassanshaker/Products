import type { TenantContext } from "@nextbot/db";
import type { CreateSkillRequest, CreateSkillVersionRequest, DeprecateSkillVersionRequest } from "@nextbot/contracts";
import * as skills from "../application/skill-service.js";

/** `http/` layer (LLD §2.2) — plain functions; RBAC checks (`agent_platform` module,
 * per spec §5.2's "Changed — now also gates skills") are applied by the composition
 * root (`apps/web`), same pattern as every other module's `http/admin-routes.ts`. */

export async function handleCreateSkill(ctx: TenantContext, input: CreateSkillRequest, createdByUserId: string) {
  return skills.createSkill(ctx, input, createdByUserId);
}

export async function handleListSkills(ctx: TenantContext) {
  return skills.listSkillsForLibrary(ctx);
}

export async function handleGetSkill(ctx: TenantContext, id: string) {
  return skills.getSkillById(ctx, id);
}

export async function handleListVersions(ctx: TenantContext, skillId: string) {
  return skills.listVersions(ctx, skillId);
}

export async function handleGetVersion(ctx: TenantContext, versionId: string) {
  return skills.getVersion(ctx, versionId);
}

export async function handleCreateVersion(ctx: TenantContext, skillId: string, input: CreateSkillVersionRequest, createdByUserId: string) {
  return skills.createSkillVersion(ctx, skillId, input.artifact, createdByUserId);
}

export async function handlePublishVersion(ctx: TenantContext, versionId: string, publishedByUserId: string) {
  return skills.publishVersion(ctx, versionId, publishedByUserId);
}

export async function handleDeprecateVersion(ctx: TenantContext, versionId: string, input: DeprecateSkillVersionRequest) {
  return skills.deprecateVersion(ctx, versionId, input.note);
}

export async function handleStructuralDiffVersions(ctx: TenantContext, versionAId: string, versionBId: string) {
  return skills.structuralDiffVersions(ctx, versionAId, versionBId);
}
