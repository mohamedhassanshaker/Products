# ADR-0009 — Agent Definition Git hosting: tenant-owned remote (GitHub/GitLab)

**Status:** Accepted · 2026-08-15
**Context refs:** FR-AGT-01, FR-AGT-02, FR-AGT-03, FR-SEC-02, FR-SEC-05, NFR-6, spec §9.4
(resolved questions), LLD §3.10/§3.10a, HLD §2/§9
**Decision owner:** User (explicit decision, 2026-08-15), overriding the open item flagged
at the end of the initial Architecture phase ("agent-definition Git hosting model unspecified")
**Amended by:** §7 below (2026-08-23) — version creation/promotion no longer hard-block on
Git being unreachable/unconnected; Postgres (`definition_yaml`/its hash) becomes the real
source of truth, Git a best-effort synced mirror; the in-app reviewer≠author check
(`promotion-policy.ts`) is the documented approval mechanism when no `gitPrNumber` exists.
Diff (FR-AGT-02) and PR/MR review (FR-AGT-03) remain strictly Git-only, unchanged.
**Amended by:** §8 below (2026-08-28) — §4's "one `git_connection` per tenant" limitation is
lifted: a connection is now scoped to the **tenant, a single agent definition, or a single
team**, with most-specific-wins resolution and the tenant-level row as the default
(FR-AGT-19, Blueprint §8.5 gap G-18; schema in LLD §14.10). §2's provider support, auth,
path convention, diff/PR mechanics, and residency carve-out are unchanged. See also
**ADR-0016**, which states the same relaxation from the structural-diff side.

## 1. Context

FR-AGT-02 requires a git-style diff between two agent-definition versions; FR-AGT-03
requires a PR-shaped review flow before a version can reach `Approved`. The initial
Architecture phase named "Git holds the content, Postgres holds the pointer + status"
(HLD §9) as the shape of the solution but explicitly left **which Git** open — a
platform-internal Git-like store (NextBot runs its own repos, one per tenant/agent) vs.
a tenant-owned external remote — as a non-blocking gap for the orchestrator to raise
with the user. The architecturally simpler default at that point would have been the
platform-internal store: no OAuth flow, no dependency on third-party provider uptime, no
residency carve-out to document. The user has since resolved this explicitly, choosing
the opposite of that simpler default.

## 2. Decision

**Each tenant connects its own Git remote — GitHub or GitLab (including self-hosted
GitLab) — from the Admin Console. NextBot does not run an internal Git-like store.**

- **Provider support.** Both GitHub and GitLab are first-class, selected per tenant.
  Self-hosted GitLab is supported via a tenant-supplied base URL.
- **Auth.** Connection is via OAuth — a GitHub App installation or a GitLab OAuth
  application — initiated from the Admin Console (Agent Platform Architecture Console,
  B.15 area). The resulting installation/access token is stored in the credential vault
  (FR-SEC-02, ADR-0007 envelope encryption), scoped to the single repo the tenant
  designates for agent definitions. NextBot's own tables never hold the token.
