import { withPlatform } from "../platform-context.js";
import { schema } from "../index.js";
import { generateId } from "../id.js";
import type { TenantContext } from "../tenant-context.js";
import { getOwnerPool } from "../pool.js";

/**
 * Test-only fixture: creates a minimal, valid tenant (+ its 1:1 data policy and
 * runtime quota rows, mirroring what `provisionTenant()` produces) via the BYPASSRLS
 * platform role, and returns a ready-to-use `TenantContext` for `withTenant` calls in
 * integration/isolation tests. Not exported from the package's "." entry point —
 * only from `@nextbot/db/testing` — so it can never end up in production code paths.
 */
export async function createFixtureTenant(
  overrides: Partial<{ name: string; slug: string; region: TenantContext["region"] }> = {},
): Promise<TenantContext> {
  const id = generateId();
  // NOTE: `id` is a UUIDv7 (time-ordered) — its leading hex characters are mostly a
  // millisecond timestamp, so two fixture tenants created within the same test run
  // (routinely within the same millisecond once test suites got bigger in Phase 2+)
  // could collide on an 8-char prefix of `id` alone. Mixing in `crypto.randomUUID()`
  // makes the name/slug suffix collision-resistant regardless of timing.
  const suffix = `${id.slice(0, 8)}${crypto.randomUUID().slice(0, 8)}`;
  const region = overrides.region ?? "US";

  await withPlatform(async (db) => {
    await db.insert(schema.tenant).values({
      id,
      name: overrides.name ?? `Fixture Tenant ${suffix}`,
      slug: overrides.slug ?? `fixture-${suffix}`,
      region,
      defaultLanguage: "en",
    });
    await db.insert(schema.tenantDataPolicy).values({
      tenantId: id,
      retentionTranscriptsDays: 365,
      retentionToolPayloadsDays: 90,
      retentionToolMetadataDays: 365,
      retentionPiiDays: 30,
      residencyRegion: region,
    });
    await db.insert(schema.tenantRuntimeQuota).values({ tenantId: id });
  });

  return { tenantId: id, region, environment: "Sandbox" };
}

/**
 * Test-only teardown: deletes a fixture tenant and every row any later phase's
 * schema hangs off it, via the platform (BYPASSRLS) role, in FK-safe (children
 * first) order. Each phase that adds a new tenant-scoped table should append it here
 * — a stale table left out only shows up as a one-off FK-violation test failure, not
 * a silent leak, so this list failing to keep up is self-correcting in practice.
 */
