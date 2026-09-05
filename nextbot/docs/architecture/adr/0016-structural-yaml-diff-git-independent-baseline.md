# ADR-0016 — Structural YAML diff as the Git-independent baseline; Git diff as an enriched view

**Status:** Accepted · 2026-08-28
**Context refs:** FR-AGT-19, FR-AGT-02, FR-AGT-03, FR-ADM-08, FR-API-01, spec §9.5, Blueprint §8.5
(gap G-07), §12 (gap G-18), HLD §15.9, **amends ADR-0009** (§2 diff scope and its one-connection-
per-tenant constraint)
**Decision owner:** Architecture phase (second wave, Blueprint Modules A–F)

## 1. Context

ADR-0009 made agent-definition diff (FR-AGT-02) and PR/MR review (FR-AGT-03) **strictly Git-only**,
and its 2026-08-23 amendment reaffirmed that: "both versions being diffed must still have a real
`git_commit_sha`, or the call fails outright… there is no DB-only diff, and there never will be one
behind this seam."

That amendment was correct about its own seam and simultaneously created the gap the Blueprint rates
severity 2 (G-07): the same amendment made Git **optional**, so the majority authoring path — a
tenant that has never connected a Git remote — now has *no diff at all* on a platform whose core
artifact is a YAML document. And the second wave multiplies the problem: skills, workflows, teams,
and model routes are all YAML artifacts now (FR-AGT-19 names all five), and none of them has a Git
story at all.

There is also a scale constraint ADR-0009 flagged as a known limitation: one `git_connection` per
tenant, so a large tenant with separate engineering groups must share a single repository across
every agent definition (gap G-18).

## 2. Decision

### 2.1 Structural diff is the unconditional baseline, for every YAML artifact

A **structural, artifact-aware diff** — computed directly from the two stored YAML documents, with
no Git connection, no commit, and no network call — works between any two versions of any YAML
artifact: agent version, skill version, workflow version, team version, model route version. It is
implemented once, in a pure leaf package (`@nextbot/yaml-diff`), and is available to the console,
the public API (FR-API-01), export/restore review (FR-ADM-08), and the promotion review screen.

"Structural, artifact-aware" is doing real work here and is part of the decision:

- The diff is computed over the **parsed document**, not the text, so comment and key-order changes
  are not diff noise and a reordered mapping is not a change.
- Arrays that are semantically **keyed** — workflow nodes by node id, team members by member id,
  route hops by hop index+target, skill eval cases by case id, tool grants by tool id — diff by that
  key, not by array position. A node inserted at the top of a workflow must not render as "every
  node changed."
- The output is a typed change set (`added | removed | changed | moved`, with a JSON path and
  before/after values), which is what lets the UI render a *semantic* diff ("approval tier: 1 → 3",
  "skill pin: refund_request@3 → @4") rather than a text hunk. Security-relevant paths — scope,
  tool grants, approval tiers, PII/guardrail policy, model route pins, server-version pins — are
  tagged so the review UI can surface them first.

### 2.2 Git diff remains available as an enriched view, and remains the review mechanism

Where a repository is connected, the provider compare API view (ADR-0009 §2) stays exactly as it is:
line-level, in the tenant's own tooling, with branch protection and external CI. It is now presented
as the **enriched** view alongside the structural baseline, not as the only diff. PR/MR review
(FR-AGT-03) is unchanged and remains Git-only when Git is connected; the in-app reviewer ≠ author
check remains the approval mechanism when it is not (ADR-0009 §7b).

**This is the specific amendment to ADR-0009 §7c.** That clause's "there is no DB-only diff, and
there never will be one behind this seam" is narrowed to its actual subject: *the Git diff endpoint*
(`diffVersions`/`diffAgentDefinitionVersions`) still refuses to operate without two real commit
SHAs and must never silently fall back. What changes is that Git diff is no longer the *only* diff
in the product — a separate, differently-named structural-diff capability now exists beside it, and
the UI is explicit about which one the user is looking at. The two are never blended into one
result, precisely so a reader can always tell whether they are seeing the tenant's Git history or
NextBot's stored artifacts.

### 2.3 Git connection scope relaxes to per definition / per team

