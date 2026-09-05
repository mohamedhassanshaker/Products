import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";
import { ChannelTypeSchema } from "./common.js";
import { MaskAction, MaskingContext, TrustLevel } from "./authz.js";

// ---------------------------------------------------------------------------
// Shared vocabularies (LLD §3.10 / §7.1, ADR-0003/0006/0009)
// ---------------------------------------------------------------------------

export const GraphType = Type.Union([
  Type.Literal("ADK"),
  Type.Literal("LangGraph"),
  Type.Literal("PydanticAI"),
  Type.Literal("CustomFSM"),
]);
export type GraphTypeValue = Static<typeof GraphType>;

export const AgentVersionStatus = Type.Union([
  Type.Literal("Draft"),
  Type.Literal("EvalGated"),
  Type.Literal("HumanReview"),
  Type.Literal("Approved"),
  Type.Literal("Production"),
  Type.Literal("Deprecated"),
]);
export type AgentVersionStatusValue = Static<typeof AgentVersionStatus>;

export const GitProvider = Type.Union([Type.Literal("GitHub"), Type.Literal("GitLab")]);
export type GitProviderValue = Static<typeof GitProvider>;

export const GitConnectionStatus = Type.Union([
  Type.Literal("Connected"),
  Type.Literal("Unreachable"),
  Type.Literal("Disconnected"),
]);
export type GitConnectionStatusValue = Static<typeof GitConnectionStatus>;

export const GitPrStatus = Type.Union([
  Type.Literal("None"),
  Type.Literal("Open"),
  Type.Literal("Merged"),
  Type.Literal("Closed"),
]);
export type GitPrStatusValue = Static<typeof GitPrStatus>;

export const EvalRunStatus = Type.Union([
  Type.Literal("Queued"),
  Type.Literal("Running"),
  Type.Literal("Passed"),
  Type.Literal("Failed"),
  Type.Literal("Error"),
]);
export type EvalRunStatusValue = Static<typeof EvalRunStatus>;

// ---------------------------------------------------------------------------
// Agent Definition artifact (LLD §7.3) — the YAML shape validated on every write.
// ---------------------------------------------------------------------------