export async function deleteFixtureTenant(tenantId: string): Promise<void> {
  // `audit_log_entry` is genuinely append-only for both the "app" and "platform"
  // roles (`ensure-roles.ts` REVOKEs UPDATE/DELETE from both, Phase 17/BL-10) — so
  // `withPlatform`'s BYPASSRLS role cannot clean it up like every other
  // tenant-scoped table below. Only the schema-owner role (migrations/bootstrap
  // only, never used by application code) retains DELETE on this table; test-only
  // cleanup uses it directly, exactly once, for this one table.
  await getOwnerPool().query(`DELETE FROM audit_log_entry WHERE tenant_id = $1`, [tenantId]);

  await withPlatform(async (db) => {
    const { sql } = await import("drizzle-orm");
    // `tool` <-> `tool_schema_version` is a genuine FK cycle (`tool.current_schema_
    // version_id -> tool_schema_version.id` and `tool_schema_version.tool_id ->
    // tool.id`), so no single delete order works for that pair — null out the
    // forward pointer first, in the same transaction, before either DELETE runs.
    await db.execute(sql`UPDATE tool SET current_schema_version_id = NULL WHERE tenant_id = ${tenantId}`);

    // mcp-registry (Phase 6, BL-29) — `mcp_server.current_version_id` and `mcp_
    // manifest_item.supersedes_item_id`/`mcp_server_version.supersedes_version_id`
    // are each a genuine FK cycle with their own table (server <-> server_version;
    // item <-> item; version <-> version), so null out every forward self/cross
    // pointer first, in the same transaction, before any DELETE below runs — same
    // pattern as the `tool`/`tool_schema_version` cycle handled above.
    await db.execute(sql`UPDATE mcp_server SET current_version_id = NULL WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`UPDATE mcp_server_version SET supersedes_version_id = NULL WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`UPDATE mcp_manifest_item SET supersedes_item_id = NULL WHERE tenant_id = ${tenantId}`);

    // Phase 2 (BL-33) — `model_route.current_version_id` <-> `model_route_version.route_id`
    // is the same shape of genuine FK cycle as `mcp_server`/`mcp_server_version` above.
    await db.execute(sql`UPDATE model_route SET current_version_id = NULL WHERE tenant_id = ${tenantId}`);

    // Target Architecture Blueprint Phase 5 (BL-35) — `skill.current_version_id` <->
    // `skill_version.skill_id` is the same shape of genuine FK cycle.
    await db.execute(sql`UPDATE skill SET current_version_id = NULL WHERE tenant_id = ${tenantId}`);

    // Target Architecture Blueprint Phase 12 (BL-44) — `eval_run.baseline_run_id`
    // is a genuine self-referencing FK (the prior Continuous run a later run's
    // `regressed` verdict was compared against), same shape as `mcp_server_
    // version.supersedes_version_id` above.
    await db.execute(sql`UPDATE eval_run SET baseline_run_id = NULL WHERE tenant_id = ${tenantId}`);

    // Target Architecture Blueprint Phase 7b (BL-38) — two genuine FK cycles:
    // `knowledge_collection.current_generation_id` <-> `knowledge_index_generation.
    // collection_id`, and `graph_entity.community_id` <-> `graph_community` (via
    // generation, not a direct self-cycle, but graph_entity must still be nulled
    // before graph_community can be deleted while graph_entity rows still exist).
    await db.execute(sql`UPDATE knowledge_collection SET current_generation_id = NULL WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`UPDATE graph_entity SET community_id = NULL WHERE tenant_id = ${tenantId}`);

    // Target Architecture Blueprint Phase 14 (BL-46) — `team.current_version_id`
    // <-> `team_version.team_id` is the same shape of genuine FK cycle as
    // `skill`/`skill_version` above. `team_member.fallback_member_id` is a
    // self-referencing FK, but it needs no null-out pass here: it is declared
    // DEFERRABLE INITIALLY DEFERRED (migration `0076`), so deleting a whole
    // tenant's members inside this one transaction is checked at COMMIT, by which
    // point no referencing row survives. (`team_member` is also UPDATE-blocked by
    // its own immutability trigger, so a null-out pass would not be possible
    // anyway — the deferred constraint is what makes teardown work without
    // weakening that trigger.)
    await db.execute(sql`UPDATE team SET current_version_id = NULL WHERE tenant_id = ${tenantId}`);

    // Target Architecture Blueprint Phase 15 (BL-47a) — `workflow.current_version_id`
    // <-> `workflow_version.workflow_id` is the same shape of genuine FK cycle as
    // `skill`/`skill_version` and `team`/`team_version` above.
    await db.execute(sql`UPDATE workflow SET current_version_id = NULL WHERE tenant_id = ${tenantId}`);

    // Target Architecture Blueprint Phase 16 (BL-47b) — `workflow_version.
    // sandbox_run_id -> workflow_run.id` (FK completed by migration `0081`) points
    // the OTHER way from `workflow_run.workflow_version_id`, so the pair is a genuine
    // CROSS-TABLE cycle exactly like `workflow`/`workflow_version` above, and the two
    // deletes are necessarily separate statements. Null the forward pointer first.
    //
    // `workflow_run.parent_run_id` and `workflow_run_step.compensation_of_step_id` are
    // SELF-references and deliberately get no null-out pass: both are `NO ACTION` FKs,
    // so referential integrity is checked at end-of-statement and one bulk
    // `DELETE ... WHERE tenant_id = $1` removes parents and children together. Nulling
    // `parent_run_id` would in fact FAIL, since the `workflow_run_parent_implies_
    // subworkflow` CHECK requires a `SubWorkflow`-triggered run to keep its parent.
    await db.execute(sql`UPDATE workflow_version SET sandbox_run_id = NULL WHERE tenant_id = ${tenantId}`);

    // Target Architecture Blueprint Phase 17 (BL-48) — `channel.agent_definition_id`
    // (migration `0084`) is not a cycle, but it does point "backwards" relative to this
    // list's existing order: `channel` is deleted near the very bottom (it is a parent of
    // `conversation`/`meta_business_account`), while `agent_definition` is deleted much
    // earlier. Rather than reshuffle a carefully-ordered list that many phases depend on,
    // null the forward pointer here — the same technique already used for every genuine
    // cycle above.
    await db.execute(sql`UPDATE channel SET agent_definition_id = NULL WHERE tenant_id = ${tenantId}`);

    const tablesInChildFirstOrder = [
      // Target Architecture Blueprint Phase 17 (BL-48/BL-13, ADR-0019) — progressive
      // rollout. Deleted FIRST because between them they FK `deployment`,
      // `agent_definition`, `agent_definition_version` and `agent_run`, all of which are
      // deleted much further down; `shadow_run` before `shadow_evaluation` (its parent).
      // No forward-pointer null-out pass is needed: neither `shadow_run.live_agent_run_id`
      // nor `.shadow_agent_run_id` is part of a cycle — `agent_run` has no FK back to
      // either table.
      "shadow_run",
      "shadow_evaluation",
      "deployment_traffic_assignment",
      // Target Architecture Blueprint Phase 10 (BL-41) — no FK dependents of its
      // own, but itself FKs `agent_run`/`agent_definition_version`/`knowledge_
      // index_generation`/`knowledge_collection`, all deleted further below — must
      // come first.
      "retrieval_event",
      // Target Architecture Blueprint Phase 12 (BL-43) — the Studio's own scratch
      // draft FKs `agent_definition` and must precede its own delete further below;
      // `agent_blueprint` has no FK dependents of its own.
      "studio_draft",
      "agent_blueprint",
      // Phase 6 (BL-37) — no FK dependents of their own; deleted early purely
      // for list hygiene (both are always empty in a fixture tenant's lifetime
      // today — no live writer exists yet for either).
      "delegation_event",
      "tenant_scope_policy",
      // Target Architecture Blueprint Phase 14 (BL-46) — Module E, children first.
      // Must precede `tool` (team_member.tool_id), `agent_definition_version`
      // (team_member.definition_version_id / team_version.supervisor_definition_
      // version_id) and `model_route_version` (team_version.supervisor_route_
      // version_id), all deleted further below. `delegation_event` above already
      // precedes these, since it now FKs both team tables.
      "team_member",
      "team_version",
      "team",
      // Target Architecture Blueprint Phase 15 (BL-47a) — no FK dependents of its
      // own (every pinned reference a workflow node names — agent/skill/tool/mcp-
      // server-version/route/sub-workflow — lives inside `graph_json`, never a real
      // FK column), so ordering relative to those tables doesn't matter; only
      // `workflow_version` before `workflow` (its own FK cycle, nulled above).
      //
      // Target Architecture Blueprint Phase 16 (BL-47b) — the durable-execution
      // tables must precede `workflow_version` (workflow_run.workflow_version_id) and
      // `tool_call` (workflow_run_step.tool_call_id). `workflow_run_lease` and
      // `workflow_run_step` both cascade from `workflow_run`, but they are listed
      // explicitly and first anyway: relying on ON DELETE CASCADE for teardown would
      // hide a real FK-ordering regression the day either gains a dependent of its
      // own. `workflow_version.sandbox_run_id -> workflow_run.id` (the FK migration
      // 0081 finally completes) is nulled out above, alongside the other cycles.
      "workflow_run_step",
      "workflow_run_lease",
      "workflow_run",
      "workflow_version",
      "workflow",
      // Target Architecture Blueprint Phase 7b (BL-38, ADR-0018, LLD §14.4) —
      // children before parents. Must precede `model_route_version`/`model_
      // catalog_entry`/`model_provider`'s own deletes further below (knowledge_
      // collection/knowledge_index_generation FK them). graph_entity/graph_
      // community's mutual cycle was already broken by the UPDATE above.
      "graph_entity_merge_candidate",
      "graph_edge",
      "graph_entity",
      "graph_community",
      "knowledge_ingestion_job",
      "knowledge_embedding_d384",
      "knowledge_embedding_d768",
      "knowledge_embedding_d1024",
      "knowledge_embedding_d1536",
      "knowledge_embedding_d3072",
      "knowledge_chunk",
      "knowledge_document",
      "knowledge_index_generation",
      "knowledge_source",
      "knowledge_collection",
      // audit (Phase 17) — deleted above via the owner pool, before this
      // `withPlatform` block, since the platform role cannot DELETE from this
      // genuinely append-only table.
      // mcp-registry (Phase 6, BL-29; Phase 3, BL-34) — children before
      // `mcp_server`/`capability_group`. `mcp_environment_binding` (Phase 3) FKs to
      // `mcp_server_version` and must be deleted before it; `mcp_enrolment_draft`
      // FKs to `mcp_server` (nullable) and must be deleted before it too.
      "mcp_drift_event",
      "mcp_environment_binding",
      "mcp_enrolment_draft",
      "mcp_manifest_item",
      "mcp_server_version",
      "mcp_server",
      // pii (Phase 17)
      "data_subject_request",
      "guardrail_event",
      "guardrail_rule",
      "pii_policy",
      "pii_rule",
      // connectors (Phase 18) — must precede the `connector`/`credential` deletes below.
      "connector_alert_rule",
      "connector_health_check",
      // escalations (Phase 16) — children before parents; `escalation` FKs
      // `conversation`/`app_user` so must be deleted before either. Target
      // Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) adds
      // `escalation_assignment_log`, which FKs `escalation` (and `app_user` via
      // `user_id`/`actor_user_id`) — must precede both.
      "escalation_assignment_log",
      "escalation_routing_rule",
      "escalation",
      "agent_queue",
      // approvals (Phase 14) — children before parents
      "tool_call_event",
      "approval_request",
      "tool_call",
      // tool-registry (Phase 6). Target Architecture Blueprint Phase 14 (BL-46)
      // MOVED this block to precede `agent_definition_version`: `tool` now carries a
      // real `agent_definition_version_id` FK (an `AgentAsTool` catalog entry pins the
      // specialist version it delegates to, LLD §14.7.1), so deleting versions first
      // violates `tool_agent_definition_version_id_fkey`. Every prior ordering
      // constraint still holds — `tool`'s own dependents (`tool_permission_rule`,
      // `tool_schema_version`, and Phase 14's `team_member`) are all deleted above
      // it, and its own parents (`connector`, `capability_group`) below it.
      "tool_permission_rule",
      "tool_schema_version",
      "tool",
      "capability_group",
      // agent-platform (Phase 10) — children before parents
      "agent_run",
      "model_cache_entry",
      // Phase 2 (BL-33, LLD §14.8.6 M6) — `model_call_log` renamed to
      // `model_usage_event` (same physical table).
      "model_usage_event",
      "model_budget",
      "deployment_history",
      "deployment",
      "eval_case_result",
      "eval_run",
      "eval_case",
      "eval_suite",
      // Phase 2 (BL-33) — `agent_definition_version.model_route_version_id` is a real,
      // NOT NULL FK onto `model_route_version` (unlike the old free-text
      // `model_route_key` column), so the version row must be deleted BEFORE
      // `model_route_version`, which must in turn be deleted before its own parent
      // `model_route` (`current_version_id` was already nulled above, closing that
      // table's own FK cycle the same way `mcp_server`'s was).
      // Target Architecture Blueprint Phase 5 (BL-35) — `agent_version_skill`
      // before `agent_definition_version` (FK) and before `skill_version`/`skill`
      // (both FK'd too); `skill_version` before `skill`.
      "agent_version_skill",
      "agent_definition_version",
      "agent_definition",
      "skill_version",
      "skill",
      "model_route_version",
      "model_route",
      // Target Architecture Blueprint Phase 1 (BL-32, ADR-0011) — `model_catalog_entry`
      // before `model_provider` (FK), both before `credential` further below
      // (`model_provider.credential_id` FK).
      "model_catalog_entry",
      "model_provider",
      "git_connection",
      // conversations (Phase 7)
      "message",
      "conversation",
      // whatsapp (Phase 3+ dispatch, BL-15) — children before `meta_business_account`,
      // which itself must precede `channel`/`credential` below (FKs both).
      "consent_import_log",
      "consent_record",
      "whatsapp_template",
      "whatsapp_number",
      "meta_business_account",
      // channels (Phase 7)
      "channel",
      // Target Architecture Blueprint Phase 18 (BL-49) — `webhook_subscription` FKs
      // `credential` (its signing secret) and must precede it below; `webhook_delivery`
      // FKs `webhook_subscription` and must precede that. `otel_export_config`/
      // `siem_export_config` have no FK dependents of their own.
      "webhook_delivery",
      "webhook_subscription",
      "otel_export_config",
      "siem_export_config",
      // connectors (Phase 4)
      "connector",
      "credential",
      // iam (Phase 2)
      // Phase 4 (BL-36) additions — must precede app_user/role (both FK-reference them).
      "api_key",
      "scim_token",
      "auth_session",
      "sso_connection",
      "user_role",
      "mfa_secret",
      "sso_group_mapping",
      // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — `agent_presence`
      // FKs `app_user` (`user_id`) and must be deleted before it. Already handled
      // above for `escalation_assignment_log`'s own `user_id`/`actor_user_id` FKs.
      "agent_presence",
      "app_user",
      "role",
      "login_lockout_policy",
      "login_attempt",
      // tenancy (Phase 1); Phase 7a (ADR-0018) adds the Neo4j routing row —
      // deleting the Postgres row here does NOT drop the real Neo4j database
      // itself; a graph-store integration test that provisioned one must drop it
      // separately via `@nextbot/graph-store/provisioning`'s own teardown helper.
      "tenant_graph_database_route",
      "tenant_database_route",
      "tenant_runtime_quota",
      "tenant_data_policy",
      // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — cross-channel
      // identity resolution's tenant-opt-in toggle.
      "tenant_identity_resolution_policy",
      // Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — break-glass
      // operator access's tenant-side consent grant. FK-less `granted_by_user_id`/
      // `revoked_by_user_id` (see the schema's own doc comment), so no ordering
      // constraint relative to `app_user` — placed here for locality with its sibling
      // tenant-opt-in tables, not because it must precede anything below.
      "tenant_breakglass_grant",
    ];
    for (const table of tablesInChildFirstOrder) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`);
    }
    await db.execute(sql`DELETE FROM tenant WHERE id = ${tenantId}`);
  });
}

/**
 * Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8.7) — test-only
 * fixture for a **platform-shared** (`tenant_id IS NULL`) `model_provider` row.
 * Writing such a row requires `withPlatform()`, callable only from tenancy
 * provisioning / `/api/internal/ops/**` / `packages/db/src` (the
 * `no-platform-outside-allowed-callers` dependency-cruiser rule) — this helper is
 * `@nextbot/model-gateway`'s integration tests' only legitimate way to seed a
 * platform row without violating that boundary from inside the module itself. Not
 * exported from the package's "." entry point, same convention as
 * `createFixtureTenant`.
 */
export async function createFixturePlatformModelProvider(input: {
  id?: string;
  type: string;
  name: string;
  baseUrl?: string;
  region?: "UAE" | "EU" | "US";
}): Promise<string> {
  const id = input.id ?? generateId();
  await withPlatform((db) =>
    db.insert(schema.modelProvider).values({
      id,
      tenantId: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture accepts a plain string for any provider type value
      type: input.type as any,
      name: input.name,
      baseUrl: input.baseUrl,
      region: input.region ?? "UAE",
      authMethod: "None",
    }),
  );
  return id;
}

export async function deleteFixturePlatformModelProvider(id: string): Promise<void> {
  await withPlatform(async (db) => {
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.modelCatalogEntry).where(eq(schema.modelCatalogEntry.providerId, id));
    await db.delete(schema.modelProvider).where(eq(schema.modelProvider.id, id));
  });
}
