// ESLint 9 flat config.
//
// Enforces the module boundary rules from docs/architecture/LLD.md §2.3:
//   - `packages/modules/*` are framework-free (no `next/*`, no React).
//   - Module -> module imports are restricted to the explicit allow-list below.
//   - `apps/*` may depend on `packages/*` and `packages/modules/*` freely (they are
//     the composition root), but modules may not import from `apps/*`.
//
// Deeper "no cycles / no ajv outside mcp-client / no @google/adk outside ai-registry /
// no @nextbot/db inside domain/" rules are enforced by dependency-cruiser
// (.dependency-cruiser.cjs) because eslint-plugin-boundaries only reasons about
// package-level element types, not file-path-scoped rules within a package.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";

/**
 * The permitted module -> module edges, transcribed verbatim from LLD §2.3.
 * Anything not listed here is forbidden. `audit` and `reporting` are deliberately
 * absent as *targets* — every other module reaches them only via domain events,
 * never a direct import.
 */
const MODULE_ALLOW_LIST = {
  iam: ["tenancy"],
  channels: ["tenancy"],
  connectors: ["tenancy", "secrets"],
  "tool-registry": ["connectors", "tenancy"],
  conversations: ["tenancy", "channels"],
  // Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.2.5) adds
  // `authz`: mandated call site 1 of 5 ("every tool call, after §3.6's permission
  // resolver, before execution") lives in `orchestration/application/tool-call-
  // pipeline.ts`. See that file's own doc comment for the disclosed caller-chain
  // placeholder this phase wires in (agent_definition_version has no scope_json
  // column yet).
  // Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, LLD §14.4.4) adds
  // `knowledge`: the bounded retrieval agent (`knowledge/application/retrieval/
  // retrieval-executor.ts`) is called directly from `orchestration/application/
  // turn-pipeline.ts`'s reply branch for a knowledge-scoped agent version, exactly
  // per LLD's own call-site instruction — mirrors `authz`'s Phase 6 addition above.
  // Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4) adds `tenancy`:
  // `application/approval-expiry-service.ts` is the `approvals.expiry-sweep` job's
  // cross-tenant sweep and needs `listActiveTenantContexts()` to iterate every
  // tenant — the exact same edge, for the exact same reason, that `escalations`
  // (Phase 13), `knowledge` and `model-gateway` already established for their own
  // identically-shaped cross-tenant sweeps.
  // Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) adds `telemetry-export`:
  // `agent-run-tracing.ts`'s existing span-emission call sites additionally forward a
  // copy of each real ended span to a tenant's configured OTel collector endpoint, if
  // one is configured and enabled — purely additive, never a replacement for the
  // existing ClickHouse/OTel-SDK write path.
  orchestration: ["conversations", "tool-registry", "agent-platform", "pii", "channels", "authz", "knowledge", "tenancy", "telemetry-export"],
  approvals: ["orchestration", "conversations", "iam"],
  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) adds `tenancy`: the
  // `escalation.sla-sweep` cross-tenant worker job needs `listActiveTenantContexts()`
  // to iterate every tenant, the same edge `knowledge`/`model-gateway` already
  // established for their own identically-shaped cross-tenant sweeps.
  escalations: ["conversations", "iam", "channels", "tenancy"],
  // Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5.3/14.5.4) adds
  // the `skills` edge: `agent-platform` owns the composition bridge
  // (`agent_version_skill`), the where-used query, and the "upgrade consumers"
  // algorithm (all three need to read `skill`/`skill_version` rows and reuse
  // `skills`' own save-time validator) — never the other direction, which would be a
  // cycle (`skills` never imports `agent-platform`).
  // Target Architecture Blueprint Phase 10 (BL-41) adds `knowledge`: resolving
  // `spec.knowledge.collections` pins ("billing_policy@12") to real `knowledge_
  // collection` ids at save time, the same "resolve a reference before the version
  // is ever persisted" discipline `skills` already established above.
  // Target Architecture Blueprint Phase 12 (BL-43/44, LLD §14.1.3) adds `authz`:
  // LLD §14.1.3's own table already named this edge back in Phase 6 ("+skills,
  // model-gateway, authz are new") but it was never actually wired until this
  // phase needed it for real — `domain/artifact-validator.ts` calls `@nextbot/
  // authz`'s `getTenantScopePolicy`/`assertTightensOnly` (FR-AGT-14's guardrail
  // tightening-only invariant) at every agent-version save, identically for Text/
  // Design/Studio mode.
  // `pii` is listed ONLY because `artifact-validator.guardrail-tightening.int.
  // test.ts` needs a real `pii_policy` fixture (`setPiiPolicy`) to prove
  // FR-AGT-14's tightening-only check against a REAL tenant floor, mirroring
  // `authz`'s own identical "test-fixture-only" edge for `connectors`/
  // `tool-registry` above — no non-test file in this module imports it (the
  // real `maskingFloor` derivation itself lives in `@nextbot/authz`, which
  // owns the `pii` edge for that purpose).
  "agent-platform": ["tenancy", "ai-registry", "model-gateway", "skills", "knowledge", "authz", "pii"],
  audit: ["tenancy"],
  pii: ["tenancy"],
  a2a: ["conversations", "orchestration", "tenancy"],
  reporting: [],
  tenancy: [],
  campaigns: [],
  // Target Architecture Blueprint Phase 7b (BL-38) — knowledge pins a model-gateway
  // route version at collection/generation time and calls through it for
  // extraction/embedding. Phase 11 (BL-42, FR-KB-08) adds `pii` — the Chunk stage
  // masks detected PII at index time per the collection's trust level, and read
  // paths re-evaluate at the requesting agent's trust level, both via the SAME
  // masker/policy-lookup FR-SEC-04 already established (never a second mechanism).
  knowledge: ["tenancy", "model-gateway", "pii"],
  // Phase 6 (BL-29, ADR-0014) — MCP Definition Registry: manifest pinning + drift
  // quarantine. Phase 3 (BL-34, LLD §14.3 header) adds the `connectors`/`tool-registry`
  // edges: enrolment writes environment bindings that own a `connector` row (§14.3.1)
  // and materialises manifest items into `tool` rows, and step 3 (auth) writes
  // credentials to the same vault `connectors` already uses (`secrets`).
  "mcp-registry": ["tenancy", "connectors", "tool-registry", "secrets"],
  // Target Architecture Blueprint Phase 1+2 (BL-32/33, ADR-0011, LLD §14.8) —
  // Module F, provider registry + model catalog + Route v2. `tenancy` for
  // `listActiveTenantContexts()`/residency+plan-tier governance reads. Phase 2 adds
  // `ai-registry` (the actual call path — `resolveModelChainForRoute`/
  // `callModelGatewayText`/`callModelGatewayStructured`/`enforceModelBudget` — moved
  // here from `agent-platform`, LLD §14.9.6's "extract Module F"; this module's own
  // provider-type adapters still never import a provider SDK directly, only
  // `ai-registry`'s already-existing egress point, ADR-0006) and `secrets` (the
  // shared envelope-encryption credential vault, same edge `connectors` already has).
  "model-gateway": ["tenancy", "ai-registry", "secrets"],
  // Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5) — Module C:
  // Skills. `tool-registry` to resolve `scope.capabilityGroups` (by name) and
  // `scope.tools` (`"tool@connector"` pins) at save time; `connectors` to resolve
  // the connector half of a tool pin by name. Deliberately NOT `agent-platform`
  // (that would create the cycle noted on that module's own entry above) —
  // eval-case existence is validated through `agent-platform`'s public HTTP API by
  // the composition root, not a direct module import (the orphan-sweep job LLD
  // §14.5.2 names, `skills.eval-ref-sweep`, is deferred — see this module's README).
  skills: ["tool-registry", "connectors"],
  // Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.2) — the
  // permission-intersection evaluator. `skills` only, for `/authz/simulate`'s
  // `skillVersion` chain-ref resolution (mapping a real, already-shipped skill's
  // own `scope_json` onto the evaluator's `ScopeDescriptor` — see
  // `authz/src/application/simulate-service.ts`). Deliberately NOT `agent-
  // platform`/`teams`/`workflows`/`knowledge`: none of those persist a real
  // `ScopeDescriptor` yet in this build (agent versions have no `scope_json`
  // column this phase; teams/workflows/retrieval are Phases 14/15/7+) — wiring
  // those edges before there's anything real on the other end would be a
  // forward reference to nothing, so `/authz/simulate` throws a disclosed
  // `AuthzRefNotYetSupportedError` for those ref kinds instead. `connectors`/
  // `tool-registry` are listed ONLY because `simulate-service.int.test.ts`
  // needs a real connector+tool+capability-group fixture (mirroring `skills`'
  // own test setup, since a real skillVersion ref resolves through exactly
  // those ids) — no non-test file in this module imports either.
  // Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-14, LLD §14.2.6/
  // §14.5.6) adds `pii`: `getTenantScopePolicy` (`application/tenant-scope-
  // policy-service.ts`) derives `ScopeDescriptor.maskingFloor` for real from
  // `pii_policy` — LLD §14.2.6's OWN original derivation list already named
  // `pii_policy -> maskingFloor` as one of `tenant_scope_policy`'s three sources;
  // Phase 6 deferred exactly this one mapping (see that file's own disclosed
  // narrowing), pending an aggregation rule this phase supplies. Never a second
  // masking mechanism — `@nextbot/pii`'s own masker/policy-lookup is reused as-is.
  authz: ["skills", "connectors", "tool-registry", "pii"],
  // Target Architecture Blueprint Phase 6 (BL-37, LLD §14.7.2) — the
  // delegation-trace-tree DATA MODEL/rendering foundation only (no live
  // delegation executor: that's Phase 14/BL-46, which is what will eventually
  // populate `delegation_event` for real). The tree-read query itself only
  // touches its own table plus `@nextbot/db`'s shared schema directly
  // (agent_definition/agent_definition_version, for the human-readable
  // `agentLabel` — reading another module's tables via the shared schema
  // package is an already-established pattern in this codebase, distinct from
  // importing that module's own application/domain logic). `agent-platform` is
  // listed here ONLY because this phase's integration tests need a real
  // `agent_definition_version` row to satisfy `delegation_event`'s FK (creating
  // one directly via raw schema access would need to duplicate agent-platform's
  // own Route v2 pinning logic, which belongs there, not here) — no non-test
  // file in this module imports it.
  //
  // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01/03-11, LLD §14.7)
  // turns this module into Module E proper (team composition + the live delegation
  // executor) and adds six real production edges, each mandated by a specific FR:
  //   - `authz`     — LLD §14.2.5's mandated call site 2 of 5 ("every agent
  //                   delegation hand-off"). The executor calls `evaluateOrDeny`
  //                   per hop and NEVER re-derives any permission logic; FR-ORC-07's
  //                   run-level ceilings are that evaluator's own step-2 budget
  //                   check, fed the run's real `consumed` accumulator.
  //   - `pii`       — FR-ORC-05: the transcript slice is re-masked at every hand-off
  //                   boundary keyed to the RECEIVING member's trust level, through
  //                   `@nextbot/pii`'s existing masker/policy-lookup (never a second
  //                   masking path).
  //   - `tool-registry` — FR-ORC-01: `agent-tool-registrar.ts` creates/retires the
  //                   `AgentAsTool` `tool` row for each member, and the executor
  //                   resolves each hop through the SAME `resolveToolPermission`.
  //   - `orchestration` — LLD §14.7.3 step 5: a delegation executes as an ORDINARY
  //                   tool call through orchestration's existing pipeline, which is
  //                   exactly what makes Tier-3 stop at the Approval Queue at any
  //                   depth (FR-ORC-04), and FR-ORC-09's output guardrail is
  //                   orchestration's already-shipped injection scanner, reused.
  //                   No cycle: `orchestration` does not (and must not) import
  //                   `teams` — a team run is driven from the composition root.
  //   - `agent-platform` — already allowed (Phase 6, test-only); now also a real
  //                   production edge (resolving pinned `definitionName@version`
  //                   members, reading a member's `spec.trustLevel`, and the
  //                   `agent_run` lifecycle a team run is traced under).
  //   - `model-gateway` — FR-ORC-03's supervisor route: the router-class validation
  //                   reuses Model Gateway v2's own `role`/route metadata, and the
  //                   supervisor's routing decision is a structured call through the
  //                   PINNED `supervisor_route_version_id`.
  // `conversations`/`channels`/`connectors`/`escalations` are listed ONLY as
  // test-fixture edges (mirroring `authz`'s own identical convention above): the
  // adversarial suites need a real conversation/connector/tool/escalation fixture.
  // In production, escalation goes through `teams/ports/escalation-sink.ts`, whose
  // adapter lives in the composition root — so FR-ORC-06's
  // one-active-escalation-per-conversation guarantee stays `escalations`' own
  // partial unique index, never a second check. No non-test file in this module
  // imports any of the four.
  teams: [
    "agent-platform",
    "authz",
    "pii",
    "tool-registry",
    "orchestration",
    "model-gateway",
    "conversations",
    "channels",
    "connectors",
    "escalations",
  ],
  // Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.1/
  // §14.6.3) — Workflow Designer, authoring half. Every edge below is a real,
  // save-time reference resolution (V9's "every pinned reference exists, is this
  // tenant's, and is not Deprecated/Superseded") or the mandated authz call site
  // (V10) — never a test-fixture-only convenience edge:
  //   - `agent-platform` — resolves a pinned `AgentNode.agentDefinitionVersionId`.
  //   - `skills`          — resolves a pinned `SkillNode.skillVersionId`.
  //   - `tool-registry`   — resolves a pinned `ToolCallNode.toolId`, and its
  //                         `rw_class` for V5's write-node-safety check.
  //   - `mcp-registry`    — resolves a pinned `ToolCallNode.mcpServerVersionId`
  //                         (FR-MCP-21 reproducibility pin).
  //   - `model-gateway`   — resolves a `RouterNode.classifierRouteVersionId` and
  //                         validates it's router-class, reusing the exact check
  //                         Phase 14 built for team supervisors
  //                         (`isRouterClassRoute`, extracted there in this phase).
  //   - `escalations`     — resolves a `HumanTaskNode.escalationQueueId` against
  //                         the real, EXISTING `agent_queue` (never a third,
  //                         workflow-owned queue).
  //   - `authz`           — LLD §14.2.5's mandated call site (V10): every node's
  //                         scope is folded through the REAL Phase 6 evaluator
  //                         (`evaluateOrDeny`), never reimplemented.
  // `connectors` is listed ONLY because `graph-validator.int.test.ts` needs a real
  // connector fixture to create a real `tool` row via `tool-registry`'s
  // `upsertToolFromDiscovery` (an `McpTool`-kind tool always has a connector, per
  // `tool_kind_connector_consistency`) — mirroring `authz`'s/`teams`' own identical
  // "test-fixture-only" edge convention. No non-test file in this module imports
  // it: a `ToolCallNode` pins a real `toolId` directly (a uuid), never a
  // `tool@connector` name pin the way `skills`' scope does, so production code
  // never needs to resolve a connector at all.
  //
  // Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-03/05/06/07, LLD §14.6.2/
  // §14.6.4) adds the durable-execution half's four edges:
  //   - `orchestration` — **LLD §14.6.4's mandated path**. The `ToolCall` node executor
  //                       dispatches through `runTierEngine` (resolve() -> tiering ->
  //                       the approval interrupt) and an `Agent` node through
  //                       `runTurnPipeline`; `workflow.suspension-expiry-sweep`
  //                       delegates to `expireSuspendedToolCall`, the SHARED approval-
  //                       expiry primitive (ADR-0013 §7.4), so a workflow suspension and
  //                       the Approval Queue are never governed by two clocks. Paired
  //                       with the `no-mcp-client-inside-workflows` dependency-cruiser
  //                       rule, which is what makes "a workflow has no other path to a
  //                       tool" structural rather than conventional.
  //   - `pii`           — every persisted `workflow_run_step.input`/`output` is masked
  //                       through the EXISTING `detectAndMask`/`maskJsonValue` masker
  //                       (LLD §14.6.2's own instruction), never a second masking path —
  //                       the same edge and the same reasoning `teams` already has.
  //   - `tenancy`       — the three `apps/worker` job bodies are cross-tenant sweeps that
  //                       loop `listActiveTenantContexts()` themselves, the same edge
  //                       `escalations`/`knowledge`/`model-gateway`/`orchestration` all
  //                       established for their own identically-shaped sweeps.
  //   - `escalations`   — widened from a save-time reference resolution (V9's
  //                       `escalationQueueId` check) to a real runtime writer: a
  //                       `HumanTask` node raises a REAL escalation through
  //                       `triggerEscalation` and reads its status back to resume,
  //                       routing into the EXISTING queue (ADR-0013 §2.3, "there is no
  //                       third queue").
  workflows: ["agent-platform", "skills", "tool-registry", "mcp-registry", "model-gateway", "escalations", "authz", "connectors", "orchestration", "pii", "tenancy"],
  // Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — outbound webhooks.
  // `agent-platform` ONLY for its already-public `computeHmacSha256Hex`/
  // `constantTimeEquals` (Phase 10's Git-webhook HMAC helper, reused verbatim in the
  // outbound direction per this phase's own brief — never a second, independently
  // written HMAC implementation). `tenancy` for the dispatcher's cross-tenant sweep
  // (`listActiveTenantContexts`), the same edge every other cross-tenant `apps/worker`
  // job in this codebase already has. `audit` is listed ONLY because `webhook-
  // dispatch.int.test.ts` needs `syncAuditFromEventsForTenant` to prove this
  // dispatcher's own progress is genuinely independent of audit-sync's `domain_event.
  // processed` cursor — the same "test-fixture-only" convention `authz`'s `pii` edge
  // and `teams`'/`workflows`' several test-only edges already establish. No non-test
  // file in this module imports it.
  webhooks: ["agent-platform", "tenancy", "audit"],
  // Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — tenant-scoped,
  // opt-in OTel/SIEM export. A true leaf: reads `audit_log_entry`/`agent_run` directly
  // via `@nextbot/db`'s shared schema (not gated by this allow-list — only
  // module-to-MODULE imports are), and forwards through `@nextbot/observability`'s
  // (a shared package) OTLP exporter helpers. `tenancy` for the metric-snapshot/
  // SIEM-export sweeps' own cross-tenant iteration, same shape as every other sweep.
  // `audit` is listed ONLY because `siem-export-service.int.test.ts` needs
  // `recordAuditEntry` to seed real `audit_log_entry` fixture rows — the same
  // "test-fixture-only" convention `webhooks`' own `audit` edge above establishes.
  // `agent-platform` is listed ONLY because `agent-run-metrics-reader.int.test.ts`
  // needs a real, valid `agent_definition_version` fixture (the column this table's
  // own real migration made NOT NULL, `model_route_version_id`, is populated by that
  // module's own save-time route-resolution logic, which this test has no reason to
  // duplicate) to satisfy `agent_run`'s own FK. No non-test file in this module
  // imports either.
  "telemetry-export": ["tenancy", "audit", "agent-platform"],
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      // apps/widget-embed's two Vite build outputs (vite.widget.config.ts /
      // vite.loader.config.ts) — bundled/minified build artifacts, not source.
      "**/dist-widget/**",
      "**/dist-loader/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
      // Static reference wireframes shipped alongside the spec/design docs — not
      // application source this pipeline owns or lints.
      "docs/nextbot-wireframes/**",
      // Next.js-generated (regenerated on every `next dev`/`next build`); explicitly
      // "should not be edited" per its own header comment, so not lint-worthy source.
      "**/next-env.d.ts",
      // Deployment-phase one-shot init script (docker-compose `seed` job) — not part
      // of any app/package tsconfig project and not subject to the module-boundary
      // rules those apply to (it deliberately calls straight into public
      // application-service functions, same as a real onboarding HTTP handler
      // would).
      "scripts/**",
      // nexus-qa's own evidence tree: ad-hoc probe scripts, harness snippets,
      // screenshots and logs written by a QA pass to document a run. Not product
      // source, not in any tsconfig project, and never shipped — but plain `.mjs`
      // probe scripts in it were failing the repo-wide lint gate on `no-undef` for
      // `process`/`console` (this config has no Node globals entry for them, by
      // design, since real source reaches Node globals through typed modules).
      // Ignored wholesale so a QA pass can drop a scratch script here without
      // breaking `pnpm lint` / `pnpm lint:boundaries` for everyone.
      "qa-results/**",
    ],
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { globals: globals.node, sourceType: "commonjs" },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    settings: {
      "import/resolver": {
        typescript: {
          project: ["tsconfig.base.json", "**/tsconfig.json"],
          noWarnOnMultipleProjects: true,
        },
      },
      "boundaries/include": ["apps/**/*", "packages/**/*"],
      // QA Defect 2 fix: eslint-plugin-boundaries only inspects plain `import`
      // statements by default. A boundary violation re-exported via
      // `export * from "..."` or `export { x } from "..."` was therefore invisible
      // to `boundaries/element-types`. Explicitly opt in to the plugin's built-in
      // "export" dependency-node kind (which covers both ExportAllDeclaration and
      // ExportNamedDeclaration with a source) alongside "import" and
      // "dynamic-import" so re-export-based violations are caught too.
      "boundaries/dependency-nodes": ["import", "export", "dynamic-import"],
      "boundaries/elements": [
        { type: "app", pattern: "apps/*", mode: "folder", capture: ["appName"] },
        {
          type: "module",
          pattern: "packages/modules/*",
          mode: "folder",
          capture: ["moduleName"],
        },
        { type: "shared", pattern: "packages/*", mode: "folder", capture: ["pkgName"] },
      ],
    },
    plugins: { boundaries },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            // apps are the composition root: they may use any module/shared package.
            { from: "app", allow: ["module", "shared"] },
            // shared packages may depend on other shared packages (e.g. mcp-client -> contracts)
            // but never on a bounded module or an app.
            { from: "shared", allow: ["shared"] },
            // modules may only import the shared packages and the specific sibling
            // modules named in MODULE_ALLOW_LIST.
            ...Object.entries(MODULE_ALLOW_LIST).map(([moduleName, allowed]) => ({
              from: [["module", { moduleName }]],
              allow: [
                "shared",
                ...allowed.map((dep) => ["module", { moduleName: dep }]),
              ],
            })),
          ],
        },
      ],
      "boundaries/no-unknown": "error",
      "boundaries/no-unknown-files": "off",
    },
  },
  {
    // Modules are framework-free: no React, no Next.js special imports.
    files: ["packages/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["next", "next/*"], message: "packages/modules/** must stay framework-free (LLD §2.2)." },
            { group: ["react", "react-dom", "react/*"], message: "packages/modules/** must stay framework-free (LLD §2.2)." },
          ],
        },
      ],
    },
  },
  {
    /**
     * Target Architecture Blueprint Phase 17 (BL-48, ADR-0004, ADR-0019 §2.5) — the
     * *transitive* half of `.dependency-cruiser.cjs`'s `no-mcp-client-inside-orchestration`.
     *
     * `orchestration` legitimately imports `@nextbot/tool-registry` (the tool catalog and
     * the permission resolver) — and since Phase 16 moved it there, `tool-registry` is
     * also where the one REAL MCP egress implementation lives. Forbidding `mcp-client`
     * alone therefore left a door open: `orchestration` could import `createMcpEgressPort`
     * from its already-allowed sibling and construct real egress for itself, bypassing the
     * injected `EgressPort` entirely — which would defeat shadow evaluation's containment
     * (a shadow turn would reach a real MCP server despite being handed a non-executing
     * port) and ADR-0004's choke point generally.
     *
     * **This is enforced here rather than in dependency-cruiser because dependency-cruiser
     * genuinely cannot express it** — the import resolves to `tool-registry`'s package
     * entry point, so a path-scoped `to:` rule never matches the direct edge, and a
     * `reachable: true` rule would flag every legitimate `tool-registry` import instead.
     * That was established by probing the rule, not assumed.
     *
     * Egress is always supplied BY THE COMPOSITION ROOT through `EgressPort`, never
     * constructed inside the module that is supposed to be unable to reach the network.
     */
    files: ["packages/modules/orchestration/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@nextbot/tool-registry",
              importNames: ["createMcpEgressPort"],
              message:
                "ADR-0004 / ADR-0019 §2.5: `orchestration` must never construct its own MCP egress. `EgressPort` (ports/egress.ts) is the only route out of this module, and the composition root supplies the implementation — which is what lets a shadow run be handed a non-executing port and be STRUCTURALLY unable to reach an MCP server.",
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5) — shadow evaluation's
     * "no customer exposure" containment, made STRUCTURAL rather than conventional.
     *
     * ADR-0019 lists four side-effect containments for a shadow run. Two of them are
     * enforced by construction elsewhere: real tool execution is blocked by the
     * non-executing `EgressPort` (plus `.dependency-cruiser.cjs`'s
     * `no-mcp-client-inside-orchestration` / `no-mcp-egress-impl-inside-orchestration`),
     * and approval-queue pollution is blocked by `runTierEngine`'s `ShadowSuppressed`
     * outcome, which never reaches `createSuspendedToolCall` at all.
     *
     * The third — "no customer sees the shadow reply, and no shadow escalation lands in a
     * real queue" — is described in the ADR as "automatic by call site": the worker simply
     * never calls `insertMessage`, never publishes to the SSE channel and never calls
     * `triggerEscalation`. That is true, but "the current code happens not to do X" is a
     * convention, not a structure, and this project's own standard (Phases 6/14/16) is to
     * make such a property fail the gate rather than rely on review. This block is that
     * gate: the shadow pump and the shadow egress port may not import the escalation
     * module at all, may not import the two customer-facing write functions by name, and
     * may not reach a real MCP egress construction path.
     *
     * `@nextbot/conversations` itself stays importable because the replay legitimately
     * needs its READ-ONLY accessors (`findMessageById`, `listMessagesUpToSequence`,
     * `listMessagesSince`) to dereference the pointers `shadow_run` stores instead of a
     * transcript copy — the restriction is deliberately at named-import granularity so it
     * forbids exactly the writes and nothing else.
     *
     * `@nextbot/mcp-client`'s `validateAgainstJsonSchema` likewise stays importable: it is
     * a pure in-process Ajv compile+validate with no I/O, and it is what lets the shadow
     * port still catch "the candidate would have called this tool with bad arguments".
     * Only the networking exports are forbidden.
     */
    files: ["apps/worker/src/deployment-shadow-*.ts", "apps/worker/src/lib/shadow-egress.ts"],
    // The suites that PROVE these containments legitimately need the forbidden imports:
    // `deployment-shadow-containment.int.test.ts` constructs the real MCP egress port for
    // its positive control (showing the same fixture genuinely DOES reach the server in
    // Live mode, without which "zero requests" would prove nothing), and both suites use
    // `insertMessage` to build the transcript a replay reads. Excluding tests keeps the
    // rule about the production path, which is what it is for.
    ignores: ["**/*.test.ts", "**/*.int.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@nextbot/escalations",
              message:
                "ADR-0019 §2.5: a shadow run must never raise a real escalation. Its `escalationSignal` is captured as data on `shadow_run.escalation_signal` and read by the shadow report — never acted on.",
            },
            {
              name: "@nextbot/conversations",
              importNames: ["insertMessage", "publishConversationEvent", "sendWidgetMessage", "handleSendWidgetMessage"],
              message:
                "ADR-0019 §2.5: a shadow run must never insert a `message` row or publish an SSE event — no customer may ever see a shadow reply. Read-only transcript accessors (findMessageById / listMessagesUpToSequence / listMessagesSince) are allowed and are what the replay uses.",
            },
            {
              name: "@nextbot/mcp-client",
              importNames: ["callTool", "sendMcpRequest", "listTools", "listResources", "listPrompts", "recordBreakerOutcome"],
              message:
                "ADR-0019 §2.5/§3: shadow tool execution is blocked STRUCTURALLY by a non-executing EgressPort, not by a read-only-tool classification. Nothing in the shadow path may open an MCP connection or mutate a circuit breaker that governs real customer traffic. `validateAgainstJsonSchema` is allowed — it performs no I/O.",
            },
            {
              name: "@nextbot/tool-registry",
              importNames: ["createMcpEgressPort"],
              message:
                "ADR-0019 §2.5: the shadow path constructs `createShadowEgressPort()`, never the real MCP egress port. Importing the real one here would defeat the entire containment.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