export const AgentDefinitionArtifactSchema = Type.Object({
  apiVersion: Type.Literal("nextbot.io/v1"),
  kind: Type.Literal("AgentDefinition"),
  metadata: Type.Object({
    name: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
  }),
  spec: Type.Object({
    graphType: GraphType,
    modelRoute: Type.String({ minLength: 1 }),
    instructions: Type.String({ minLength: 1 }),
    toolPolicy: Type.Object({
      source: Type.Literal("agent-tool-registry"),
      capabilityGroups: Type.Array(Type.String()),
      maxToolCallsPerTurn: Type.Integer({ minimum: 1 }),
    }),
    guardrails: Type.Object({
      minConfidenceForAutonomy: Type.Number({ minimum: 0, maximum: 1 }),
      escalateOn: Type.Array(Type.String()),
    }),
    /**
     * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) —
     * the Studio's "Audience & channel" step's own declared trust level: "declares
     * the agent's trust level, feeding the PII masking-context matrix." Reuses the
     * SAME `TrustLevel` vocabulary `ScopeDescriptor.trustLevel` (`@nextbot/authz`)
     * and `@nextbot/pii`'s masking-context matrix already use — never a second,
     * diverging enum. Additive/optional: every pre-existing artifact with no
     * `trustLevel` keeps validating exactly as before; omitting it means `⊤`
     * ("Trusted", no additional constraint declared by this version) at
     * `assertTightensOnly`'s tightening-only check (`domain/artifact-validator.ts`).
     */
    trustLevel: Type.Optional(TrustLevel),
    /**
     * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13) — the Studio's
     * "Audience & channel" step's own declared channel restriction. Additive/
     * optional: omitting it (every pre-existing artifact) means "no channel
     * restriction declared by this version" (`⊤`, `'*'` at the tightening check),
     * never a narrowing surprise for an already-shipped version.
     */
    channelTypes: Type.Optional(Type.Array(ChannelTypeSchema)),
    /**
     * Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-13/14, LLD §14.5.6)
     * — the Studio's (and Text/Design mode's) own declared PII masking floor per
     * context, reusing the SAME `MaskingContext`/`MaskAction` vocabulary
     * `ScopeDescriptor.maskingFloor` already declares (never a second, diverging
     * enum pair). **FR-AGT-14's tightening-only invariant governs this field**:
     * a version may only declare a masking action AT LEAST as strict as the
     * tenant's own `pii_policy` floor for that context (`assertTightensOnly`,
     * `@nextbot/authz`) — attempting to declare a laxer action (e.g. `Show` where
     * the tenant floor is `FullMask`) fails validation and cannot be saved as
     * Draft, named field-by-field (`GUARDRAIL_LOOSENED`). Additive/optional:
     * omitting a context (or the whole field) declares no ADDITIONAL floor beyond
     * the tenant's own — never a loosening, since `⊤` here can only ever be met
     * with (never override) the tenant floor.
     */
    maskingFloor: Type.Optional(Type.Partial(Type.Record(MaskingContext, MaskAction))),
    memory: Type.Object({
      strategy: Type.String({ minLength: 1 }),
      maxTurns: Type.Integer({ minimum: 1 }),
    }),
    evalSuite: Type.Optional(Type.String()),
    budgets: Type.Object({
      maxCostUsdPerConversation: Type.String(),
      maxLatencyMsP95: Type.Integer({ minimum: 0 }),
    }),
    /**
     * Target Architecture Blueprint Phase 2 (BL-33, ADR-0011 §2.2, FR-AGT-22) —
     * the capabilities THIS agent version needs its pinned model route to support.
     * Additive/optional (LLD/ADR-0011 left the exact declaration mechanism to
     * `nexus-dev`, ADR-0011 §5 open item 2): when omitted, `toolCalling: true` is
     * inferred automatically whenever `toolPolicy.capabilityGroups` is non-empty (an
     * agent that can call tools needs a route whose weakest hop still supports tool
     * calling) — every other flag defaults to "not required" rather than "required",
     * so this stays a strictly additive, backward-compatible field: every
     * pre-existing artifact with no tool-calling requirement and an already-working
     * route keeps validating exactly as before.
     */
    requiredCapabilities: Type.Optional(
      Type.Object(
        {
          toolCalling: Type.Optional(Type.Boolean()),
          vision: Type.Optional(Type.Boolean()),
          streaming: Type.Optional(Type.Boolean()),
          structuredOutput: Type.Optional(Type.Boolean()),
          extendedThinking: Type.Optional(Type.Boolean()),
          promptCaching: Type.Optional(Type.Boolean()),
          jsonMode: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    /**
     * Target Architecture Blueprint Phase 5 (BL-35, ADR-0015 §2.1/§2.3, LLD §14.5.3)
     * — the skills this agent version composes, each an exact pin (`"refund_
     * request@3"`, never a bare name). Additive/optional: every pre-existing
     * artifact with no `skills` field keeps validating and saving exactly as
     * before. Resolved to real `skill_version` rows and written into
     * `agent_version_skill` transactionally at save time
     * (`createAgentDefinitionVersion`) — composition is resolved at save time, never
     * late-bound at turn time (ADR-0015 §2.1), so a version's stored artifact stays
     * self-contained and reproducible even if the skill is later archived.
     */
    skills: Type.Optional(Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}@[0-9]+$" }))),
    /**
     * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, Blueprint §7.5) —
     * the cheap "classification and sufficiency checks" route the bounded retrieval
     * agent's query classifier + per-hop sufficiency check call — distinct from
     * `modelRoute` above (the "answering" route), exactly per the Blueprint's own
     * example YAML (`plannerRoute: chat.router # classification and sufficiency
     * checks`). Additive/optional: every pre-existing artifact with no `plannerRoute`
     * keeps validating exactly as before; `createAgentDefinitionVersion` defaults it
     * to `"chat.router"` (a standard route role, ADR-0011 §2.2) only when `knowledge`
     * (below) is actually configured — a non-knowledge-scoped version never pays for
     * a planner-route resolution it will never call.
     */
    plannerRoute: Type.Optional(Type.String({ minLength: 1 })),
    /**
     * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06/07, Blueprint §7.5,
     * LLD §14.4.4) — an agent version scopes which knowledge collections + retrieval
     * config it uses, the SAME "author it in the version YAML, resolve/validate it
     * once at save time" pattern every other field on this artifact already follows
     * (`spec.skills`'s pin-resolution, `spec.modelRoute`'s route-resolution). Additive/
     * optional: every pre-existing artifact with no `knowledge` field is a plain
     * tool-calling/reply agent exactly as before — this field is what turns a version
     * into a "retrieval-scoped agent" for `orchestration/application/turn-pipeline.ts`
     * (LLD §14.4.4's own call site).
     */
    knowledge: Type.Optional(
      Type.Object(
        {
          /**
           * `"<collectionName>@<N>"` pins, the same `"name@N"` shape `spec.skills`'s
           * pins use — but a LOOSER pattern (`^[^@]+@[0-9]+$`, not skills' strict
           * lowercase-snake-case regex), disclosed deliberately: unlike `skill.name`,
           * `knowledge_collection.name` has never been identifier-constrained (Phase
           * 7b shipped it as free display text, e.g. "Retrieval Test Collection"), so
           * reusing skills' stricter pattern would make most already-created
           * collections impossible to reference at all. **Disclosed narrowing**:
           * unlike a skill pin (an immutable artifact version), a knowledge
           * collection has no versioned "artifact" to pin — its generations are
           * continuously rebuilt — so the trailing `@N` is informational only (the
           * generation the author was looking at while wiring this up); at save time,
           * only the collection NAME half is resolved to a real, existing `knowledge_
           * collection` id (fails the save if unresolvable, mirroring
           * `resolveSkillPin`'s "first unresolvable reference fails the save" rule).
           * At retrieval time the executor always resolves the collection's LIVE
           * `current_generation_id` (LLD §14.4.4 step 1's explicit "never a superseded
           * one"), never the `@N` the author happened to see at authoring time.
           */
          collections: Type.Array(Type.String({ pattern: "^[^@]+@[0-9]+$", minLength: 3 }), { minItems: 1 }),
          /** Blueprint §7.5's own literal author-facing vocabulary
           *  (`vector | local | global | hybrid | auto`) — mapped onto the internal
           *  `RetrievalStrategy` enum (`Vector`/`GraphLocal`/`GraphGlobal`/`Hybrid`) by
           *  `retrieval-executor.ts`, never re-declared as a second, diverging enum. */
          strategy: Type.Union(
            [Type.Literal("vector"), Type.Literal("local"), Type.Literal("global"), Type.Literal("hybrid"), Type.Literal("auto")],
            { default: "auto" },
          ),
          maxHops: Type.Integer({ minimum: 0, maximum: 4, default: 2 }),
          maxExpansions: Type.Integer({ minimum: 0, maximum: 5, default: 2 }),
          minCitations: Type.Integer({ minimum: 0, default: 1 }),
          /** "The single most valuable setting in this block" (Blueprint §7.5) —
           *  defaults `true` per the Blueprint's own recommendation. */
          refuseWhenUngrounded: Type.Boolean({ default: true }),
          budget: Type.Object({
            usdPerTurn: Type.Number({ minimum: 0 }),
            seconds: Type.Number({ minimum: 0 }),
          }),
          /**
           * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the agent
           * version's OWN declared ACL grant for knowledge retrieval: mirrors
           * `KnowledgeAclSchema`'s `roleIds`/`capabilityGroupIds`/`tags` dimensions
           * (never `visibility` — every knowledge-scoped agent version implicitly
           * receives the tenant's own "Tenant"-visibility grant, matching a human
           * tenant member's own default reach; only RESTRICTED content requires this
           * field to name a matching grant). Additive/optional: omitting it entirely
           * (the overwhelming majority of pre-existing knowledge-scoped versions)
           * means "this agent may see every collection's Tenant-visibility content and
           * nothing Restricted" — a real narrowing versus this phase's own predecessor
           * behavior (which read as "the whole collection, Restricted content
           * included"), not a widening.
           *
           * **Disclosed scope**: this is a per-AGENT-VERSION grant, resolved once at
           * save time into `ResolvedAgentKnowledgeConfig.aclTags` — the real
           * per-caller `effectiveScope` narrowing this field's own doc comment used to
           * flag as still outstanding. It is NOT a per-end-user-within-a-conversation
           * grant: this codebase threads no acting end-user identity into the
           * retrieval call site at all (`turn-pipeline.ts` calls `runBoundedRetrieval`
           * with only `conversationId`/`agentRunId`/`agentDefinitionVersionId` — no
           * user role/permission set), so a true per-human-user narrowing is
           * structurally unavailable here regardless of implementation approach; it
           * would require a separate identity-threading feature outside this
           * requirement's own scope. "Per caller" in FR-KB-08's own wording is
           * satisfied at the granularity this call site's actual caller concept
           * supports today: the specific agent version making the retrieval call.
           */
          aclScope: Type.Optional(
            Type.Object(
              {
                roleIds: Type.Optional(Type.Array(Type.String())),
                capabilityGroupIds: Type.Optional(Type.Array(Type.String())),
                tags: Type.Optional(Type.Array(Type.String())),
              },
              { additionalProperties: false },
            ),
          ),
          /**
           * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — this agent
           * version's OWN trust level for PII read-time re-evaluation: "detected
           * entities are masked at index time per the collection's trust level, and
           * re-evaluated at read time against the requesting agent's trust level."
           * Defaults to `SemiTrusted` — the same middle-ground default
           * `knowledge_collection.trust_level` itself defaults to — so an agent
           * version that declares nothing extra neither gains nor loses masking
           * relative to a typical collection's own default configuration.
           */
          callerTrustLevel: Type.Optional(
            Type.Union([Type.Literal("Trusted"), Type.Literal("SemiTrusted"), Type.Literal("Untrusted")], { default: "SemiTrusted" }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  }),
});
export type AgentDefinitionArtifact = Static<typeof AgentDefinitionArtifactSchema>;

/** The author-facing `spec.knowledge` shape, extracted for reuse by
 *  `agent-definition-service.ts`'s save-time resolver and by
 *  `@nextbot/db`'s `ResolvedAgentKnowledgeConfig` (the RESOLVED, persisted shape —
 *  collection NAMES turned into real ids — is a distinct, smaller type declared
 *  there, per this package's own "domain stays DB-free" convention). */
export type AgentKnowledgeConfigInput = NonNullable<AgentDefinitionArtifact["spec"]["knowledge"]>;

// ---------------------------------------------------------------------------
// Agent Design Studio (Target Architecture Blueprint Phase 12, BL-43, FR-AGT-13,
// LLD §14.5.5) — the third authoring mode's own scratch-draft wizard state.
//
// **Deliberately lighter validation than the final artifact.** Each step below
// only stages a slice of `studio_draft.payload` (mirroring `mcp_enrolment_draft`'s
// own "payload jsonb, partial of every step's input" pattern, `packages/db/src/
// schema/mcp-registry.ts`) — there is no side effect (no secret vaulted, no
// external call made) until the Review step submits. THE real gate — full
// `AgentDefinitionArtifactSchema` structural validation plus the guardrail
// tightening-only check — runs exactly once, at Review/submit, via the SAME
// `domain/artifact-validator.ts` function Text and Design mode call
// (`studio-single-validator.test.ts` asserts this by spying on that export).
// ---------------------------------------------------------------------------

export const StudioPurposeStepRequestSchema = Type.Object({ instructions: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export type StudioPurposeStepRequest = Static<typeof StudioPurposeStepRequestSchema>;

export const StudioAudienceStepRequestSchema = Type.Object(
  { trustLevel: Type.Optional(TrustLevel), channelTypes: Type.Optional(Type.Array(ChannelTypeSchema)) },
  { additionalProperties: false },
);
export type StudioAudienceStepRequest = Static<typeof StudioAudienceStepRequestSchema>;

export const StudioSkillsStepRequestSchema = Type.Object(
  { skills: Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]{1,62}@[0-9]+$" })) },
  { additionalProperties: false },
);
export type StudioSkillsStepRequest = Static<typeof StudioSkillsStepRequestSchema>;

export const StudioToolsStepRequestSchema = Type.Object(
  { capabilityGroups: Type.Array(Type.String()), maxToolCallsPerTurn: Type.Optional(Type.Integer({ minimum: 1 })) },
  { additionalProperties: false },
);
export type StudioToolsStepRequest = Static<typeof StudioToolsStepRequestSchema>;

/** Staged verbatim into `spec.knowledge` at Review — same shape, so this step's
 * own draft payload never diverges from what the final artifact actually needs. */
export const StudioKnowledgeStepRequestSchema = Type.Object({ knowledge: Type.Optional(Type.Unknown()) }, { additionalProperties: false });
export type StudioKnowledgeStepRequest = Static<typeof StudioKnowledgeStepRequestSchema>;

export const StudioGuardrailsStepRequestSchema = Type.Object(
  {
    minConfidenceForAutonomy: Type.Number({ minimum: 0, maximum: 1 }),
    escalateOn: Type.Array(Type.String()),
    trustLevel: Type.Optional(TrustLevel),
    maskingFloor: Type.Optional(Type.Partial(Type.Record(MaskingContext, MaskAction))),
  },
  { additionalProperties: false },
);
export type StudioGuardrailsStepRequest = Static<typeof StudioGuardrailsStepRequestSchema>;

export const StudioModelBudgetsStepRequestSchema = Type.Object(
  {
    modelRoute: Type.String({ minLength: 1 }),
    maxCostUsdPerConversation: Type.String(),
    maxLatencyMsP95: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type StudioModelBudgetsStepRequest = Static<typeof StudioModelBudgetsStepRequestSchema>;

export const StudioMemoryStepRequestSchema = Type.Object(
  { strategy: Type.String({ minLength: 1 }), maxTurns: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type StudioMemoryStepRequest = Static<typeof StudioMemoryStepRequestSchema>;

/** The Studio's own "Evals" step never hand-authors cases here — it only records
 * which composed skills' eval cases to harvest into the auto-generated suite
 * (`skill_version.eval_case_ids`, `@nextbot/skills`); the admin may deselect any
 * case before Review. */
export const StudioEvalsStepRequestSchema = Type.Object({ includedSkillEvalCaseIds: Type.Array(Type.String({ format: "uuid" })) }, { additionalProperties: false });
export type StudioEvalsStepRequest = Static<typeof StudioEvalsStepRequestSchema>;

export const CreateStudioDraftRequestSchema = Type.Object({ agentDefinitionId: Type.String({ format: "uuid" }) }, { additionalProperties: false });
export type CreateStudioDraftRequest = Static<typeof CreateStudioDraftRequestSchema>;

/** Review step's own submit request — `version`/`graphType`/`modelRouteKey` mirror
 * `CreateAgentDefinitionVersionRequestSchema` exactly (the Studio composes onto the
 * SAME write path Text/Design mode use, LLD §14.5.5's own table: "Review | POST
 * .../versions"). No `status` field exists here (or on the Text/Design request) —
 * a structural guarantee, not a convention, that no authoring mode can ever ask
 * to land anywhere but Draft (`studio-lands-in-draft.test.ts`). */
export const SubmitStudioDraftRequestSchema = Type.Object(
  { version: Type.String({ minLength: 1, maxLength: 50, pattern: "^\\d+\\.\\d+\\.\\d+$" }), graphType: Type.Optional(GraphType), modelRouteKey: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type SubmitStudioDraftRequest = Static<typeof SubmitStudioDraftRequestSchema>;

export class StudioDraftNotFoundError extends DomainError {
  readonly code = "STUDIO_DRAFT_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Agent Design Studio draft '${id}' was not found.`);
  }
}

/** Mirrors `McpWizardStepOutOfOrderError` (`@nextbot/mcp-registry`) — a client
 * cannot submit the Review step before Purpose/Audience have staged the minimum
 * the artifact structurally requires (`instructions`, at minimum). */
export class StudioWizardStepOutOfOrderError extends DomainError {
  readonly code = "STUDIO_WIZARD_STEP_OUT_OF_ORDER";
  readonly httpStatus = 422;
  constructor() {
    super("The Purpose & persona step must be completed (at minimum) before the Studio draft can be submitted.");
  }
}

// ---------------------------------------------------------------------------
// Blueprints Gallery (Phase 12, BL-43, FR-AGT-15) — **descoped to tenant-local
// starter templates** per spec §9.5/LLD §14 boundary-with-HLD note: since
// `skill.tenant_id` is NOT NULL (no platform-shared skill library), there is no
// cross-tenant sharing or platform-curated library in this build. A tenant's own
// admin composes and saves a working Studio draft's artifact as a blueprint,
// reusable only within that same tenant.
// ---------------------------------------------------------------------------

export const CreateAgentBlueprintRequestSchema = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 200 }), description: Type.Optional(Type.String({ maxLength: 2000 })), artifact: AgentDefinitionArtifactSchema },
  { additionalProperties: false },
);
export type CreateAgentBlueprintRequest = Static<typeof CreateAgentBlueprintRequestSchema>;

export class AgentBlueprintNotFoundError extends DomainError {
  readonly code = "AGENT_BLUEPRINT_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Agent blueprint '${id}' was not found.`);
  }
}

// ---------------------------------------------------------------------------
// Agent Definition Registry requests
// ---------------------------------------------------------------------------

export const CreateAgentDefinitionRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CreateAgentDefinitionRequest = Static<typeof CreateAgentDefinitionRequestSchema>;

export const CreateAgentDefinitionVersionRequestSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 50, pattern: "^\\d+\\.\\d+\\.\\d+$" }),
  graphType: Type.Optional(GraphType),
  modelRouteKey: Type.String({ minLength: 1 }),
  artifact: AgentDefinitionArtifactSchema,
});
export type CreateAgentDefinitionVersionRequest = Static<typeof CreateAgentDefinitionVersionRequestSchema>;

export const PromoteVersionRequestSchema = Type.Object({
  targetStatus: AgentVersionStatus,
});
export type PromoteVersionRequest = Static<typeof PromoteVersionRequestSchema>;

/** Phase 6 (BL-27, ADR-0017 §2.2) — `targetVersionId` must be an existing, immutable
 * `agent_definition_version` row of the *same* agent definition the route path already
 * scopes this call to (enforced server-side, never trusted from this shape alone).
 * `reason` is validated non-empty here (`minLength: 1`) as the first layer; the exact
 * ADR-0017 error string ("A reason is required for emergency rollback") is still
 * re-asserted server-side against the trimmed value so a whitespace-only reason is
 * also rejected (TypeBox's `minLength` alone would accept `"   "`). */
export const EmergencyRollbackRequestSchema = Type.Object({
  targetVersionId: Type.String({ format: "uuid" }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type EmergencyRollbackRequest = Static<typeof EmergencyRollbackRequestSchema>;

// ---------------------------------------------------------------------------
// Git remote (LLD §3.10a)
// ---------------------------------------------------------------------------

export const ConnectGitRequestSchema = Type.Object({
  provider: GitProvider,
  repoOwner: Type.String({ minLength: 1 }),
  repoName: Type.String({ minLength: 1 }),
  baseUrl: Type.Optional(Type.String({ format: "uri" })),
  /** The already-exchanged OAuth/App-installation access token (and, for GitLab, its
   * refresh token) — the callback route hands this to `POST /connection` so it can be
   * put straight into the vault; the raw token itself is never persisted to
   * `git_connection` (only a `credentialId` pointer is). */
  accessToken: Type.String({ minLength: 1 }),
  refreshToken: Type.Optional(Type.String({ minLength: 1 })),
});
export type ConnectGitRequest = Static<typeof ConnectGitRequestSchema>;

export const GitDiffFileSchema = Type.Object({
  path: Type.String(),
  patch: Type.String(),
  additions: Type.Integer({ minimum: 0 }),
  deletions: Type.Integer({ minimum: 0 }),
});
export type GitDiffFile = Static<typeof GitDiffFileSchema>;

export const GitDiffResultSchema = Type.Object({
  files: Type.Array(GitDiffFileSchema),
});
export type GitDiffResult = Static<typeof GitDiffResultSchema>;

// ---------------------------------------------------------------------------
// Eval suites (LLD §3.10, FR-AGT-06)
// ---------------------------------------------------------------------------

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-18, LLD §14.9.3) — a
 * suite may be gated on an absolute pass threshold, a regression baseline ("no
 * worse than the currently-deployed version"), or both. `AbsoluteThreshold`
 * (the default) preserves every pre-existing suite's exact current behavior.
 */
export const EvalGateMode = Type.Union([Type.Literal("AbsoluteThreshold"), Type.Literal("RegressionBaseline"), Type.Literal("Both")]);
export type EvalGateModeValue = Static<typeof EvalGateMode>;

export const CreateEvalSuiteRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  costBudgetUsd: Type.Optional(Type.String()),
  latencyBudgetMs: Type.Optional(Type.Integer({ minimum: 0 })),
  passThresholdPct: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  gateMode: Type.Optional(EvalGateMode),
  regressionBaselineVersionId: Type.Optional(Type.String({ format: "uuid" })),
});
export type CreateEvalSuiteRequest = Static<typeof CreateEvalSuiteRequestSchema>;

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16/18, LLD §14.9.3) — an
 * eval case's own provenance and (optional) rubric/judge-model grading.
 * `source` defaults `Authored` (every pre-existing case, and every ordinary
 * hand-authored case going forward) — `HarvestedConversation`/
 * `HarvestedEscalation`/`HarvestedApprovalDenial` are set only by the one-action
 * harvesting flow (FR-AGT-16, `harvestEvalCase`), never hand-picked by the
 * author; `SkillDerived` is set only when the Studio's Evals step copies a
 * composed skill's own eval case into a version's auto-generated suite.
 */
export const EvalCaseSource = Type.Union([
  Type.Literal("Authored"),
  Type.Literal("HarvestedConversation"),
  Type.Literal("HarvestedEscalation"),
  Type.Literal("HarvestedApprovalDenial"),
  Type.Literal("SkillDerived"),
]);
export type EvalCaseSourceValue = Static<typeof EvalCaseSource>;

/** A rubric criterion the judge model scores 0-1 against, weighted into the
 * case's overall rubric score. */
export const EvalRubricCriterionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  weight: Type.Number({ minimum: 0 }),
});
export const EvalRubricSchema = Type.Object({ criteria: Type.Array(EvalRubricCriterionSchema, { minItems: 1 }) });
export type EvalRubric = Static<typeof EvalRubricSchema>;

export const CreateEvalCaseRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  inputTranscript: Type.Array(Type.Object({ sender: Type.String(), text: Type.String() })),
  expectedToolCalls: Type.Optional(
    Type.Array(Type.Object({ toolName: Type.String(), argMatchers: Type.Optional(Type.Record(Type.String(), Type.Unknown())) })),
  ),
  expectedResponsePattern: Type.Optional(Type.String()),
  weight: Type.Optional(Type.Integer({ minimum: 1 })),
  /** FR-AGT-18 — in addition to (never instead of, unless `expectedResponsePattern`
   * is omitted) pattern matching, a case may declare a rubric graded by a judge
   * model pinned to `judgeRouteVersionId`. */
  rubric: Type.Optional(EvalRubricSchema),
  judgeRouteVersionId: Type.Optional(Type.String({ format: "uuid" })),
  source: Type.Optional(EvalCaseSource),
  /** Opaque pointer back to the origin record (`conversation.id` /
   * `escalation.id` / `approval_request.id` / `skill_version.id`) — never
   * dereferenced across a module boundary this package doesn't already cross. */
  sourceRef: Type.Optional(Type.String()),
  skillVersionId: Type.Optional(Type.String({ format: "uuid" })),
});
export type CreateEvalCaseRequest = Static<typeof CreateEvalCaseRequestSchema>;

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16) — one action from a
 * conversation/escalation/denied-Tier-3-approval detail view pre-fills a new
 * `eval_case` for admin confirmation before it is added to a suite (never
 * auto-added without confirmation — this request itself IS the confirmation).
 */
export const HarvestEvalCaseRequestSchema = Type.Object(
  {
    evalSuiteId: Type.String({ format: "uuid" }),
    source: Type.Union([Type.Literal("HarvestedConversation"), Type.Literal("HarvestedEscalation"), Type.Literal("HarvestedApprovalDenial")]),
    sourceRef: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    inputTranscript: Type.Array(Type.Object({ sender: Type.String(), text: Type.String() })),
    expectedResponsePattern: Type.Optional(Type.String()),
    rubric: Type.Optional(EvalRubricSchema),
  },
  { additionalProperties: false },
);
export type HarvestEvalCaseRequest = Static<typeof HarvestEvalCaseRequestSchema>;

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17) — `run_kind`
 * distinguishes a pre-promotion gate run from a scheduled continuous run against
 * the currently-deployed Production version (never pre-promotion-gating on its
 * own — a continuous run's regression is a distinct alert class, LLD §14.9.3).
 */
export const EvalRunKind = Type.Union([Type.Literal("PrePromotion"), Type.Literal("Continuous"), Type.Literal("Manual")]);
export type EvalRunKindValue = Static<typeof EvalRunKind>;

export const RunEvalSuiteRequestSchema = Type.Object({
  agentDefinitionVersionId: Type.String({ format: "uuid" }),
  triggeredBy: Type.Optional(Type.Union([Type.Literal("Manual"), Type.Literal("VersionSubmitted"), Type.Literal("Scheduled")])),
  runKind: Type.Optional(EvalRunKind),
});
export type RunEvalSuiteRequest = Static<typeof RunEvalSuiteRequestSchema>;

// ---------------------------------------------------------------------------
// Model Gateway configuration (LLD §7.1, ADR-0006, FR-AGT-07/08)
// ---------------------------------------------------------------------------

export const ModelRouteChainEntrySchema = Type.Object({
  providerKey: Type.String({ minLength: 1 }),
  /** Client-feedback-batch Phase 8 (item 5, layout): the client's screenshot showed
   * what looked like a pasted email address saved into this field. There is no single
   * canonical model-id format across providers (`gpt-4o`, `claude-opus-5`,
   * `llama-3.1-70b-instruct`, `openai/gpt-4o-mini` — bare names, dotted versions,
   * and `provider/name` shapes are all real), so this is deliberately loose: it only
   * rejects the two shapes that are never a legitimate model id — any whitespace
   * (a paste artifact / accidental multi-token string) and an `@` character (an email
   * address, the client's exact complaint) — rather than pinning down a stricter
   * grammar that would false-positive on some provider's real id format. */
  model: Type.String({ minLength: 1, pattern: "^[^\\s@]+$" }),
  baseUrl: Type.Optional(Type.String({ format: "uri" })),
  credentialId: Type.Optional(Type.String({ format: "uuid" })),
  /** U1 fix (QA 2026-08-15 UI pass) — a chain entry's plaintext API key, submitted
   * once from the console's "own endpoint" credential picker. Request-only: the
   * application layer (`upsertModelRouteWithCredentials`) vaults this into a
   * `credentialId` before anything ever reaches `model_route.chain` in the database —
   * this field itself is never persisted. */
  apiKeyPlaintext: Type.Optional(Type.String({ minLength: 1 })),
  maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type ModelRouteChainEntryRequest = Static<typeof ModelRouteChainEntrySchema>;

export const UpsertModelRouteRequestSchema = Type.Object({
  routeKey: Type.String({ minLength: 1 }),
  strategy: Type.Optional(Type.Union([Type.Literal("FixedPriority"), Type.Literal("CostBased"), Type.Literal("LatencyBased")])),
  chain: Type.Array(ModelRouteChainEntrySchema, { minItems: 1 }),
  totalTimeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })),
  cacheMode: Type.Optional(Type.Union([Type.Literal("Off"), Type.Literal("ExactMatch"), Type.Literal("Semantic")])),
  semanticThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});