- **Versioning.** An agent-definition version is a real commit in the tenant's repo, at
  a fixed path convention (`agents/<agent_definition_id>/<version>.yaml`). NextBot's
  `agent_definition_version` table keeps a **pointer**, not the content: repo (via the
  tenant's `git_connection`), path, `git_commit_sha`, `git_pr_number`, `git_pr_status`.
  The table's existing `definition_yaml` column is retained as a synced *operational*
  copy so the runtime never takes a per-turn dependency on the Git provider — every
  write still lands in the tenant's repo as a commit first.
- **Diff (FR-AGT-02).** A real diff between two commit SHAs, fetched via the provider's
  compare API (GitHub `.../compare/{base}...{head}`, GitLab's project compare endpoint)
  — **never** a local clone and never shelled-out `git`, so NextBot has no per-tenant
  working copy to keep consistent or garbage-collect.
- **Review (FR-AGT-03).** A real pull request (GitHub) / merge request (GitLab) opened
  against the tenant's repo via the provider API. Status is synced back
  **webhook-primary** (registered at connect time, HMAC-verified) **with a 15-minute
  polling reconciliation fallback** for any version stuck `Open`, since webhook delivery
  is not guaranteed. Merge/close updates `agent_definition_version.git_pr_status` and
  advances the promotion state machine (LLD §3.10).
- **Residency.** The tenant's chosen Git provider sits **outside** NextBot's regional-
  cell residency guarantee (NFR-6/FR-SEC-05) for agent-definition **content**
  specifically — customer conversation data is unaffected and stays fully within its
  cell. This is called out explicitly in the connect flow and in the LLD/HLD so
  `nexus-qa`/`nexus-deploy` never assume it is covered by the regional-cell model.
- **Failure handling.** An unreachable Git connection (auth revoked, repo
  deleted/renamed, provider outage) sets `git_connection.status = Unreachable`.
  Already-deployed agent versions are unaffected — they run from the already-loaded
  `definition_yaml`. New version creation, diff, and PR/MR actions are blocked with a
  distinct error (`GIT_CONNECTION_UNAVAILABLE`) and a "reconnect in Settings" message —
  never a silent failure, never a fallback to some other storage path.

## 3. Alternatives considered

**Platform-internal Git-like store** (NextBot runs `git` server-side, one repo per
tenant or per agent). This was the architecturally simpler default left open at the end
of the initial Architecture phase — no external OAuth surface, no residency carve-out,
no dependency on a third-party provider's uptime or API rate limits. **Rejected per
explicit user decision**: the user wants agent-definition source under the tenant's own
existing GitHub/GitLab organization (their own access control, their own retention,
their own tooling — code review bots, branch protection, existing CI), not a NextBot-
hosted copy the tenant cannot audit or migrate independently. No architectural
requirement forced this; it is a product/trust decision, recorded here as the guide's
§8 process requires for any deviation from the simpler default.

**Local clone + shelled-out `git` per tenant.** Rejected: a working copy per tenant is
an operational liability (disk, GC, concurrent-write races, credential exposure in a
local `.git/config`) that the provider compare/PR APIs make entirely unnecessary.

**GitHub only (no GitLab).** Rejected: several enterprise tenants standardize on
GitLab, including self-hosted; supporting one and not the other would force a subset of
tenants into the platform-internal alternative just rejected above, defeating the point
of the decision.

**Polling-only status sync (no webhook).** Rejected as the primary path: 15-minute
latency on every PR/MR merge notification is a poor review-flow experience when a
webhook can deliver it in seconds. Retained as the fallback specifically because webhook
delivery is not guaranteed (network blips, tenant-side firewall changes, provider
incidents).

## 4. Consequences

**Positive.** Tenants keep agent-definition source under their own governance and
existing review tooling; NextBot avoids operating a multi-tenant Git hosting service
(a nontrivial security and operational surface). Diff/PR logic is a thin provider-API
client, portable to future providers (e.g. Bitbucket) behind the same
`git_connection.provider` seam.

**Negative / accepted costs.**

- Agent-definition version creation now has an external dependency (the tenant's Git
  provider) on its write path, whereas a platform-internal store would not. Mitigated by
  the fail-graceful behavior above: only *new* version/diff/PR actions degrade, never
  running agents.
- Residency guarantees are weaker for agent-definition content than for conversation
  data — a tenant choosing a GitHub.com/GitLab.com remote accepts that its agent
  instructions/prompts (not customer data) leave the regional cell. This must stay a
  visible, explicit choice in the connect flow, not fine print.
- Webhook + polling reconciliation is two code paths to keep consistent, versus a single
  polling loop. Justified by the review-flow latency this avoids for the common case.
- One `git_connection` per tenant in MVP (not per-agent-definition) is a simplifying
  constraint; a tenant needing per-agent repo isolation is out of MVP scope and would
  need a follow-up schema change (`git_connection` keyed by `(tenant_id,
  agent_definition_id)` instead of `tenant_id` alone).

## 5. Consequences for the LLD

- `git_connection` table (LLD §3.10a): provider, base_url, repo_owner/name,
  credential_id, webhook_secret_credential_id, status, health-check timestamps.
- `agent_definition_version` gains `git_commit_sha`, `git_pr_number`, `git_pr_status`
  (LLD §3.10).
- API contract for connect/callback/connection/diff/review/webhook endpoints (LLD
  §3.10a).
- Webhook handler + 15-minute polling sweep in `apps/worker`; health check before every
  write/diff/PR call.
- `GIT_CONNECTION_UNAVAILABLE` added to the RFC 9457 error-code table.

## 6. Verification

- Contract test against a stubbed GitHub/GitLab API asserting the diff/PR endpoints
  never fall back to a local `git` invocation.
- Webhook signature-verification test (reject on bad HMAC).
- Reconciliation-sweep test: a version stuck `Open` with no recent webhook delivery is
  picked up by the 15-minute poll.
- Failure-injection test: with `git_connection.status = Unreachable`, new-version/diff/
  PR calls return `GIT_CONNECTION_UNAVAILABLE` while an existing deployed version's
  turn execution is unaffected.
- A residency-documentation lint/check (already used elsewhere in this project for
  data-locality call-outs) confirming the connect-flow UI text and this ADR agree on the
  residency carve-out wording.

## 7. Amendment (2026-08-23) — DB-first version creation/promotion; Git becomes best-effort

**Context.** Phase 1 of the client-feedback batch (`docs/plans/client-feedback-batch-plan.md`)
tried to seed a real `agent_definition_version` for the demo tenant in a non-interactive
`scripts/seed.ts` run and hit §2's "Failure handling" rule head-on: `createAgentDefinitionVersion`
unconditionally required a live, connected tenant Git remote, and there is no way for a
one-shot init-container script to complete a real GitHub App/GitLab OAuth handshake. That
gap was flagged rather than worked around (see the plan doc's Phase 1 notes) and is the
trigger for this amendment — but the change reaches further than seeding: any tenant that
has not yet connected Git (which, at signup, is every tenant) could not create an agent
version at all, making Git connection a hard prerequisite for using BL-07 rather than an
enhancement to it.

**Decision.** §2's original "never a fallback to storing the version some other way" language
is narrowed to the case it was actually protecting against — a *configured* connection that
is genuinely broken (auth revoked, provider outage, network failure) — and no longer applies
to a tenant that has simply never connected Git at all:

- **(a) Postgres is now the version's real source of truth.** `createAgentDefinitionVersion`
  and `submitVersionForReview` (`agent-definition-service.ts`) no longer hard-block when the
  tenant has no `git_connection` row configured (`GitConnectionNotFoundError`) — the version
  is still created from `definition_yaml`/`definition_hash` alone, with `git_commit_sha: null`,
  and review proceeds without a PR/MR (`{ prNumber: null, reason: "git-not-connected" }`).
  When a connection **is** configured, the write path is unchanged: the artifact is still
  committed to the tenant's remote first, and `git_commit_sha` is still written from that
  real commit — Git remains the review artifact and the diff/PR source whenever it's
  connected, it is simply no longer a *gate* on whether a version can exist at all. A
  **genuine** failure against a connection that is configured — the exact case §2's original
  "Failure handling" rule describes (`GitConnectionUnavailableError` from the pre-write health
  check, or any other unexpected error mid-commit) — is unchanged: it still surfaces as a
  distinct, visible error, never silently degraded to the not-connected path. These are
  deliberately two different code paths with two different tests (see Verification below), so
  a real sync failure can never be mistaken for the graceful no-connection case.
- **(b) The in-app reviewer≠author check is now the documented approval mechanism when Git
  is absent.** `promotion-policy.ts`'s `canPromote()` already rejected `Approved` when
  `actingUserId === createdByUserId`, described in its own comment as "defense in depth"
  alongside PR/MR review. That check has no Git dependency (confirmed while implementing
  this amendment — neither it nor `promote-version-service.ts`'s `loadPromotionCheckInput`
  reads any `git_connection`/`gitCommitSha`/`gitPrNumber` state), so it was already
  sufficient on its own; this amendment simply makes that fact load-bearing rather than
  incidental. For any version with no `gitPrNumber` — whether because no Git connection was
  ever configured, or because PR/MR review was never opened for it — a distinct human other
  than the version's author approving it in-app **is** the review NextBot enforces before
  `Approved`, exactly as a PR/MR's required-approvers rule is the review a Git-connected
  tenant's own provider enforces before merge. No new approval mechanism was built.
- **(c) Diff and PR/MR review remain strictly Git-only, unchanged.** FR-AGT-02's
  `diffVersions`/`diffAgentDefinitionVersions` and FR-AGT-03's `submitVersionForReview`/
  `openAgentDefinitionReview` are **not** touched by this amendment's DB-first change: both
  versions being diffed must still have a real `git_commit_sha`, or the call fails outright
  (`"Both versions must have a git commit to diff."`) — there is no DB-only diff, and there
  never will be one behind this seam. A version with no commit simply cannot be diffed or
  reviewed via PR/MR; it can still be fully promoted to `Production` via (b)'s in-app path.

**What did not change.** §2's provider support (GitHub/GitLab/self-hosted GitLab), auth via
OAuth into the credential vault, the `agents/<agent_definition_id>/<version>.yaml` path
convention, the real-commit/real-PR mechanics themselves, webhook-primary + 15-minute
polling reconciliation, and the residency carve-out are all unchanged — this amendment only
narrows *when* the absence of Git blocks an action, not how Git integration itself works
when present. `diffAgentDefinitionVersions`/`openAgentDefinitionReview`
(`git-connection-service.ts`) are untouched by this amendment's code changes; re-run
unmodified during this amendment's verification and remain green. Note re: §6's own listed
verification item ("contract test... asserting the diff/PR endpoints never fall back to a
local `git` invocation") — while implementing this amendment, no test literally named for
that guarantee was found in the current codebase; the invariant nonetheless holds
structurally (confirmed by inspection: no `child_process`/shelled-`git` code exists anywhere
under `packages/modules/agent-platform/src/infrastructure/git-provider/`, only real HTTP
calls to the provider's compare/PR APIs). Recommended as a small follow-up, not addressed by
this amendment since it predates it and is outside this dispatch's changed-file scope.

**Consequences.**

- *Positive.* A tenant can use BL-07's full Draft→Production version lifecycle from day one,
  before ever connecting Git — matching the fact that Git connection is optional
  infrastructure for review/audit trail, not a precondition for the product's core loop.
  Unblocks `scripts/seed.ts` from completing its own deferred Phase-1 goal (see that plan
  doc's follow-up note) without inventing a fake Git remote for seed purposes.
- *Negative / accepted costs.* A tenant that never connects Git loses the audit/governance
  value Git-hosted PR/MR review provides (line-level diff, branch protection, external CI
  hooks, the tenant's own review tooling) — it relies solely on the in-app reviewer≠author
  check instead. This was always true for any tenant mid-way through connecting Git (a
  version created before `connectGit` completes), and is not a new class of risk, just a
  now-permanent option rather than a transient state.
- *Pre-existing limitation, made more visible by this amendment, not introduced by it:* the
  reviewer≠author check's only guarantee is "a different `userId` approved this" — it is not
  a stronger identity/authenticity guarantee than that (no re-verification of the approver's
  authority beyond RBAC's existing `agent_platform=Write` check, no out-of-band confirmation).
  This was already true when the check was "defense in depth" behind a required PR/MR; it is
  called out explicitly here because it is now the *sole* review gate for a Git-disconnected
  tenant rather than a secondary one.

**Verification (2026-08-23).** `packages/modules/agent-platform/src/application/git-connection-service.int.test.ts`
and `promote-version-service.int.test.ts` extended with real-database tests (no mocks) proving:
a tenant with zero `git_connection` row can create a version (`gitCommitSha: null`), submit it
for review (typed not-applicable result, never throws), and walk the full
Draft→EvalGated→HumanReview→Approved→Production lifecycle using a real distinct-user reviewer
— including a self-approval rejection to prove the reviewer≠author check is not weakened or
bypassed on the Git-disconnected path (superset-restriction check, per this dispatch's
security review). A separate, distinct test proves a **configured** connection pointed at an
unreachable address still rejects `createAgentDefinitionVersion` with
`GitConnectionUnavailableError` — never silently degraded into the graceful path. `Approved`
→ `Production` was confirmed to still require `installedGraphTypes.includes(graphType)`
regardless of Git state (unchanged code path, `promote-version-service.ts` untouched
functionally). `diffVersions` was confirmed to still reject a pair of versions missing a
`git_commit_sha` rather than falling back to a DB-only diff.

## 8. Amendment (2026-08-28) — one Git connection per tenant relaxes to one per agent definition or per team

**Context.** §4's "Negative / accepted costs" recorded this as a known MVP limitation in its
own words: *"One `git_connection` per tenant in MVP (not per-agent-definition) is a
simplifying constraint; a tenant needing per-agent repo isolation is out of MVP scope and
would need a follow-up schema change."* This is that follow-up.

The constraint does not survive contact with a large tenant. FR-AGT-19 extends
Git-backed versioning from agent definitions alone to five artifact kinds (agent
definitions, skills, workflows, teams, model routes), and Blueprint §12 records the same
problem as **gap G-18**: an enterprise tenant with separate engineering groups — a payments
team and a support team, say — cannot put every group's agent definitions in one repository
without also giving every group write access to every other group's artifacts and merging
their review queues into one. The whole point of §2's decision was to put agent-definition
source under the tenant's *own* governance (their access control, their branch protection,
their CI). A single tenant-wide repository actively defeats that for any tenant whose
internal governance is not itself tenant-wide, which is precisely the enterprise segment
§2 was written for.

Nothing about this is a reversal of §2 — it is the same decision applied at the granularity
the requirement actually needs.

**Decision.** A `git_connection` is scoped, not tenant-singular:

- **(a) Scope.** `git_connection` gains a `scope` of `Tenant` | `AgentDefinition` | `Team`.
  A tenant may hold **one `Tenant`-scoped row** (the default, and the shape every existing
  row already is), plus **at most one row per agent definition** and **at most one row per
  team**. Enforced by partial unique indexes per scope, not by application checks.
- **(b) Resolution is most-specific-wins, with the tenant row as the fallback.** Resolving
  the connection for an artifact looks for an `AgentDefinition`/`Team`-scoped row for that
  exact artifact first, then falls back to the `Tenant`-scoped row, then to "no connection"
  — which, per §7(a), is a legal state that no longer blocks version creation. There is no
  merging of connections and no inheritance beyond that single fallback step: an artifact
  resolves to exactly one repository, or to none.
- **(c) Migration is a no-op for existing tenants.** `git_connection`'s primary key moves
  from `tenant_id` to a surrogate `id`; every existing row migrates to `scope='Tenant'`
  with `agent_definition_id` and `team_id` NULL, and every existing resolution keeps
  returning the same row. The normative field-level schema — `scope`,
  `agent_definition_id uuid NULL`, `team_id uuid NULL`, and the per-scope partial unique
  indexes — is **LLD §14.10**; this amendment does not restate it, so there is one
  authority for the columns.
- **(d) Everything else in §2 is untouched.** Provider support (GitHub/GitLab, including
  self-hosted GitLab), OAuth into the credential vault (ADR-0007), the
  `agents/<agent_definition_id>/<version>.yaml` path convention, real-commit/real-PR
  mechanics, webhook-primary status sync with the 15-minute polling reconciliation, and
  §7's DB-first/Git-best-effort behavior all apply per connection, unchanged. Per-connection
  health is now per-connection: one unreachable team repository sets that row's
  `status = Unreachable` and degrades only the artifacts that resolve to it — it does not
  take the tenant's other repositories with it, which is a small side benefit of the change
  rather than its motivation.

**Relationship to ADR-0016.** ADR-0016 (structural YAML diff) states this same relaxation
from the diff side, and its header already declares that it *"amends ADR-0009 (§2 diff scope
and its one-connection-per-tenant constraint)"*. This §8 is the amendment landing in
ADR-0009 itself, per this project's keep-original-add-pointer convention, so a reader of
ADR-0009 is not required to have read ADR-0016 to learn that §4's stated limitation has been
lifted. The two say the same thing; if they ever diverge, ADR-0009 §8 plus LLD §14.10 is the
authority for the connection model and ADR-0016 is the authority for diff behavior.

**Consequences.**

- *Positive.* A tenant's internal governance boundaries can be reflected in its repository
  layout, which is what §2 promised and what a single tenant-wide repo silently withheld.
  Gap G-18 closes. Blast radius of one broken connection shrinks from the tenant to the
  artifacts that use it.
- *Negative / accepted costs.* Resolution is now a lookup with a fallback rather than a
  single-row read, so "which repo does this artifact use?" must be answered by one shared
  resolver function, not re-derived at each call site — a `git_connection` read that does
  not go through it is a review-blocking defect, for the same reason §7's two failure paths
  are kept distinct. More connections also means more OAuth installations and more webhook
  registrations per tenant to keep healthy; the existing per-connection health check and
  reconciliation sweep cover this, but the operator console must show connection health
  per row rather than per tenant.
- *Explicitly out of scope.* Per-*environment* or per-*branch* connections, and more than
  one connection for a single artifact. Both were considered and rejected: an artifact
  resolving to two repositories reintroduces the two-sources-of-truth problem §7(a) spent
  effort removing.

**Verification.**

- Resolution test: an agent definition with its own connection resolves to it; one without
  resolves to the tenant row; a tenant with neither resolves to none and still creates
  versions per §7(a).
- Uniqueness test: a second `Tenant`-scoped row, a second row for the same agent
  definition, and a second row for the same team are each rejected **by the database**, not
  by application code.
- Migration test: an existing tenant-scoped row keeps its identity and resolution across
  the PK change; no existing agent definition changes repository.
- Isolation test: with a team-scoped connection set to `Unreachable`, artifacts resolving to
  the tenant-scoped connection continue to commit, diff, and open PRs normally.
