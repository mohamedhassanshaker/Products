# ADR-0015 — Skill versioning and the "upgrade consumers" pattern

**Status:** Accepted · 2026-08-28
**Context refs:** FR-AGT-11, FR-AGT-12, FR-AGT-13, FR-AGT-14, FR-AGT-15, FR-AGT-01, FR-ORC-02,
spec §6.1a (Module C), §9.5 decisions 2/3 and invariants 2/3, Blueprint §8, HLD §15.9,
ADR-0012, ADR-0016
**Decision owner:** Architecture phase (second wave, Blueprint Modules A–F); skill tenant-scoping
resolved by explicit user decision (2026-08-28, spec §9.5 item 3)

## 1. Context

A skill is the platform's first *shared, reusable* artifact: a named, versioned YAML bundle
(trigger description, scope, instruction fragment, success criteria, escalation conditions, eval
cases) composed into many agent versions. Sharing collides head-on with the platform's central
invariant — **agent versions are immutable and reproducible**. If editing a skill changed the
behavior of every agent already composed with it, a promoted, gate-passed, eval-verified agent
version would silently become a different agent, and the promotion gate would be decorative.

The user's decision (spec §9.5 item 3) fixes the scoping question: skills are **tenant-scoped only**
for this build. `skill.tenant_id` is `NOT NULL`; there is no platform-shared skill library, and
FR-AGT-15's blueprints gallery ships as tenant-local starter templates only (see §2.6).

## 2. Decision

### 2.1 Skill versions are immutable; composition pins a version

`skill_version` is immutable once saved. Editing a skill creates `refund_request@4` and leaves every
agent version composed with `refund_request@3` byte-for-byte unchanged (FR-AGT-11). An agent
version's YAML records the pinned reference (`skill: refund_request@3`) **and the pinned version's
content hash**, so a resolution mistake is detectable rather than silent.

Composition is **resolved at agent-version save time, not at turn time.** The agent version's stored
artifact is self-contained: the skill fragment it will actually execute is materialized into the
agent version at save. Runtime never late-binds a skill. This is what makes an agent version
reproducible even if the skill row is later archived, and it is why "which skill version does this
production agent run" is answerable from one row rather than a join through mutable state.

### 2.2 Validation is at save time, with the missing reference named

A skill referencing a capability group, tool, or knowledge collection that does not exist or is not
enabled for the tenant **fails validation at save**, naming the specific missing reference
(FR-AGT-11). A dangling reference is never persisted. Because composition resolves at save,
composing an agent version with a skill re-validates the skill's references *in the composing
agent's context* — which is also where the intersection rule applies: the composed skill's effective
scope is the agent's scope ∩ the skill's declared scope ∩ tenant policy, computed by the one
evaluator (ADR-0012 §2.3). A skill can never widen the agent that composes it.

### 2.3 Where-used is an index, maintained on write

An `agent_version → skill_version` reference bridge is written in the same transaction as the agent
version's save. The Skills Library's "where-used" panel is a read of that index, not a scan of YAML
documents. It is exact by construction, which matters because it is the input to §2.4.

### 2.4 "Upgrade consumers" generates Drafts. It never promotes.

The action takes a target `skill_version` and, for each consumer, produces a **new Draft agent
version** identical to the consumer's current one except that the skill pin (and the materialized
fragment) is bumped, then re-validated. Rules:

- **Consumer set** = for each agent *definition* that has any version referencing an older version
  of this skill, its latest version (Draft excluded) is the upgrade source. The action operates per
  definition, not per historical version — regenerating drafts for every archived version of every
  agent would be noise, not safety.
- **Idempotent.** A natural key on `(target_skill_version_id, agent_definition_id)` over generated
  drafts, plus a check for an existing un-promoted upgrade draft for that consumer, means running
  the action twice creates nothing the second time (FR-AGT-12).
- **Gate unchanged.** Every generated Draft walks the full existing promotion gate — passing eval,
  reviewer ≠ author, sandbox conversation (FR-AGT-01). This action can never put anything into
  Production, directly or indirectly (spec §9.5 invariant 3).