export type UpsertModelRouteRequest = Static<typeof UpsertModelRouteRequestSchema>;

export const RegisterModelProviderRequestSchema = Type.Object({
  key: Type.Union([
    Type.Literal("openai"),
    Type.Literal("anthropic"),
    Type.Literal("gemini"),
    Type.Literal("azure-openai"),
    Type.Literal("openai-compatible"),
  ]),
  label: Type.String({ minLength: 1, maxLength: 200 }),
  baseUrl: Type.Optional(Type.String({ format: "uri" })),
  apiKey: Type.Optional(Type.String({ minLength: 1 })),
  regions: Type.Array(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
});
export type RegisterModelProviderRequest = Static<typeof RegisterModelProviderRequestSchema>;

// ---------------------------------------------------------------------------
// Domain errors (LLD §11.2 / RFC 9457 error-code table)
// ---------------------------------------------------------------------------

export class AgentDefinitionNameDuplicateError extends DomainError {
  readonly code = "AGENT_DEFINITION_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`An agent definition named '${name}' already exists.`);
  }
}

export class AgentDefinitionNotFoundError extends DomainError {
  readonly code = "AGENT_DEFINITION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Agent definition '${id}' was not found.`);
  }
}

export class AgentVersionNotFoundError extends DomainError {
  readonly code = "AGENT_VERSION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Agent definition version '${id}' was not found.`);
  }
}

