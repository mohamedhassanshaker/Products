// PUBLIC API for "@nextbot/skills" (Target Architecture Blueprint Phase 5, BL-35,
// ADR-0015, LLD §14.5). Everything else in this module is private.

export {
  createSkill,
  listSkills,
  listSkillsForLibrary,
  getSkillById,
  listVersions,
  getVersion,
  createSkillVersion,
  publishVersion,
  deprecateVersion,
  structuralDiffVersions,
  serializeArtifactToYaml,
  parseArtifactFromYaml,
  resolveSkillPin,
  type ResolvedSkillPin,
} from "./application/skill-service.js";

export { resolveSkillScopeReferences, type ResolvedSkillScope } from "./application/skill-reference-resolver.js";

export { buildScopeDescriptor, type ScopeDescriptor } from "./domain/scope-descriptor.js";
export { hashSkillArtifact } from "./domain/skill-hash.js";

export {
  getSkill,
  getSkillVersion,
  // Target Architecture Blueprint Phase 15 (BL-47a) — the null-returning sibling
  // `@nextbot/workflows`' graph validator (V9) uses to resolve a pinned
  // `skillVersionId` against this tenant without a `skills`-flavored throw.
  findSkillVersionById,
  // Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — config export/
  // restore's "reuse an existing identity vs. create a new one" lookup, mirroring
  // `workflows`'/`teams`' own already-exported `findWorkflowByName`/`findTeamByName`.
  findSkillByName,
  getLatestVersionNumber,
  type SkillRow,
  type SkillVersionRow,
  type SkillListItem,
} from "./infrastructure/skill-repository.js";

export {
  handleCreateSkill,
  handleListSkills,
  handleGetSkill,
  handleListVersions,
  handleGetVersion,
  handleCreateVersion,
  handlePublishVersion,
  handleDeprecateVersion,
  handleStructuralDiffVersions,
} from "./http/admin-routes.js";
