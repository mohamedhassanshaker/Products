import { createHash } from "node:crypto";
import type { KnowledgeAcl } from "@nextbot/contracts";

/**
 * Derives the opaque `acl_tags` denormalization LLD §14.4.2 specifies:
 * `sha256(tenantId‖dimension‖value)[:16]` — the ONLY ACL form ever written to the
 * graph store (ADR-0018 §2.4). Opaque so the graph store never holds a readable
 * role/capability-group name, only an unlinkable hash a caller's own resolved
 * `aclTags` set can be compared against.
 *
 * Mirrors the tiny "copy the pattern, don't cross a module boundary for a ~10-line
 * pure function" convention `packages/modules/authz/src/domain/scope-hash.ts` and
 * `packages/modules/skills/src/domain/skill-hash.ts` already established — this
 * module must not depend on `@nextbot/authz` for one hash function.
 */
function hashAclTag(tenantId: string, dimension: string, value: string): string {
  return createHash("sha256").update(`${tenantId}‖${dimension}‖${value}`, "utf8").digest("hex").slice(0, 16);
}

/**
 * Captured at ingestion (source creation) and propagated verbatim to every
 * downstream chunk/entity/edge (FR-KB-02) — never recomputed once copied onto a
 * chunk (LLD §14.4.2's own callout on `knowledge_chunk.acl_tags`).
 */
export function deriveAclTags(tenantId: string, acl: KnowledgeAcl): string[] {
  const tags = new Set<string>();
  for (const roleId of acl.roleIds ?? []) tags.add(hashAclTag(tenantId, "role", roleId));
  for (const groupId of acl.capabilityGroupIds ?? []) tags.add(hashAclTag(tenantId, "capabilityGroup", groupId));
  for (const tag of acl.tags) tags.add(hashAclTag(tenantId, "tag", tag));
  // Visibility itself is also a dimension: a "Tenant"-visible source's content is
  // reachable by any caller whose scope doesn't otherwise restrict it, so it gets
  // its own always-present tag rather than being encoded as an absence of tags
  // (an absent tag set would otherwise be indistinguishable from "no ACL captured
  // at all", which this module never wants to be ambiguous about).
  tags.add(hashAclTag(tenantId, "visibility", acl.visibility));
  return [...tags].sort();
}

/** Merges (union of) multiple chunks'/entities' acl_tags sets — used when an
 *  entity/edge/community's acl_tags is derived from more than one provenance chunk
 *  (LLD §14.4.2: `graph_entity.acl_tags` is "union of the acl_tags of every
 *  provenance chunk"; `graph_community.acl_tags` is "union over member entities"). */
export function unionAclTags(...tagSets: string[][]): string[] {
  const union = new Set<string>();
  for (const tags of tagSets) for (const t of tags) union.add(t);
  return [...union].sort();
}