/** ADR-0009 — the tenant's Git remote is unreachable; new version/diff/PR actions are
 * blocked, already-deployed versions are unaffected (never a silent fallback). */
export class GitConnectionUnavailableError extends DomainError {
  readonly code = "GIT_CONNECTION_UNAVAILABLE";
  readonly httpStatus = 409;
  constructor() {
    super("Git connection unavailable — reconnect in Settings.");
  }
}

export class GitConnectionNotFoundError extends DomainError {
  readonly code = "GIT_CONNECTION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("No Git connection is configured for this tenant yet.");
  }
}

/** LLD §3.10 promotion-policy state machine — a transition not allowed from the
 * current status (e.g. eval gate not passed, reviewer === author, graph type not
 * installed). `reason` is one of a fixed set of machine-checkable reasons so the
 * console can render the exact blocking condition, not just "not allowed". */
export class PromotionNotAllowedError extends DomainError {
  readonly code = "PROMOTION_NOT_ALLOWED";
  readonly httpStatus = 422;
  constructor(readonly reason: string) {
    super(`This version cannot be promoted yet: ${reason}`);
  }
}

/** ADR-0017 §2.1 — the target version never actually served Production traffic with a
 * recorded passing gate outcome (it's Draft/EvalGated/HumanReview, or Approved-but-
 * never-promoted, or belongs to a different agent definition). No override exists —
 * this is the whole control surface of the bypass, so it is never soft. */
