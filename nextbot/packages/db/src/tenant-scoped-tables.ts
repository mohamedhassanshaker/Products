/**
 * Manifest of every tenant-scoped table (LLD §3.2 rule 1). Every dev phase that adds
 * a tenant-scoped table must append its name here — `rls-coverage.isolation.test.ts`
 * asserts `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a
 * `tenant_isolation` policy exist for every table listed, so a migration that adds a
 * tenant-scoped table without the required three statements fails CI generically,
 * without each module having to hand-write its own copy of this check.
 */
export const TENANT_SCOPED_TABLES = [
  "tenant_data_policy",
  "tenant_runtime_quota",
  "tenant_database_route",
  // Target Architecture Blueprint Phase 7a (ADR-0018) — the Neo4j-per-tenant
  // routing row.
  "tenant_graph_database_route",
  "domain_event",
  "app_user",
  "role",
  "user_role",
  "sso_group_mapping",
  "login_lockout_policy",
  "mfa_secret",
  // Phase 4 (BL-36, FR-SEC-10).
  "sso_connection",
  "auth_session",
  "scim_token",
  "api_key",
  "credential",
  "connector",
  "capability_group",
  "tool",
  "tool_schema_version",
  "tool_permission_rule",
  // channels (Phase 7)
  "channel",
  // conversations (Phase 7) — `channel_capability` is deliberately absent: it is
  // static, non-tenant-scoped reference data (LLD §3.4), same category as
  // `login_lockout_policy` would be if it weren't tenant-tunable.
  "conversation",
  "message",
  // `login_attempt` has a nullable tenant_id (an attempt against an unresolvable
  // email cannot always be mapped to a tenant) but still carries RLS + a policy
  // (see packages/db/migrations/0004_iam_rls.sql) — the generic coverage test below
  // only asserts RLS/FORCE/policy presence, which holds for it too.
  "login_attempt",
  // agent-platform (Phase 10) — `model_provider` is deliberately absent: platform-
  // level reference data with no `tenant_id` column at all (see
  // packages/db/src/schema/agent-platform.ts's module doc), same category as
  // `channel_capability`.
  "git_connection",
  "agent_definition",
  "agent_definition_version",
  "eval_suite",
  "eval_case",
  "eval_run",
  "eval_case_result",
  "deployment",
  "deployment_history",
  "model_route",
  // Phase 2 (BL-33) — Route v2's immutable version row (LLD §14.8.2).
  "model_route_version",
  "model_budget",
  // Phase 2 (BL-33, LLD §14.8.6 M6) — `model_call_log` renamed to `model_usage_event`
  // in place (same physical table, RLS policy carried over automatically through the
  // rename).
  "model_usage_event",
  "model_cache_entry",
  "agent_run",
  // approvals (Phase 14, BL-08) — Tier-2/3 approval-tier FSM tables (LLD §6).
  "tool_call",
  "approval_request",
  "tool_call_event",
  // escalations (Phase 16, BL-09) — escalation queue, routing, live takeover.
  "agent_queue",
  "escalation",
  "escalation_routing_rule",
  // audit (Phase 17, BL-10) — append-only (UPDATE/DELETE revoked in ensure-roles.ts,
  // not expressible in this RLS-only manifest, but RLS/FORCE/policy still apply).
  "audit_log_entry",
  // pii (Phase 17, BL-10) — detection rules, masking policy matrix, guardrail
  // authoring, DSR tool.
  "pii_rule",
  "pii_policy",
  "guardrail_rule",
  "data_subject_request",
  // Phase 6 (BL-30) — the PostToolResult prompt-injection guardrail's audit trail.
  "guardrail_event",
  // connectors (Phase 18, BL-11) — MCP health monitoring + alerting.
  "connector_health_check",
  "connector_alert_rule",
  // whatsapp (Phase 3+ dispatch, BL-15) — Meta Business Manager link, WABA phone
  // numbers, synced templates, opt-in/consent tracking (LLD §12.3).
  "meta_business_account",
  "whatsapp_number",
  "whatsapp_template",
  "consent_record",
  "consent_import_log",
  // mcp-registry (Phase 6, BL-29, ADR-0014) — manifest pinning + drift quarantine.
  "mcp_server",
  "mcp_server_version",
  "mcp_manifest_item",
  "mcp_drift_event",
  // Phase 3 (BL-34) — the 9-step enrolment wizard's per-environment bindings and
  // resumable draft state.
  "mcp_environment_binding",
  "mcp_enrolment_draft",
  // Phase 6 (BL-37, ADR-0012, LLD §14.2.6/§14.7.2) — the permission-intersection
  // evaluator's tenant floor, and the delegation trace-tree's data model (no live
  // writer yet — see packages/db/src/schema/teams.ts's doc comment).
  "tenant_scope_policy",
  "delegation_event",
  // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01/03, LLD §14.7.2) —
  // Module E's team composition tables (the delegation executor's live writers).
  "team",
  "team_version",
  "team_member",
  // Target Architecture Blueprint Phase 7b (BL-38, ADR-0018, LLD §14.4) — knowledge
  // ingestion pipeline: collections/sources/generations/chunks/embeddings, and the
  // Postgres side of the graph (graph_entity/graph_edge/graph_community — the graph
  // store itself, Neo4j, is out of RLS's reach entirely; see ADR-0018/graph-store).
  "knowledge_collection",
  "knowledge_source",
  "knowledge_index_generation",
  "knowledge_document",
  "knowledge_chunk",
  "knowledge_embedding_d384",
  "knowledge_embedding_d768",
  "knowledge_embedding_d1024",
  "knowledge_embedding_d1536",
  "knowledge_embedding_d3072",
  "graph_entity",
  "graph_edge",
  "graph_community",
  "graph_entity_merge_candidate",
  "knowledge_ingestion_job",
  // Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06, LLD §14.4.2) — the
  // bounded retrieval agent's own audit/observability trail, explicitly deferred by
  // Phase 7b/9's own schema and now shipped.
  "retrieval_event",
  // Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13/15, LLD §14.5.5) —
  // the Agent Design Studio's scratch draft and the Blueprints Gallery's
  // tenant-local starter templates.
  "studio_draft",
  "agent_blueprint",
  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) —
  // per-agent presence/concurrency-ceiling row and the append-only assignment audit
  // trail.
  "agent_presence",
  "escalation_assignment_log",
  // Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.1) —
  // Workflow Designer, authoring half: `workflow` (identity) + `workflow_version`
  // (immutable, the same triple-enforcement pattern agent_definition_version/
  // skill_version/team_version all use).
  "workflow",
  "workflow_version",
  // Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-05/06/07, LLD §14.6.2) —
  // Workflow Designer, durable-execution half. `workflow_run_lease` carries its own
  // `tenant_id` (rather than joining through `workflow_run`) precisely so it can be
  // protected by the same single-clause policy every other table here uses: its claim
  // is a raw `INSERT ... ON CONFLICT` and must be tenant-isolated by the policy
  // itself, not by the statement's own predicates.
  "workflow_run",
  "workflow_run_lease",
  "workflow_run_step",
  // Target Architecture Blueprint Phase 17 (BL-48/BL-13, ADR-0019, LLD §15.2) —
  // progressive rollout. All three carry their own `tenant_id` (rather than joining
  // through `deployment`/`shadow_evaluation`) precisely so they can be protected by the
  // same single-clause policy every other table here uses: the resolver's assignment
  // upsert and the shadow pump's `FOR UPDATE SKIP LOCKED` claim must be tenant-isolated
  // by the POLICY, not by the statements' own predicates.
  "deployment_traffic_assignment",
  "shadow_evaluation",
  "shadow_run",
  // Target Architecture Blueprint Phase 18 (BL-49, FR-API-02/FR-ADM-10) — outbound
  // webhooks + tenant-scoped OTel/SIEM export configuration.
  "webhook_subscription",
  "webhook_delivery",
  "otel_export_config",
  "siem_export_config",
  // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — cross-channel customer
  // identity resolution's tenant-opt-in toggle (default OFF).
  "tenant_identity_resolution_policy",
  // Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — Consented Break-Glass
  // Operator Access: the tenant's own explicit, time-boxed, revocable consent grant.
  "tenant_breakglass_grant",
] as const;

/**
 * Target Architecture Blueprint Phase 1 (BL-32, ADR-0011 §5, LLD §14.8.7) — tables
 * with a NULLABLE `tenant_id` (NULL = platform-shared, visible to every tenant; a real
 * uuid = a tenant's own BYO row), which therefore need the two-clause policy shape
 * below rather than `TENANT_SCOPED_TABLES`' single-clause one:
 *
 *   USING      (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid)
 *   WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid)
 *
 * i.e. read own rows plus every platform row; write own rows only (a tenant session
 * can never create/modify/delete a `tenant_id IS NULL` row — only `withPlatform()`
 * can, per LLD §3.2 rule 4). Kept as a separate manifest from `TENANT_SCOPED_TABLES`
 * because `rls-coverage.isolation.test.ts`'s generic coverage check only asserts
 * RLS/FORCE/policy *presence*, not policy *shape* — these tables need the stronger,
 * shape-specific assertions in `platform-shared-write-denied.isolation.test.ts`.
 */
export const PLATFORM_SHARED_TENANT_TABLES = ["model_provider", "model_catalog_entry"] as const;