- **Failures are per-consumer.** A consumer whose regenerated draft fails validation (for example
  the new skill version references a tool that consumer's agent is not permitted) is reported as a
  named failure and does not block upgrades for the other consumers — the same non-blocking pattern
  as FR-KB-01/FR-KB-02 source sync.
- **Asynchronous.** For a skill with many consumers, generation runs as a job in `apps/worker` with
  a progress/result summary, not a synchronous request.

### 2.5 Skill versions are ordinary YAML artifacts

They get structural diff (ADR-0016), export/restore (FR-ADM-08), public-API management (FR-API-01),
and — where the tenant has connected Git per definition/team — the enriched Git diff view, all with
no skill-specific machinery.

### 2.6 Tenant-scoped only; the gallery is tenant-local templates

`skill.tenant_id NOT NULL`. Skills are ordinary tenant-scoped rows under ADR-0001's shared-schema
RLS, with no exception and no cross-tenant read path. FR-AGT-15's blueprints gallery therefore ships
as **static, platform-authored starter content that is copied into the tenant** at selection time —
producing a tenant-owned Draft, with no live cross-tenant reference and no shared identity. That is
deliberately not a shared library: a real platform-shared skill library would need a cross-tenant
read policy, a platform-versus-tenant version lineage, and an answer to "what happens to consumers
when the platform edits a shared skill" — a design the user explicitly deferred rather than
half-built.

## 3. Alternatives considered

**Late-binding (agents reference a skill by name; the newest version wins).** Rejected — it is the
one option that directly violates immutability. A gate-passed agent version would change behavior
without any recorded event, and eval results would describe an artifact that no longer runs.

**Mutable skills with a changelog.** Rejected for the same reason wearing a different hat: a
changelog documents the drift, it does not prevent it.

**Automatic consumer upgrade on skill save (silently re-promote consumers).** Rejected outright.
It would mean a skill edit promotes N agent versions to Production without a gate — a single edit
becoming an unreviewed fleet-wide deployment, which is a strictly worse version of the exact risk
emergency rollback (ADR-0017) exists to bound.

**No upgrade action at all (edit each consumer by hand).** Rejected: with tens of consumers this
guarantees skills fossilize at whatever version was first composed, which removes the entire point
of a reusable artifact. The Draft-generating middle path keeps the human decision (promotion) while
removing the mechanical work (re-authoring).

**Reference-only composition with runtime resolution (store the pin, resolve the fragment per
turn).** Rejected: it puts a mutable-state join on the hot path, makes "what ran" a historical
question rather than a stored fact, and buys nothing — the pinned version is immutable anyway, so
there is nothing to gain by resolving late.

**Platform-shared skills (`tenant_id` nullable).** Rejected by explicit user decision (spec §9.5
item 3). Recorded here rather than silently omitted, per the guide's §8 requirement.

## 4. Consequences

**Positive.** Skills become genuinely reusable without weakening immutability or the gate.
Where-used answers "what breaks if I change this" before the change. The upgrade path is one
reviewable batch of Drafts rather than a fleet-wide silent mutation.

**Negative / accepted costs.**

- Version proliferation: a widely-used skill's upgrade produces N Drafts, each needing a gate pass.
  That is the cost of the guarantee. Mitigated by batching the eval runs and by the where-used panel
  making the blast radius visible before the action is taken.
- Materializing the fragment duplicates skill text into every consuming agent version. Storage cost
  is trivial; the real cost is that a reader must look at the pin to know provenance. Mitigated by
  storing the pin and hash alongside the materialized fragment.
- Consumers can silently fall behind: nothing forces an upgrade. Mitigated by a staleness indicator
  on the Skills Library ("6 consumers on older versions"), not by any automatic action.
- No cross-tenant sharing means a multi-brand tenant group duplicates skills. Accepted for this
  phase per the user decision; the export/restore bundle (FR-ADM-08) is the manual workaround.

## 5. Consequences for the LLD

- `skill`, `skill_version` schema (§6.1a shapes) with `tenant_id NOT NULL`.
- The `agent_version_skill_ref` bridge (written transactionally with the agent version save) and the
  where-used query.
- Skill artifact TypeBox schema and its registration with the shared `validateArtifact()`.
- The composition/materialization step in agent-version save, including where the pin, the content
  hash, and the materialized fragment live in the agent YAML.
- The upgrade-consumers job: consumer selection query, idempotency key, per-consumer failure
  reporting, and its `apps/worker` scheduling.
- The blueprints-gallery template store (platform-authored static content) and the copy-into-tenant
  operation.

## 6. Verification

1. **Immutability:** create `skill@3`, compose agent `A@1`, create `skill@4`; assert `A@1`'s stored
   YAML, content hash, and runtime behavior are unchanged.
2. **Idempotency:** run "upgrade consumers" twice against the same skill version; the second run
   creates zero drafts and reports the existing pending ones.
3. **Gate integrity:** a generated Draft cannot reach Production without eval + reviewer ≠ author +
   sandbox run; assert via the shared promotion service, not a workflow-specific path.
4. **Dangling reference:** saving a skill that names a non-existent tool fails with that tool named
   in the error, and nothing is persisted.
5. **Intersection:** a skill declaring a tool the composing agent lacks yields an effective scope
   without that tool (and, where statically determinable, a save-time validation error) — never a
   widened agent.
6. **Per-consumer isolation:** with one consumer guaranteed to fail validation, the other consumers'
   drafts are still created and the failure is named.
7. **Tenant scoping:** the ADR-0001 cross-tenant suite covers `skill`/`skill_version` — tenant A
   cannot read tenant B's skills, and a gallery-derived Draft carries the selecting tenant's
   `tenant_id`.