export class EmergencyRollbackNotEligibleError extends DomainError {
  readonly code = "EMERGENCY_ROLLBACK_NOT_ELIGIBLE";
  readonly httpStatus = 422;
  constructor() {
    super("This version was never previously promoted to Production with a passing gate outcome, so it is not eligible for emergency rollback.");
  }
}

/** ADR-0017 §2.2 — the exact required message, verbatim (FR-AGT-30). */
export class EmergencyRollbackReasonRequiredError extends DomainError {
  readonly code = "EMERGENCY_ROLLBACK_REASON_REQUIRED";
  readonly httpStatus = 422;
  constructor() {
    super("A reason is required for emergency rollback");
  }
}

export class GraphTypeNotInstalledError extends DomainError {
  readonly code = "GRAPH_TYPE_NOT_INSTALLED";
  readonly httpStatus = 422;
  constructor(graphType: string) {
    super(`Graph type '${graphType}' is not installed in this deployment.`);
  }
}

export class EvalSuiteNotFoundError extends DomainError {
  readonly code = "EVAL_SUITE_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Eval suite '${id}' was not found.`);
  }
}

/** ADR-0006 §2.3 — the whole provider fallback chain was exhausted (or the region
 * allowlist emptied it) within the 30s ceiling; the caller must degrade (FR-AI-05
 * backend-timeout fallback), never hang or silently switch models outside the chain. */
