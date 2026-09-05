import { index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";

/**
 * Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5) — Module C:
 * Skills. A skill is the platform's first shared, reusable artifact: a named,
 * versioned bundle (trigger, scope, instructions, success criteria, escalation
 * conditions, eval-case references) composed into agent versions (and, later,
 * workflow nodes — Phase 15).
 *
 * Per the user's explicit decision (spec §9.5 item 3, ADR-0015 §2.6): skills are
 * **tenant-scoped only** this build. `skill.tenant_id` is NOT NULL — there is no
 * platform-shared skill library. FR-AGT-15's blueprints gallery (a later phase) will
 * ship as static, platform-authored content copied into the tenant at selection
 * time, never a live cross-tenant reference.
 *
 * Versioning/immutability mirrors `agent_definition_version` (LLD §3.10) exactly,
 * with the three deliberate differences LLD §14.5.1 documents: an integer version
 * ordinal (not semver — `refund_request@3` is the Blueprint's own reference form,
 * needed for an exact, totally-ordered "is this consumer behind?" comparison), a
 * three-state status ladder (`Draft -> Published -> Deprecated` — a skill is
 * composed, never itself deployed, so it gets no second promotion gate), and a
 * relaxed/optional Git backing.
 */

export const skillStatusEnum = pgEnum("skill_status", ["Active", "Archived"]);
export const skillVersionStatusEnum = pgEnum("skill_version_status", ["Draft", "Published", "Deprecated"]);

/** Same relaxed Git-PR-status vocabulary `agent_definition_version` uses (LLD §3.10),
 * reused verbatim rather than declaring a second identical Postgres enum — skill
 * versions may optionally ride the tenant's Git connection (LLD §14.5.1 row 3). */
export const skillGitPrStatusEnum = pgEnum("skill_git_pr_status", ["None", "Open", "Merged", "Closed"]);

/**
 * **skill** — identity row. `current_version_id` intentionally has NO Drizzle-level
 * `.references()` (same pattern `model_route.current_version_id` uses,
 * `model-gateway.ts`) to avoid a circular table-definition reference within this
 * file; the real FK constraint is added by the migration itself, once
 * `skill_version` exists, via a standalone `ALTER TABLE ... ADD CONSTRAINT`.
 */
export const skill = pgTable(
  "skill",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    status: skillStatusEnum("status").notNull().default("Active"),
    /** The latest `Published` version — the default a composer offers. Nullable:
     * a brand-new skill has only a `Draft` version 1 and no published version yet. */
    currentVersionId: uuid("current_version_id"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("skill_tenant_name_key").on(t.tenantId, t.name),
    index("skill_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

/**
 * **skill_version** — immutable once created (LLD §14.5.1's three-layer enforcement:
 * (1) the repository below exposes only `create`/`publish`/`deprecate`, never a
 * generic `update`; (2) migration `0054` adds a `BEFORE UPDATE` trigger
 * `skill_version_immutable` that raises `SKILL_VERSION_IMMUTABLE` for any other
 * column change, so even a raw-SQL path can't bypass (1); (3)
 * `skills.immutability.int.test.ts` recomputes `yaml_hash` on read and compares it
 * to the stored value on every version this suite touches).
 *
 * `scope_knowledge_collection_names` is a **disclosed, additive narrowing** of LLD
 * §14.5.2's literal `scope_knowledge_collection_ids uuid[]`: Knowledge/Graph RAG
 * (blueprint Phase 7+) doesn't exist yet in this codebase — there is no
 * `knowledge_collection` table to resolve a name to a real id against. Per this
 * phase's own brief ("design the schema field to accept collection-name references
 * now... just store the reference, don't build any validation that requires the
 * knowledge subsystem to exist"), this column stores the authored collection
 * *names* verbatim as `text[]`. When Phase 7 ships a real `knowledge_collection`
 * table, a follow-up migration can add `scope_knowledge_collection_ids uuid[]`
 * alongside this column and backfill it by name resolution — no data is lost by
 * choosing the honest representation now instead of a uuid[] column with nothing
 * real to put in it.
 */
export const skillVersion = pgTable(
  "skill_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id),
    version: smallint("version").notNull(),
    yaml: text("yaml").notNull(),
    yamlHash: text("yaml_hash").notNull(),
    trigger: text("trigger").notNull(),
    scopeCapabilityGroupIds: uuid("scope_capability_group_ids").array().notNull().default(sql`'{}'::uuid[]`),
    scopeToolIds: uuid("scope_tool_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** See this table's own doc comment above — a disclosed narrowing of LLD
     * §14.5.2's `scope_knowledge_collection_ids uuid[]` to a name-only column until
     * Knowledge/Graph RAG (Phase 7+) exists. */
    scopeKnowledgeCollectionNames: text("scope_knowledge_collection_names").array().notNull().default(sql`'{}'::text[]`),
    /** `ScopeDescriptorSchema` with `origin: 'Skill'` (LLD §14.5.2) — the descriptor
     * handed to the permission-intersection evaluator (§14.2, Phase 6) verbatim once
     * it ships; derived from the three arrays above plus any authored
     * `rwClasses`/`autonomyCeiling`/`budget`. */
    scopeJson: jsonb("scope_json").notNull(),
    instructions: text("instructions").notNull(),
    successCriteria: text("success_criteria").notNull(),
    escalateWhen: jsonb("escalate_when").notNull().default(sql`'[]'::jsonb`),
    /** FK-less by design (LLD §14.5.2) — eval cases live in `agent-platform`, a
     * module `skills` must not depend on (see the module allow-list). Orphans are
     * swept by a scheduled job; the composer validates them through
     * `agent-platform`'s public API at agent-version save time. */
    evalCaseIds: uuid("eval_case_ids").array().notNull().default(sql`'{}'::uuid[]`),
    status: skillVersionStatusEnum("status").notNull().default("Draft"),
    gitCommitSha: text("git_commit_sha"),
    gitPrNumber: integer("git_pr_number"),
    gitPrStatus: skillGitPrStatusEnum("git_pr_status").notNull().default("None"),
    publishedByUserId: uuid("published_by_user_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    deprecationNote: text("deprecation_note"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("skill_version_tenant_skill_version_key").on(t.tenantId, t.skillId, t.version),
    index("skill_version_tenant_status_idx").on(t.tenantId, t.status),
    index("skill_version_tenant_hash_idx").on(t.tenantId, t.yamlHash),
    index("skill_version_scope_tool_ids_gin_idx").using("gin", t.scopeToolIds),
    index("skill_version_scope_capability_group_ids_gin_idx").using("gin", t.scopeCapabilityGroupIds),
    index("skill_version_scope_knowledge_names_gin_idx").using("gin", t.scopeKnowledgeCollectionNames),
  ],
);
