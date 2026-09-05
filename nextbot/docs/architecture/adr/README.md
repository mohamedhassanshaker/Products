# NextBot — Architecture Decision Records

| ADR | Title | Status |
|---|---|---|
| [0001](0001-multi-tenant-isolation.md) | Multi-tenant isolation: shared schema + PostgreSQL RLS | Accepted |
| [0002](0002-stack-architecture-style-and-deployment-topology.md) | Stack, architecture style, deployment topology, and library set | Accepted |
| [0003](0003-agent-runtime-google-adk-and-pluggable-graphs.md) | Agent runtime on Google ADK TypeScript behind a pluggable `GraphRuntime` port | Accepted |
| [0004](0004-mcp-transport-and-egress-choke-point.md) | MCP transport handling and the single egress choke point | Accepted |
| [0005](0005-approval-tiers-hitl-suspension-and-idempotency.md) | Approval tiers, durable HITL suspension, and idempotency | Accepted |
| [0006](0006-model-gateway-provider-abstraction-and-data-locality.md) | Model Gateway as the provider-agnostic AI registry; AI data locality | Accepted |
| [0007](0007-credential-vault-envelope-encryption.md) | Credential vault via KMS envelope encryption with per-tenant DEKs | Accepted |
| [0008](0008-observability-and-analytics-store.md) | OpenTelemetry + ClickHouse for observability and analytics | Accepted |
| [0009](0009-agent-definition-git-hosting.md) | Agent Definition Git hosting: tenant-owned remote (GitHub/GitLab) — amended 2026-08-23 (§7: DB-first version creation/promotion, Git best-effort) and 2026-08-28 (§8: one connection per tenant → per agent definition or per team) | Accepted |
| [0010](0010-admin-console-widget-shadcn-tailwind-migration.md) | UI stack migration: Chakra UI → shadcn/ui + Tailwind CSS v4 (all apps) | Accepted |
| [0011](0011-model-gateway-v2-provider-catalog-route.md) | Model Gateway v2: the three-layer Provider / Model-catalog / Route model | Accepted |
| [0012](0012-agent-as-tool-delegation-and-permission-intersection-evaluator.md) | Agent-as-tool delegation, the Tool Execution Kernel, and the centralized permission-intersection evaluator | Accepted |
| [0013](0013-workflow-as-yaml-and-durable-execution-placement.md) | Workflow-as-YAML through the existing promotion gate; durable workflow execution stays in the Data Plane (no new service) | Accepted |
| [0014](0014-mcp-manifest-pinning-and-drift-quarantine.md) | MCP manifest pinning and drift-as-new-item quarantine | Accepted |
| [0015](0015-skill-versioning-and-upgrade-consumers.md) | Skill versioning and the "upgrade consumers" pattern | Accepted |
| [0016](0016-structural-yaml-diff-git-independent-baseline.md) | Structural YAML diff as the Git-independent baseline; Git diff as an enriched view (amends ADR-0009) | Accepted |
| [0017](0017-emergency-rollback-audited-gate-bypass-boundary.md) | Emergency rollback: the precise boundary of an audited promotion-gate bypass | Accepted |
| [0018](0018-graph-store-selection-and-multi-tenant-isolation.md) | Graph store: Neo4j, and its multi-tenant isolation strategy (database-per-tenant + impersonated role) | Accepted |
| [0019](0019-progressive-rollout-traffic-split-binding-and-shadow-evaluation.md) | Progressive rollout: where a canary binds, the traffic-split resolver, and side-effect-free shadow evaluation (corrects LLD §7.4/§9.1) | Accepted |

ADR-0002 is the "stack ADR" required by the Nexus architecture guide §8; it records every deviation
from the guide's defaults with the concrete requirement that justified it.

ADR-0001 §2a and ADR-0009 are 2026-08-15 amendments made after the initial Architecture phase
completed, incorporating two subsequent user decisions (plan-tier quotas, NFR-4a; and tenant-owned
Git hosting for agent definitions) into the already-accepted docs.

ADR-0010 (2026-08-18) supersedes ADR-0002 §4.2a's original Chakra UI choice, for all three
UI-bearing apps — see ADR-0010 for the corrected rationale and the two factual errors it fixes in
the original §4.2a text (Chakra was v2.10.4/Emotion, not v3/Ark UI; and the runtime-theming
advantage §4.2a credited Chakra with was never actually implemented for the Admin Console).

ADR-0011 … ADR-0018 (2026-08-28) are the **second-wave** records, covering the six Blueprint modules
(`docs/blueprint/NextBot-Target-Architecture-Blueprint.md`; spec §4.14–4.17 and the §4.3/§4.10/§4.11
extensions; backlog Phases 6–10). They are additive: ADR-0001 through ADR-0008 and ADR-0010 are
unchanged, and HLD §15 is the corresponding addendum. Two of them touch earlier records —
**ADR-0011 does not supersede ADR-0006** (the provider-agnostic-registry rule stands; only the
resolution *input* changes from a free-text string to a Provider/Catalog/Route triple), and
**ADR-0016 amends ADR-0009 §7c** (Git compare remains Git-only and never falls back, but is no longer
the *only* diff in the product — a separate structural-diff capability now exists beside it, and
ADR-0009's one-Git-connection-per-tenant constraint relaxes to one per agent definition or team).
ADR-0018 is the record ADR-0001 could not cover: RLS is Postgres-specific, so the new graph datastore
gets its own engine-enforced isolation model (database-per-tenant reached only by an impersonated,
single-database role) held to the same standard and tested by the same shape of CI suite.

ADR-0009 §7 (2026-08-23) is a further, in-place amendment (same keep-original-add-pointer
convention as ADR-0001 §2a): version creation/promotion no longer hard-block on Git being
unreachable/unconnected — Postgres becomes the version's real source of truth and Git a
best-effort synced mirror, with the pre-existing reviewer≠author check
(`promotion-policy.ts`) now documented as the in-app approval mechanism when no
`gitPrNumber` exists. Diff (FR-AGT-02) and PR/MR review (FR-AGT-03) remain strictly
Git-only, unchanged — see ADR-0009 §7 for the full amendment and its Consequences.

ADR-0019 (2026-08-31) is a **third-wave** record, written by a targeted architecture-correction
dispatch immediately before Phase 17 (BL-48, Progressive rollout) was dispatched — the same pattern
as ADR-0013 §7's pre-Phase-16 correction. It records that LLD §7.4 step 4 and LLD §9.1 asserted a
weighted/sticky Deployment traffic-split resolver that **has never existed** in this codebase (the
live path resolves a single tenant-wide most-recently-promoted `Production` version, and
`channel.agent_definition_version_id` is a vestigial column read by nothing), and it decides the real
buildable scope: the canary binds at `(tenant, agent_definition, environment)` per FR-AGT-04 — **not**
per channel as BL-48's wording implied — with a new channel→agent-definition binding supplying the
missing first hop, and shadow evaluation running asynchronously in `apps/worker` behind a
non-executing egress port. It **depends on and does not touch** ADR-0017 (emergency rollback), whose
mechanism Phase 17's exit gate is measured against.

ADR-0009 §8 (2026-08-28) is a second in-place amendment, added during the Architecture
reconciliation pass: §4's stated MVP limitation of one `git_connection` per tenant is lifted
to **one per tenant, per agent definition, or per team**, with most-specific-wins resolution
and the tenant row as the fallback (FR-AGT-19, Blueprint §8.5 gap G-18; field-level schema in
LLD §14.10). ADR-0016 already stated this relaxation from the diff side; §8 lands it in
ADR-0009 itself so the record a reader starts from is not silently stale.