export class AllProvidersUnavailableError extends DomainError {
  readonly code = "ALL_PROVIDERS_UNAVAILABLE";
  readonly httpStatus = 502;
  constructor(routeKey: string) {
    super(`All model providers for route '${routeKey}' were unavailable or timed out.`);
  }
}

/** ADR-0006 §3 / FR-SEC-05 — region filtering emptied the chain and the tenant has not
 * opted into out-of-region inference. */
export class NoInRegionProviderError extends DomainError {
  readonly code = "NO_IN_REGION_PROVIDER";
  readonly httpStatus = 422;
  constructor(routeKey: string, region: string) {
    super(`No model provider for route '${routeKey}' is available in region '${region}'.`);
  }
}

/** LLD §7.2 — a model's structured-output response still failed `Value.Check` after
 * the one allowed repair attempt. Never returned as a partial/coerced object. */
export class StructuredOutputInvalidError extends DomainError {
  readonly code = "STRUCTURED_OUTPUT_INVALID";
  readonly httpStatus = 502;
  constructor(routeKey: string) {
    super(`Model output for route '${routeKey}' did not conform to the required schema.`);
  }
}

export class ModelBudgetExceededError extends DomainError {
  readonly code = "MODEL_BUDGET_EXCEEDED";
  readonly httpStatus = 402;
  constructor(scope: string) {
    super(`The ${scope} model budget has been exceeded for this period.`);
  }
}

