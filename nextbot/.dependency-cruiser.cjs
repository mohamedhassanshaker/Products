/**
 * dependency-cruiser configuration.
 *
 * Encodes the file-path-scoped rules from LLD §2.3 that eslint-plugin-boundaries
 * cannot express (it only reasons at package granularity):
 *   - no import cycles anywhere in the workspace
 *   - `ajv` is importable only from packages/mcp-client
 *   - `@google/adk` / other provider SDKs are importable only from packages/ai-registry
 *   - `@nextbot/db` is never imported from a module's `domain/` layer (domain must stay pure/I/O-free)
 *   - `next` / `next/*` never imported from packages/modules/** (belt-and-suspenders with ESLint)
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Dependency cycles are forbidden anywhere in the workspace.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-ajv-outside-mcp-client",
      severity: "error",
      comment: "Ajv is scoped exclusively to packages/mcp-client (LLD §1.1 / ADR-0002 §4.1/§4.3).",
      from: { pathNot: "^packages/mcp-client" },
      to: { path: "^(node_modules/)?ajv" },
    },
    {
      name: "no-provider-sdk-outside-ai-registry",
      severity: "error",
      comment: "Provider SDKs / the ADK framework are importable only from packages/ai-registry/src/providers (or adk/) (LLD §7.1).",
      from: { pathNot: "^packages/ai-registry" },
      to: {
        path: "^(node_modules/)?(@google/adk|@google/genai|openai|@anthropic-ai/sdk)",
      },
    },
    {
      name: "no-db-inside-domain",
      severity: "error",
      comment: "domain/ layers must stay pure (no I/O) — @nextbot/db is an infrastructure concern (LLD §2.2).",
      from: { path: "^packages/modules/[^/]+/src/domain" },
      to: { path: "^packages/db" },
    },
    {
      name: "no-next-inside-modules",
      severity: "error",
      comment: "packages/modules/** must stay framework-free so apps/runtime can use them without Next.js (LLD §2.2).",
      from: { path: "^packages/modules" },
      to: { path: "^(node_modules/)?next" },
    },
    {
      name: "no-react-inside-modules",
      severity: "error",
      comment: "packages/modules/** must stay framework-free (LLD §2.2).",
      from: { path: "^packages/modules" },
      to: { path: "^(node_modules/)?react" },
    },
    {
      name: "no-raw-authz-evaluate-outside-authz",
      severity: "error",
      comment:
        "ADR-0012 §3 / LLD §14.2.4 (E11): the pure evaluate() function must only be " +
        "called through evaluateOrDeny() (application/evaluate-or-deny.ts), which fails " +
        "closed on a thrown error. A raw evaluate() import from outside the authz module " +
        "itself (its own unit tests are the one legitimate exception) is a review-blocking " +
        "defect — this is the secondary lint-gate check ADR-0012 §3 calls for.",
      from: { pathNot: "^packages/modules/authz" },
      to: { path: "^packages/modules/authz/src/domain/intersect" },
    },
    {
      name: "no-neo4j-driver-outside-graph-store",
      severity: "error",
      comment:
        "ADR-0018 §2.2/§5: neo4j-driver is importable only from packages/graph-store " +
        "(the same shape as no-provider-sdk-outside-ai-registry/no-ajv-outside-mcp-client) " +
        "so withTenantGraph() stays the ONLY place a Neo4j session is ever opened.",
      from: { pathNot: "^packages/graph-store" },
      to: { path: "^(node_modules/)?neo4j-driver" },
    },
    {
      name: "no-teams-inside-conversations",
      severity: "error",
      comment:
        "LLD §14.7.4 (Target Architecture Blueprint Phase 14, BL-46, FR-ORC internal-only " +
        "routing): delegation is INTERNAL-ONLY. `delegation_event.reason` (the supervisor's " +
        "routing rationale) must be unreachable from any customer-visible surface BY " +
        "CONSTRUCTION, not merely untested. The widget-facing DTO mappers live in " +
        "`conversations`; forbidding `conversations -> teams` outright makes it " +
        "structurally impossible for a delegation field to be mapped into a widget " +
        "payload, an SSE event, or a `message` row. Same shape as " +
        "no-neo4j-driver-outside-graph-store / no-raw-authz-evaluate-outside-authz.",
      from: { path: "^packages/modules/conversations" },
      to: { path: "^packages/modules/teams" },
    },
    {
      name: "no-mcp-client-inside-workflows",
      severity: "error",
      comment:
        "LLD §14.6.4 / FR-WF-03 (Target Architecture Blueprint Phase 16, BL-47b): a " +
        "workflow must not be able to route around tool tiering. The `ToolCall` node " +
        "executor does NOT call the MCP client — it dispatches through " +
        "`orchestration`'s existing tier engine (resolve() -> evaluate() -> guardrails " +
        "-> tiering -> the approval interrupt -> idempotency), which is the only path " +
        "`packages/modules/workflows` has to a tool. Forbidding the import outright is " +
        "what makes that STRUCTURAL rather than a code-review convention: a future " +
        "dispatcher that tried to open its own MCP connection fails the lint gate. " +
        "Same shape as no-neo4j-driver-outside-graph-store / " +
        "no-raw-authz-evaluate-outside-authz / no-teams-inside-conversations.",
      from: { path: "^packages/modules/workflows" },
      to: { path: "^packages/mcp-client" },
    },
    {
      name: "no-mcp-client-inside-orchestration",
      severity: "error",
      comment:
        "ADR-0004 / LLD §2.2-§2.3, and load-bearing for ADR-0019 §2.5 (Target Architecture " +
        "Blueprint Phase 17, BL-48): `ports/egress.ts`'s EgressPort is the ONLY route out of " +
        "`orchestration` to any external system. Shadow evaluation's tool-execution " +
        "containment rests entirely on that being STRUCTURALLY true — the worker injects a " +
        "non-executing egress port, and a shadow turn is then physically incapable of " +
        "reaching an MCP server regardless of what the candidate model decides to do. " +
        "ADR-0004 and ADR-0019 both describe this as already lint-enforced; Phase 17's " +
        "own verification found that the existing rule covered only " +
        "`packages/modules/workflows` (no-mcp-client-inside-workflows), so the claim was " +
        "true by convention rather than by construction for `orchestration` itself. This " +
        "rule closes that gap. Same shape as no-mcp-client-inside-workflows.",
      from: { path: "^packages/modules/orchestration" },
      to: { path: "^packages/mcp-client" },
    },
    // NOTE (Phase 17, BL-48): the *transitive* half of the rule above — "`orchestration`
    // may not construct real egress for itself by importing `createMcpEgressPort` from
    // its already-allowed `tool-registry` sibling" — is deliberately NOT expressed here.
    // It cannot be: the import resolves to `packages/modules/tool-registry/src/index.ts`
    // (the package entry point), so a `to: { path: ".../application/mcp-egress" }` rule
    // never matches the direct edge, and a `reachable: true` rule would flag every
    // legitimate `tool-registry` import instead. This was found by actually probing the
    // rule rather than assuming it worked — see this phase's report. It is enforced at
    // named-import granularity by `eslint.config.mjs`'s `no-restricted-imports` block on
    // `packages/modules/orchestration/**` instead, which IS able to express it.
    {
      name: "no-platform-outside-allowed-callers",
      severity: "error",
      comment:
        "withPlatform() bypasses RLS entirely and is callable only from tenancy provisioning " +
        "and the internal ops surface (LLD §3.2 rule 4).",
      from: {
        pathNot: "^(packages/modules/tenancy|apps/web/app/api/internal/ops|packages/db/src)",
      },
      to: { path: "^packages/db/src/platform-context" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
