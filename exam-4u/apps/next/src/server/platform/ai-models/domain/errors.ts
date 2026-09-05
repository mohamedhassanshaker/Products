import { DomainError } from '@/server/common/errors/domain-error';

/** `platform.approved_ai_model` allowlist CRUD + per-tenant assignment errors (FR-AI-2/FR-AI-3,
 * migration plan Phase 2 sub-slice "2b") — ported verbatim from
 * `legacy/api/src/platform/ai-models/domain/errors.ts`. */

/** `POST /platform/ai-models` was given an OpenRouter model id that doesn't match the required
 * `provider/model[:variant]` shape. */
export class InvalidModelIdError extends DomainError {
  constructor() {
    super('INVALID_MODEL_ID', 'The OpenRouter model id must look like "provider/model" (e.g. "anthropic/claude-3.5-haiku").');
  }
}

/** The given `openRouterModelId` is already on the allowlist (`uq_aim_model`) — approving it again
 * would create a duplicate entry rather than being a meaningful update. */
export class ModelAlreadyApprovedError extends DomainError {
  constructor() {
    super('MODEL_ALREADY_APPROVED', 'This model is already on the approved allowlist.');
  }
}

/** Thrown when an `approved_ai_model` id does not resolve to any row — the edit/enable-disable/
 * set-default/delete/assignment-target-lookup existence check. */
export class ModelNotFoundError extends DomainError {
  constructor() {
    super('MODEL_NOT_FOUND', 'No such approved AI model.');
  }
}

/** "The platform must never be left with no default." Thrown when a mutation would remove the current
 * platform default (disable it, or hard-delete it) without a replacement designated in the same
 * request. */
export class DefaultModelRequiredError extends DomainError {
  constructor() {
    super('DEFAULT_MODEL_REQUIRED', 'A replacement platform-default model must be designated before removing or disabling the current one.');
  }
}

/** A hard-delete was attempted on a model still assigned (explicitly, by
 * `tenant.assigned_ai_model_id`) to one or more tenants. `tenantCount` names exactly how many. */
export class ModelInUseError extends DomainError {
  constructor(tenantCount: number) {
    super('MODEL_IN_USE', `This model is still assigned to ${tenantCount} tenant(s); reassign them first.`, { tenantCount });
  }
}

/** A Platform Admin tried to assign a tenant a model id that is not on the allowlist at all, or is
 * currently disabled — one code, deliberately not distinguishing the two so as not to enumerate which
 * ids are disabled to a caller who only supplied an arbitrary string. */
export class ModelNotApprovedError extends DomainError {
  constructor() {
    super('MODEL_NOT_APPROVED', 'This model is not an approved, enabled allowlist entry.');
  }
}

/** `PUT /platform/ai-models/:id/default` named a currently-disabled model — the service refuses to
 * make a disabled model the platform default (the platform default is always enabled). */
export class ModelDisabledError extends DomainError {
  constructor() {
    super('MODEL_DISABLED', 'A disabled model cannot be designated the platform default.');
  }
}

/** `AiModelResolver` found no explicit tenant assignment AND no row is currently the platform default
 * (i.e. the allowlist is empty) — there is deliberately no hard-coded model of last resort. Surfaced
 * as 503 since this is a platform-configuration gap, not a client input error. Not thrown by anything
 * in this dispatch's own routes (no tenant-realm `GET /tenant/ai-model` read endpoint exists yet — a
 * later, Phase 5-adjacent dispatch's job) but kept here since `AiModelResolver.resolve()` — used by
 * this dispatch's own `resolveEffectiveModel` admin-console helper — can throw it against a genuinely
 * empty allowlist.
 */
export class AiNotConfiguredError extends DomainError {
  constructor() {
    super('AI_NOT_CONFIGURED', 'No AI model is currently configured for this tenant.');
  }
}