ADR-0009's one-`git_connection`-per-tenant constraint (its own §4 "Negative / accepted costs" note)
is relaxed to **one connection per agent definition or per team** (FR-AGT-19, gap G-18), so separate
engineering groups within one tenant can use separate repositories. A tenant-level default
connection remains, inherited by any definition that does not override it — so existing tenants see
no change and no migration beyond adding the optional override.

## 3. Alternatives considered

**Keep Git-only diff and require Git connection.** Rejected: ADR-0009 §7 deliberately made Git
optional so a tenant can use the full version lifecycle from day one. Re-imposing it to get diff
would undo that, and would still leave skills/workflows/teams/routes — which have no Git path
defined — without diff.

**Text diff on the stored YAML (a plain line diff, no parsing).** Rejected: it is cheap and it is
noisy in exactly the cases that matter. A reordered mapping, a re-serialization, or an inserted node
produces a wall of changed lines, which is how reviewers learn to skim diffs. Artifact-aware
structural diff is a bounded amount of extra work with a categorically better review surface — and
it is what makes "highlight the security-relevant changes" possible at all.

**Commit every artifact to a platform-internal Git store so everything has a commit SHA to diff.**
Rejected: ADR-0009 §3 already rejected running a platform-internal Git store, by explicit user
decision; reintroducing it as a diff-implementation detail would be that same rejected decision by
the back door, with all of its operational surface.

**Store a diff at write time (materialize the change set on each save).** Rejected as the primary
mechanism: diff must work between *any* two versions, not only adjacent ones, so it has to be
computable on demand anyway. A cached adjacent-version diff is a legitimate later optimization.

## 4. Consequences

**Positive.** Every tenant, connected to Git or not, can review what changed between two versions of
any of the five YAML artifact types. Promotion review gets a semantic, security-tagged change set
rather than a text hunk. Export/restore (FR-ADM-08) and the public API get diff for free. Large
tenants can separate repositories per engineering group.

**Negative / accepted costs.**

- Two diff mechanisms exist and must stay comprehensible. Mitigated by never blending them and by
  labelling each clearly ("Structural diff" vs "Git compare"); they can legitimately disagree, since
  one compares stored artifacts and the other compares commits.
- Artifact-aware keying is per-artifact-kind configuration that must be extended whenever a new
  keyed array is added to a schema. A missing key config degrades to positional diffing — noisy but
  not wrong. A schema test asserts every array in every artifact schema is either declared keyed or
  explicitly declared positional, so the degradation is a deliberate choice rather than an oversight.
- Per-definition Git connections multiply OAuth installations and webhook registrations for a tenant
  that uses them. Accepted: it is opt-in, and the tenant-level default remains the common path.

## 5. Consequences for the LLD

- `@nextbot/yaml-diff` public surface: `diffArtifact(kind, leftYaml, rightYaml) → ChangeSet`, the
  `ChangeSet` type, and the per-kind key configuration table.
- The security-relevant path tag list per artifact kind (this is a review-surface contract, not
  cosmetics).
- `git_connection` keyed by `(tenant_id, agent_definition_id | team_id)` with a tenant-level default
  row — including the migration from ADR-0009's tenant-only key.
- API/route contracts for structural diff across all five artifact kinds, and the console's
  two-tab (structural / Git) presentation.
- ADR-0009's `GIT_CONNECTION_UNAVAILABLE` error semantics are unchanged and must **not** be returned
  by the structural-diff endpoint, which has no Git dependency at all.

## 6. Verification

1. **No-Git test:** with zero `git_connection` rows for the tenant, structural diff returns a
   correct change set for two agent versions, two skill versions, two workflow versions, two team
   versions, and two route versions.
2. **Noise test:** two versions differing only in key order, comments, or whitespace diff as empty.
3. **Keyed-array test:** inserting a node at the top of a workflow produces exactly one `added`
   change, not N `changed` ones.
4. **Security tagging test:** a change to a tool grant, an approval tier, a PII policy field, or a
   route pin is tagged security-relevant and surfaces first in the review payload.
5. **ADR-0009 non-regression:** the Git diff endpoint still fails when either version lacks a
   `git_commit_sha`, and still never falls back to structural diff (the two are separate endpoints,
   asserted by test).
6. **Per-definition connection:** two definitions in one tenant pointed at two repositories each
   commit/PR to their own, and a definition with no override uses the tenant default.
