# MCP Enrolment Wizard (BL-34) — implementation plan

Source of truth: `docs/plans/target-architecture-blueprint-plan.md`'s Phase 3 entry,
`docs/architecture/HLD.md` §15.7, `docs/architecture/LLD.md` §14.3, ADR-0014,
`docs/blueprint/NextBot-Target-Architecture-Blueprint.md` §6.3, spec FR-MCP-16+.

Builds on Phase 0's already-shipped `packages/modules/mcp-registry` (manifest
pinning/drift reconciler, QA-approved) — this phase adds the 9-step enrolment wizard,
per-environment bindings, and the existing-connector migration on top of it, without
altering the reconciler's decision logic.

## Sub-phases (all part of this one dispatch, tracked here for the exit-gate record)

1. **Schema** — extend `mcp_server`/`mcp_server_version`/`mcp_manifest_item` (additive
   columns only, backward compatible with Phase 0's existing rows/reconciler inserts),
   add `mcp_environment_binding` + `mcp_enrolment_draft`. Migrations `0049`/`0050`. RLS
   + `TENANT_SCOPED_TABLES` entries for the two new tables.
2. **mcp-client discovery surface** — add `listResources`/`listPrompts` alongside the
   existing `listTools`, mirroring its pagination/error shape exactly (BL-34's
   disclosed Phase-0 deferral).
3. **Module boundary** — `mcp-registry` gains the `connectors`/`tool-registry`/
   `secrets` edges LLD §2.3 calls for (enrolment owns a `connector` row per binding,
   materialises `tool` rows, writes credentials to the vault).
4. **Contracts** — `packages/contracts/src/mcp-registry.ts`: wizard step request/
   response schemas, new error codes.
5. **Application layer** — `mcp-enrolment-draft-service.ts` (steps 1-9, server-
   authoritative, resumable, backed by `mcp_enrolment_draft`), reusing
   `tool-registry`'s `classifyReadWrite`/`defaultApprovalTier` heuristic (step 5),
   `capability_group` single-FK model (step 6, no bridge table), the existing
   `KmsEnvelopeSecretsProvider` vault (step 3), and Phase 0's exact
   `computeManifestHash`/`computeSchemaHash` (step 4) — never re-derived.
6. **Existing-connector migration** — `connector-migration.ts`: idempotent, per-tenant
   backfill (LLD §14.3.1) that wraps every pre-existing `connector` row in a synthesized
   `mcp_server`/`mcp_server_version`/`mcp_environment_binding`, computing the manifest
   from each connector's already-discovered `tool`/`tool_schema_version` rows — no
   `connector` row touched, no `tool.connector_id` FK repointed. **Deviation from the
   original sketch above, disclosed**: NOT registered as an unattended `apps/worker`
   scheduled job — `mcp_server.owner_user_id`/`created_by_user_id` are real NOT NULL
   "who did this" columns, and this codebase has no synthetic-system-actor convention to
   satisfy them from an unattended job (unlike the reconciler/health-check sweeps, which
   write no such column). Triggered instead by an admin action
   (`POST /api/v1/admin/mcp/servers/migrate-connectors`), attributed to the calling
   admin — idempotent regardless of how many times or by whom it's invoked.
7. **HTTP + API routes** — `mcp-registry/http/admin-routes.ts` wizard handlers;
   `apps/web/app/api/v1/admin/mcp/**` composition-root routes (RBAC: `connectors`
   module, matching Phase 0's own documented precedent — see the module doc-comment
   already in `admin-routes.ts` — no new RBAC module is introduced).
8. **Console UI** — `/mcp/servers`, `/mcp/servers/new` (9-step wizard), `/mcp/servers/
   [id]` (tabs), `/mcp/servers/[id]/drift`; `/mcp/capability-groups` resolved as a
   redirect to the existing `/tools/capability-groups` (Phase 0's BL-28 screen — not
   rebuilt, see decision below); `/connectors/new` redirected to the wizard, "Add
   Connector" nav/button updated; existing `/connectors/[id]` and `/connectors` screens
   left untouched.
9. **Tests** — unit (domain reuse, draft step validation), integration (full 9-step
   walk against a fake MCP server port, migration idempotency/no-mutation, reconciler
   compatibility with the extended schema), isolation (RLS coverage for the two new
   tables).

## Decisions/deviations recorded here (not re-litigated elsewhere)

- **`/mcp/capability-groups` vs. `/tools/capability-groups`**: the Blueprint's route
  table lists `/mcp/capability-groups`, but Phase 0 (BL-28) already shipped full
  capability-group CRUD at `/tools/capability-groups`, wired into the nav under "Tool
  Catalog." Rebuilding it under a second route would fork one authority into two UIs
  over the same `capability_group` table for zero capability gain — the same reasoning
  LLD §14.3.3 already applied to reject a second persistence model. `/mcp/capability-
  groups` is added as a thin redirect to `/tools/capability-groups` so the Blueprint's
  documented route still resolves and the wizard's step-6 UI can deep-link to "manage
  groups" from `/mcp/**`, without a second screen to keep in sync.
- **RBAC module**: no `mcp_registry` RBAC module exists in `RbacModule`
  (`packages/contracts/src/iam.ts`) or the spec. Phase 0's own `mcp-registry/http/
  admin-routes.ts` doc comment already establishes the precedent — "RBAC checks (the
  `connectors` module, matching this platform's existing convention that MCP-server-
  shaped configuration is gated the same way connector configuration is)". This phase
  follows that precedent rather than introducing a new RBAC module/seed migration
  unprompted by the spec.
- **`mcp_server_version.status`**: LLD §14.3.2 lists `Draft/PendingApproval/Approved/
  Superseded`; Phase 0 shipped `Draft/Approved/Superseded` only (no approval-workflow
  step). This phase keeps that shape — the wizard's step 9 (enrol) mints an `Approved`
  version directly, mirroring Phase 0's `createServerWithApprovedVersion`/`reviewDrift`
  pattern exactly (identify→discover→classify→group→policy→dry-run all happen in the
  *draft*, which is where "pending approval" state actually lives pre-commit). Adding a
  literal `PendingApproval` enum value with no code path that ever sets it would be dead
  schema, not a real workflow.
- **Transport scope**: `StdioViaGateway` is accepted as a schema value but the wizard's
  transport step disables it in the UI ("not available yet — BL-22"), identical to the
  existing `/connectors/new` wizard's own precedent.
- **`artifact_mcp_pin`** (LLD §14.3.5): still deferred, same as Phase 0's disclosed
  reduction — it is consumer-side machinery for `agent_definition_version`/
  `skill_version`/`workflow_version` pinning, and Skills/Workflows don't exist yet
  (Phases 5/9 of the parent plan). Nothing in this phase's exit gate needs it.
- **`mcp_drift_event.breaking`**: LLD's drift-event table doesn't literally list a
  `breaking` column (that's `tool_schema_version.breaking_change`'s naming, reused
  conceptually) — Phase 0 didn't add one and this phase doesn't either; drift's
  `change_kind = 'SchemaChanged'` already carries the security-relevant signal the
  reviewer needs.

## Exit gate

Standard batched gate (this phase is not flagged security-relevant in the parent plan's
own exit-gate wording) plus:
- `pnpm turbo run typecheck`, lint, `lint:boundaries` clean.
- Migration test: every pre-existing `connector` row survives unchanged (id, name, all
  columns) and every pre-existing `tool.connector_id` FK target is unchanged, after the
  connector-migration backfill runs.
- Real end-to-end wizard integration test (fake MCP server double): sandbox/production
  credentials never cross-used, dry-run genuinely invokes a tool and returns a raw
  result pre-enrolment, unclassified items default Tier3/disabled, enrol writes an audit
  log entry with the manifest hash.
- Wizard-created `mcp_server_version`/`mcp_manifest_item` rows are structurally
  identical (in shape) to reconciler-maintained ones — same reconciler exercised against
  a wizard-enrolled server correctly detects drift.
