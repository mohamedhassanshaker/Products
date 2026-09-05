# Cross-channel identity resolution + config export/restore (Phase 19, BL-50 + BL-51)

Source of truth: `docs/PRODUCT_SPECIFICATION.md` FR-OC-08 (identity resolution) and
FR-ADM-08 (config export/restore, cross-referenced at §7.4). This sub-plan records the
technical breakdown and disclosed design decisions for
`docs/plans/target-architecture-blueprint-plan.md`'s Phase 19, per this project's
established precedent (mcp-enrolment-wizard-plan.md, target-architecture-blueprint-
phase14-plan.md, etc.) for any phase complex enough to need more than the master plan's
own one-paragraph Goal/Scope/Exit-gate summary.

Both items are genuinely independent (no shared files) and are implemented in one
dispatch, batched per the master plan's own "small, independent, batched per
Phase-0-style rules" note for Phase 19.

## Investigation findings (before any code was written)

- `conversation.customerIdentifier`/`customerIdentifierHash` already exist
  (`packages/db/src/schema/conversations.ts`) but **`customerIdentifierHash` was never
  populated by any writer in the codebase** — confirmed by exhaustive grep. This phase
  is the hash column's first real writer.
- The WebWidget channel **never captures a customer identifier at all** at session
  creation (`createWidgetSession` — no phone/email field exists in
  `CreateWidgetSessionRequest`). The WhatsApp channel populates the RAW (unhashed)
  identifier (`event.customerIdentifier`, the sender's `wa_id`) via
  `findOrCreateConversationForChannelCustomer`. There is no existing OTP/verification
  mechanism anywhere in this codebase for a widget session to self-declare a "verified"
  identifier.
- Given that gap, this phase does **not** invent a new customer-facing verification
  flow (out of scope, a materially larger feature). Instead it adds the one bounded,
  already-buildable mechanism consistent with FR-OC-08's own worked example ("a
  *verified* phone number") without a cryptographic verification step: a human agent,
  during a live conversation (any channel, including the widget), can record a
  confirmed customer identifier on that conversation via an explicit admin action —
  this is the human-verification moment FR-OC-08's example describes, just performed by
  a person instead of an OTP flow. This is disclosed as a scope decision, not silently
  assumed.
- For BL-51, every artifact family FR-ADM-08 names already has a real, reusable
  creation path: `createAgentDefinitionVersion`/`createSkillVersion`/
  `createWorkflowVersion`/`createTeamVersion`/`createRouteVersion` (model_route is
  confirmed to be the 5th versioned-artifact kind, per the dispatch brief — though,
  unlike the other four, it is **not** YAML-based (`chainJson`/`policyJson`, not a YAML
  artifact) and its promotion ladder is **Draft/Published only**, not the fuller
  Draft→Review→Approved→Production ladder the other four have. `createRouteVersion(...,
  publish: false)` still lands a real, unpromoted Draft, which is what "re-enters the
  gate, never auto-promoted" requires regardless of ladder length — disclosed
  correction to the dispatch brief's characterization.).
- `createConnector()` already refuses to create a credentialed connector without a
  fresh `credentialPlaintext` (`CredentialRequiredError`) — this is, unmodified, the
  exact mechanism that makes "restoring a connector must re-prompt for credentials,
  never carry secret material through an export file" hold structurally rather than by
  convention. Restore therefore auto-creates only `authMethod: "None"` connectors;
  every credentialed connector is reported in the restore result as
  "needs re-credentialing" with its own non-secret fields surfaced for the admin to
  recreate by hand via the existing New Connector screen — never auto-created, never
  silently dropped.
- `pii_policy`'s existing write path (`setPiiPolicy`) is an **upsert** (delete-then-
  insert for the same matrix cell) — calling it during restore would be a real
  in-place overwrite of live policy, which is exactly what FR-ADM-08's boundary rule
  forbids. `tenant_data_policy` is a PK-on-tenant singleton (no "create new" is even
  possible). Given both existing write paths are structurally incompatible with
  "restore never overwrites in place," **policy config (`pii_rule`/`pii_policy`/
  `guardrail_rule`/`tenant_data_policy`) is exported for review/audit visibility in the
  bundle's manifest, but is not auto-restored this phase** — a disclosed, deliberate
  scope narrowing in the safety-first direction, not a silent gap.
- **Cross-tenant restore is explicitly rejected** (`RESTORE_CROSS_TENANT_NOT_SUPPORTED`),
  a real decision, not left ambiguous: every restorable artifact kind resolves
  tenant-scoped-by-name references (skill/knowledge pins, model-route hop
  provider/catalog ids, team member definition pins) that are only meaningful within
  the exporting tenant's own id space — restoring into a different tenant would either
  silently fail those resolutions or, worse, coincidentally resolve to a different
  tenant's unrelated same-named resource. Restore only ever targets the bundle's own
  `tenantId`.

## BL-50 — Cross-channel identity resolution

- **Schema**: new `tenant_identity_resolution_policy` table (1:1 tenant, mirrors
  `tenant_data_policy`'s shape) — `enabled boolean not null default false`. OFF by
  default, per the hard requirement.
- **Domain**: `packages/modules/conversations/src/domain/customer-identifier-hash.ts` —
  pure `computeCustomerIdentifierHash()` (sha256 hex of a normalized — trimmed,
  lowercased — identifier). Wired into every existing/new writer of
  `customerIdentifier` so the hash column finally has real data.
- **Matching rule**: exact equality of `customerIdentifierHash` only. No fuzzy/
  similarity matching exists anywhere in this feature — proven by an adversarial test.
- **Application**: `resolveLinkedConversations()` (conversations module) — returns `[]`
  immediately if the tenant's policy is disabled or the conversation has no hash;
  otherwise returns every OTHER conversation in the tenant with an EXACT matching hash.
- **Surfacing**: (a) Conversation Detail admin view gets a "Linked conversations"
  panel; (b) `escalations`' existing `ai_context_snapshot` mechanism (already
  established for cross-boundary context, Phase 14) gets a `linkedConversations`
  summary field, populated only when the tenant setting is enabled — this is the
  "agent handling a linked conversation can see prior context" half, reusing the
  existing snapshot mechanism rather than touching the live bot turn pipeline (a much
  larger, riskier change out of this phase's bounded scope).
- **Settings UI**: new tenant-settings toggle (mirrors `data-policy`'s existing
  settings screen/route shape), OFF by default, explicit admin action to enable.

## BL-51 — Configuration export/restore

- **No new tables.** Export/restore is stateless request/response — the bundle is a
  JSON document the admin downloads/uploads; nothing is persisted except an audit-log
  entry per export/restore action (reusing `@nextbot/audit`, the same DSR precedent).
- **Composition-root service** `apps/web/src/lib/config-portability-service.ts` (the
  established seam for cross-module orchestration — same shape as `dsr-service.ts`):
  `exportConfigBundle`, `previewRestoreConfigBundle` (read-only), `restoreConfigBundle`.
- **Restorable kinds**: agent definitions, skills, workflows, teams, model routes
  (all via each module's own existing create-identity/create-version functions,
  never new artifact-creation logic) + connectors with `authMethod: "None"`.
- **Not auto-restored (disclosed)**: policy config (reference-only in the bundle);
  credentialed connectors (flagged for manual recreation).
- **"Current" definition**: the latest version by version-ordinal for each identity —
  not "whichever version is in Production" (a separate, already-covered concern,
  Phase 17's deployments).
- One small, additive gap closed: `agent-platform` was the only one of the five
  versioned-artifact modules with no `findXByName` export (skills/workflows/teams/
  model-gateway all already have one) — `findAgentDefinitionByName` added for
  consistency, used by restore's "reuse existing identity vs. create new" decision.

## Exit gate

Standard batched gate (§4-6 of the dev-agent brief) plus:
- A real adversarial test proving two conversations with similar-but-not-identical
  identifiers are never linked, and that linking never happens while the tenant
  setting is disabled (even with an identical identifier).
- A real, non-mocked integration test exporting a seeded tenant's agents/skills/
  workflows/teams/connectors, restoring it, and confirming: every restored artifact is
  a genuine new Draft requiring the normal promotion gate; authored YAML/policy/scope
  content round-trips byte-faithfully; no credential/secret material appears anywhere
  in the serialized bundle (inspected directly, not merely asserted).