// ---------------------------------------------------------------------------
// Progressive rollout — traffic-split canary + shadow evaluation
// (Target Architecture Blueprint Phase 17, BL-48/BL-13, ADR-0019, LLD §15.7)
// ---------------------------------------------------------------------------

/** The `deploy_environment` Postgres type's vocabulary (LLD §3.10). Kept distinct from
 *  `EnvironmentSchema` (the connector/channel vocabulary) for the same reason the two
 *  Postgres enums are distinct — identical values today, free to diverge later (e.g. a
 *  `Canary` deploy environment) without an enum-value collision across unrelated tables. */
export const DeployEnvironment = Type.Union([Type.Literal("Sandbox"), Type.Literal("Staging"), Type.Literal("Production")]);
export type DeployEnvironmentValue = Static<typeof DeployEnvironment>;

/** LLD §15.7 `PUT /agent-definitions/{id}/deployments`. `reason` is required and
 *  non-blank for the same reason emergency rollback's is: a traffic-split change is an
 *  audited deployment action written to `deployment_history` and the outbox, and an
 *  unexplained one is useless to whoever reads the timeline afterwards. */
export const SetTrafficSplitRequestSchema = Type.Object({
  environment: DeployEnvironment,
  allocations: Type.Array(
    Type.Object({
      versionId: Type.String({ format: "uuid" }),
      trafficSplitPct: Type.Integer({ minimum: 1, maximum: 100 }),
    }),
    { minItems: 1, maxItems: 10 },
  ),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type SetTrafficSplitRequest = Static<typeof SetTrafficSplitRequestSchema>;

/** LLD §15.7 `POST /agent-definitions/{id}/deployments/promote-canary` — FR-AGT-04's
 *  "Promote canary to 100%". */
export const PromoteCanaryRequestSchema = Type.Object({
  environment: DeployEnvironment,
  versionId: Type.String({ format: "uuid" }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type PromoteCanaryRequest = Static<typeof PromoteCanaryRequestSchema>;

/** LLD §15.7 `POST /agent-definitions/{id}/shadow-evaluations`. The three ceilings are
 *  required, not optional: shadow evaluation spends real money on real provider calls
 *  (ADR-0019 §2.6), so an experiment with no stated stopping condition is not something
 *  this API will create. */
export const StartShadowEvaluationRequestSchema = Type.Object({
  environment: DeployEnvironment,
  candidateVersionId: Type.String({ format: "uuid" }),
  samplePct: Type.Integer({ minimum: 1, maximum: 100 }),
  maxRuns: Type.Integer({ minimum: 1, maximum: 100_000 }),
  maxCostUsd: Type.Number({ exclusiveMinimum: 0, maximum: 100_000 }),
});
export type StartShadowEvaluationRequest = Static<typeof StartShadowEvaluationRequestSchema>;

export const StopShadowEvaluationRequestSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type StopShadowEvaluationRequest = Static<typeof StopShadowEvaluationRequestSchema>;

/** LLD §15.7 `PATCH /admin/channels/{channelId}` — the channel→agent-definition binding
 *  (ADR-0019 §2.2). `null` is an explicitly settable value, not an omission: it means
 *  "unbind, fall back to the tenant-wide lookup", which is a supported state. */
export const SetChannelAgentBindingRequestSchema = Type.Object({
  agentDefinitionId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
});
export type SetChannelAgentBindingRequest = Static<typeof SetChannelAgentBindingRequestSchema>;

/** LLD §15.4 — the requested allocations do not sum to exactly 100%. Raised by the
 *  domain validator as the friendly error; migration `0016`'s trigger remains the
 *  database-level backstop for any future caller that skips the validator. */
export class TrafficSplitInvalidError extends DomainError {
  readonly code: string;
  readonly httpStatus = 409;
  constructor(code: "TRAFFIC_SPLIT_MUST_SUM_TO_100" | "TRAFFIC_SPLIT_ALLOCATION_INVALID", detail: string) {
    super(detail);
    this.code = code;
  }
}

/**
 * ADR-0019 §2.4 — a version must already hold `Production` status before it may receive
 * **any** canary traffic. Canary is not a second route to production: starting a 90/10
 * canary is "promote the candidate through the existing `canPromote` gate (eval green,
 * reviewer ≠ author, sandbox test recorded, graph type installed), then allocate it 10%",
 * never "put an Approved version in front of 10% of customers without the gate". This
 * error is what makes ADR-0017's core claim — nothing reaches production traffic that has
 * not passed — literally still true after Phase 17.
 */
export class VersionNotProductionError extends DomainError {
  readonly code = "VERSION_NOT_PRODUCTION";
  readonly httpStatus = 409;
  constructor(version: string) {
    super(`Version ${version} must be promoted to Production before it can receive canary traffic.`);
  }
}

/** LLD §15.4 — an allocated version belongs to a different agent definition than the one
 *  the route path scopes this call to (never inferred from the body alone). */
export class VersionNotInDefinitionError extends DomainError {
  readonly code = "VERSION_NOT_IN_DEFINITION";
  readonly httpStatus = 409;
  constructor(versionId: string) {
    super(`Version '${versionId}' does not belong to this agent definition.`);
  }
}

/** LLD §15.4 — a blank/whitespace-only reason on an audited deployment action. */
export class DeploymentReasonRequiredError extends DomainError {
  readonly code = "REASON_REQUIRED";
  readonly httpStatus = 422;
  constructor() {
    super("A reason is required for this deployment change.");
  }
}

/** LLD §15.2's partial unique index, surfaced as a friendly 409 rather than a raw
 *  duplicate-key 500: at most one `Active` shadow evaluation per
 *  `(tenant, agent definition, environment)`. */
export class ShadowEvaluationAlreadyActiveError extends DomainError {
  readonly code = "SHADOW_EVALUATION_ALREADY_ACTIVE";
  readonly httpStatus = 409;
  constructor() {
    super("A shadow evaluation is already running for this agent definition and environment. Stop it before starting another.");
  }
}

export class ShadowEvaluationNotFoundError extends DomainError {
  readonly code = "SHADOW_EVALUATION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Shadow evaluation '${id}' was not found.`);
  }
}
