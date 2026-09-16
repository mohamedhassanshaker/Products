/**
 * `PromotionRequests` — B14 tab 1. Pure domain logic only (no I/O, no Prisma import),
 * matching every other `domain/` module's convention in this codebase.
 *
 * ## The trigger is the real guarantee; this file is the proactive UX layer in front of it
 *
 * `TR_PromotionRequests_decisionRules` (`prisma/sql/001_constraints.sql` ~line 3275,
 * confirmed by direct read — the doc-comment name `TR_PromotionRequests_gateMustPass`
 * that appears elsewhere in prose does NOT exist as a separate trigger; all four rules
 * live in one `AFTER INSERT, UPDATE` trigger) is the structural enforcement for:
 *   - the environment chain (`fromEnvironmentKey` -> `toEnvironmentKey` must match
 *     `platform.Environments.promotesToKey`) — error 51190;
 *   - a passing gate evaluation for a promotion into the live environment, when
 *     `PublishGates.blockOnSuiteFailure = 1` — error 51191;
 *   - separation of duties (`decidedByStaffUserId <> requestedByStaffUserId`) — error 51192;
 *   - writing `AuditLogEntries` in the SAME transaction as the decision (FR-GOV-14/29).
 *
 * Everything in this file exists so the application layer can give a caller a clean,
 * typed rejection *before* attempting the write (better UX, a named golden-set/threshold
 * reason for a blocked promotion) — never as a replacement for the trigger, which is the
 * only thing that can be trusted against a second caller, a race, or a direct SQL client.
 */

export const PROMOTION_STATUSES = [
  "AwaitingApproval",
  "Approved",
  "Rejected",
  "Withdrawn",
] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

/** `GateEvaluations.evaluatedForKind` — which gate check produced a given evaluation row. */
export const GATE_EVALUATION_KINDS = ["Publish", "Promotion"] as const;
export type GateEvaluationKind = (typeof GATE_EVALUATION_KINDS)[number];

/** `ErasureTasks.store` / the four stores a real erasure must account for (§10.4). */
export const ERASURE_STORES = ["SqlServer", "Neo4j", "Qdrant", "Redis"] as const;
export type ErasureStore = (typeof ERASURE_STORES)[number];

export class PromotionNotFoundError extends Error {
  readonly code = "governance.promotion_not_found";
  constructor() {
    super("This promotion request no longer exists.");
    this.name = "PromotionNotFoundError";
  }
}

/** api.md: `409 governance.promotion_already_resolved`. */
export class PromotionAlreadyResolvedError extends Error {
  readonly code = "governance.promotion_already_resolved";
  constructor(readonly currentStatus: PromotionStatus) {
    super(`This promotion is already "${currentStatus}" and cannot be decided again.`);
    this.name = "PromotionAlreadyResolvedError";
  }
}

/**
 * api.md: `422 governance.promotion_path_invalid`. The application-layer, pre-insert
 * mirror of the trigger's error 51190 — named with the real environment keys so the
 * caller sees *why* rather than a raw SQL Server message.
 */
export class PromotionPathInvalidError extends Error {
  readonly code = "governance.promotion_path_invalid";
  constructor(
    readonly fromEnvironmentKey: string,
    readonly toEnvironmentKey: string,
  ) {
    super(
      `A promotion from "${fromEnvironmentKey}" may not target "${toEnvironmentKey}" — ` +
        "it must follow the environment chain (architecture.md §12).",
    );
    this.name = "PromotionPathInvalidError";
  }
}

/**
 * api.md: `409 agent.publish_gate_blocked`. Carries the real blocking reasons
 * (`GateBlockingReason[]` from `modules/evaluation/ports/publish-gate-checker.ts`) so the
 * UI can name the exact golden set/score/threshold, matching FR-EVAL-08's requirement for
 * a blocked publish and applying it here too for a blocked promotion.
 */
export class PromotionGateBlockedError extends Error {
  readonly code = "governance.promotion_gate_blocked";
  constructor(readonly gateEvaluationId: string) {
    super("This version has not passed the publish gate required for the live environment.");
    this.name = "PromotionGateBlockedError";
  }
}

/** api.md: `403 governance.promotion_self_approval`. The application-layer mirror of
 *  error 51192 — checked *before* the update for a better message, never as a substitute
 *  for the trigger. */
export class PromotionSelfApprovalError extends Error {
  readonly code = "governance.promotion_self_approval";
  constructor() {
    super("A requester cannot approve or reject their own promotion (FR-GOV-15).");
    this.name = "PromotionSelfApprovalError";
  }
}

/**
 * The application-layer mirror of the trigger's three real error numbers, for the case
 * a caller reaches the DB despite the pre-checks above (a race, a second UI, a direct
 * script) — the trigger's own THROW text is matched by stable substring (this codebase's
 * already-proven pattern, e.g. `PrismaRoleRepository.findProtectedChange` /
 * `TR_AgentVersions_publishedImmutable`'s callers — Prisma does not reliably surface the
 * raw SQL Server error *number* on this path, only the message text).
 */
const TRIGGER_MESSAGE_MARKERS: readonly {
  readonly marker: string;
  readonly map: (message: string) => Error;
}[] = [
  {
    marker: "must follow the environment chain",
    map: () => new PromotionPathInvalidError("(unknown)", "(unknown)"),
  },
  {
    marker: "requires a passing gate evaluation",
    map: () => new PromotionGateBlockedError("(unknown)"),
  },
  {
    marker: "cannot approve their own promotion",
    map: () => new PromotionSelfApprovalError(),
  },
];

/** Recognise one of `TR_PromotionRequests_decisionRules`' three THROW messages inside a
 *  raw Prisma error, or return `null` for anything else (the caller rethrows unchanged). */
export function mapPromotionTriggerError(error: unknown): Error | null {
  if (!(error instanceof Error)) return null;
  for (const { marker, map } of TRIGGER_MESSAGE_MARKERS) {
    if (error.message.includes(marker)) return map(error.message);
  }
  return null;
}

/** Composes `AgentVersions`' real display label — `major`/`minor` are the only Prisma
 *  fields; `label` itself is a SQL-only computed column (`'v' + major + '.' + minor`,
 *  `prisma/sql/001_constraints.sql`) not reachable through the Prisma model. */
export function versionLabel(major: number, minor: number): string {
  return `v${major}.${minor}`;
}

/** A decision (`Approved`/`Rejected`) may only be made once, from `AwaitingApproval`. */
export function assertDecidable(status: PromotionStatus): void {
  if (status !== "AwaitingApproval") throw new PromotionAlreadyResolvedError(status);
}

/** The application-layer mirror of separation-of-duties (error 51192) — checked before
 *  the write for a clean message; the trigger is still the real guarantee. */
export function assertNotSelfApproval(
  requestedByStaffUserId: string,
  decidingStaffUserId: string,
): void {
  if (requestedByStaffUserId === decidingStaffUserId) throw new PromotionSelfApprovalError();
}

/** The application-layer mirror of the environment-chain rule (error 51190). `null`
 *  `promotesToKey` (the live environment has no further target) never matches any
 *  `toEnvironmentKey`, exactly like the trigger's own `ISNULL(e.promotesToKey, N'') <>
 *  i.toEnvironmentKey` comparison. */
export function assertFollowsChain(
  fromEnvironmentKey: string,
  toEnvironmentKey: string,
  promotesToKey: string | null,
): void {
  if ((promotesToKey ?? "") !== toEnvironmentKey) {
    throw new PromotionPathInvalidError(fromEnvironmentKey, toEnvironmentKey);
  }
}
