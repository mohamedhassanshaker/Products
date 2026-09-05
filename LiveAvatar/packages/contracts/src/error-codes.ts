/**
 * Closed union of API error codes and the spec's exact client sentences.
 * Both NestJS and Angular import this map so a renamed code breaks both builds.
 */

/** Every error code the control plane may emit (spec + LLD envelope). */
export const ERROR_CODES = [
  'INTERNAL_ERROR',
  'IDEMPOTENCY_KEY_REUSED',
  'PAGE_SIZE_INVALID',
  'TENANT_NAME_INVALID',
  'TENANT_SLUG_INVALID',
  'TENANT_SLUG_EXISTS',
  'TENANT_LIMIT_REACHED',
  'TENANT_NOT_FOUND',
  'TENANT_SLUG_IMMUTABLE',
  'TENANT_FORBIDDEN',
  'TENANT_CONFLICT',
  'TENANT_STATUS_INVALID',
  'TENANT_PAUSED',
  'AUTH_EMAIL_INVALID',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_USER_DISABLED',
  'AUTH_RATE_LIMITED',
  'AUTH_REFRESH_INVALID',
  'AUTH_UNAUTHORIZED',
  'AUTH_TOKEN_REQUIRED',
  'AUTH_ALREADY_SEEDED',
  'AUTH_EMAIL_EXISTS',
  'AUTH_INVITE_INVALID',
  'AUTH_PASSWORD_INVALID',
  'AUTH_ROLE_FORBIDDEN',
  'CONFIG_INCOMPLETE',
  'DISPLAY_NAME_INVALID',
  'PROVIDER_CATEGORY_EMPTY',
  'PROVIDER_UNKNOWN',
  'PROVIDER_ENDPOINT_INVALID',
  'PROVIDER_SECRET_IN_BODY',
  'PROVIDER_CREDENTIAL_EXISTS',
  'PROVIDER_PROBE_RATE_LIMITED',
  'PROVIDER_UNREACHABLE',
  'CONFIG_TRANSPORT_UNSUPPORTED',
  'CONFIG_PROVIDER_DISABLED',
  'CONFIG_CREDENTIAL_MISSING',
  'CONFIG_FALLBACK_IDENTICAL',
  'CONFIG_RESIDENCY_BLOCKS_LLM',
  'CONFIG_SECRET_IN_YAML',
  'CONFIG_YAML_UNKNOWN_KEY',
  'CONFIG_YAML_PARSE',
  'CONFIG_VERSION_UNSUPPORTED',
  'CONFIG_LANGUAGE_INVALID',
  'CONFIG_MODEL_REQUIRED',
  'CONFIG_VOICE_REQUIRED',
  'CONFIG_AVATAR_ID_REQUIRED',
  'CONFIG_PROMPT_TOO_LARGE',
  'CONFIG_RETRY_INVALID',
  'CONFIG_RETENTION_INVALID',
  'CONFIG_CONFLICT',
  'CONFIG_TOOL_UNKNOWN',
  'CONFIG_GRAPH_NODE_ID_DUPLICATE',
  'CONFIG_GRAPH_REF_UNKNOWN',
  'CONFIG_GRAPH_ENTRY_UNKNOWN',
  // Phase 10 (BL-040/041, docs/v2/BACKLOG.md) — V-1 critical-path/turn-budget check.
  'CONFIG_CRITICAL_PATH_EXCEEDS_BUDGET',
  'CONFIG_VERSION_NOT_FOUND',
  // Phase 11 (BL-042/043, docs/v2/BACKLOG.md) — Parallel/Loop structural checks.
  'CONFIG_LOOP_GUARD_INVALID',
  'CONFIG_GRAPH_CYCLE_DETECTED',
  'CONFIG_GRAPH_QUORUM_N_INVALID',
  // Phase 12b (BL-045/047, docs/v2/BACKLOG.md) — V-10 retrieval-pipeline budget check.
  'CONFIG_RETRIEVAL_BUDGET_EXCEEDED',
  // Phase 13 (BL-049/050/051, docs/v2/BACKLOG.md) — V-12 (skill refs known/enabled)
  // and V-11 (base-prompt token ceiling, warning-class).
  'CONFIG_SKILL_UNKNOWN',
  'CONFIG_BASE_PROMPT_COST_HIGH',
  'TOOL_NAME_REQUIRED',
  'TOOL_URL_INVALID',
  'TOOL_CREDENTIAL_MISSING',
  'TOOL_NOT_FOUND',
  'TOOL_API_REF_EXISTS',
  'TRANSPORT_UNAVAILABLE',
  'TRANSPORT_MIC_MISSING',
  'TRANSPORT_CAPACITY',
  'SESS_RANGE_INVALID',
  'SESS_QUERY_TOO_LONG',
  'SESSION_NOT_FOUND',
  'GPU_HEARTBEAT_INVALID',
  'TRANSCRIPT_PURGED',
  'CALL_MIC_DENIED',
  'CALL_RECONNECT_FAILED',
  'CALL_BROWSER_UNSUPPORTED',
  'CALL_SUMMARY_EXPIRED',
  'FEEDBACK_ALREADY_SUBMITTED',
  'FEEDBACK_INVALID',
  'RANGE_INVALID',
  'SUMMARY_UNAVAILABLE',
  'INTERNAL_PAYLOAD_INVALID',
  // Phase 12a (BL-044/046, docs/v2/BACKLOG.md) — RAG ingestion: KnowledgeSource
  // CRUD + the parse/chunk/embed/index pipeline.
  'KNOWLEDGE_SOURCE_NOT_FOUND',
  'KNOWLEDGE_SOURCE_FORBIDDEN',
  'KNOWLEDGE_SOURCE_FILE_MISSING',
  'KNOWLEDGE_SOURCE_FILE_TOO_LARGE',
  'KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED',
  'KNOWLEDGE_PARSER_NOT_SUPPORTED',
  'KNOWLEDGE_CHUNKING_STRATEGY_NOT_SUPPORTED',
  'KNOWLEDGE_EMBEDDING_MODEL_NOT_SUPPORTED',
  'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID',
  'KNOWLEDGE_SOURCE_NAME_REQUIRED',
  'KNOWLEDGE_SOURCE_STALE',
  'KNOWLEDGE_INGEST_FAILED',
  // Phase 13 (BL-049/050/051, docs/v2/BACKLOG.md) — Skills CRUD + own two-gate validator.
  'SKILL_NOT_FOUND',
  'SKILL_FORBIDDEN',
  'SKILL_NAME_REQUIRED',
  'SKILL_SLUG_EXISTS',
  'SKILL_DESCRIPTION_REQUIRED',
  'SKILL_INSTRUCTIONS_REQUIRED',
  'SKILL_TOOL_REF_UNKNOWN',
  'SKILL_VERSION_NOT_FOUND',
  // Phase 14 (BL-052..057, docs/v2/BACKLOG.md) — HITL gates/reviewer groups/decisions,
  // and V-6/V-7/V-8 (docs/v2/UX_SCOPE.md's exact three new codes).
  'HITL_GATE_NOT_FOUND',
  'HITL_GATE_FORBIDDEN',
  'HITL_REVIEWER_GROUP_NOT_FOUND',
  'HITL_REVIEWER_GROUP_NAME_REQUIRED',
  'HITL_REVIEWER_GROUP_NAME_EXISTS',
  'HITL_GATE_INCOMPLETE',
  'HITL_REVIEWER_COVERAGE_MISSING',
  'HITL_AUTO_APPROVE_ACK_REQUIRED',
  'HITL_DECISION_NOT_FOUND',
  'HITL_DECISION_ALREADY_DECIDED',
  'HITL_DECISION_FORBIDDEN',
  'CONFIG_CONSEQUENTIAL_TOOL_UNGATED',
  'CONFIG_HITL_GATE_UNKNOWN',
  // Phase 15 (BL-058..060, docs/v2/BACKLOG.md) — Sub-agent/Handoff/State.
  'CONFIG_SUBAGENT_TENANT_UNKNOWN',
  'CONFIG_SUBAGENT_SELF_REFERENCE',
  'CONFIG_SUBAGENT_NESTING_EXCEEDED',
  'CONFIG_STATE_VALUE_REQUIRED',
] as const;

/** Spec / LLD error code string. */
export type AppErrorCode = (typeof ERROR_CODES)[number];

/**
 * Authoritative client-facing sentences. Codes without a spec sentence use a
 * single factual fallback so the union stays closed.
 */
export const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  INTERNAL_ERROR: 'An unexpected error occurred.',
  IDEMPOTENCY_KEY_REUSED: 'This Idempotency-Key was already used with a different request body.',
  PAGE_SIZE_INVALID: 'page_size must be between 1 and 100.',
  TENANT_NAME_INVALID: 'Name is required and must be 1–80 characters.',
  TENANT_SLUG_INVALID:
    'Slug must be 2–48 characters, start with a letter, and contain only lowercase letters, digits, and hyphens.',
  TENANT_SLUG_EXISTS: 'A tenant with this slug already exists.',
  TENANT_LIMIT_REACHED: 'This platform instance supports at most 500 tenants.',
  TENANT_NOT_FOUND: 'Tenant not found.',
  TENANT_SLUG_IMMUTABLE: 'Slug cannot be changed after creation.',
  TENANT_FORBIDDEN: 'You are not assigned to this tenant.',
  TENANT_CONFLICT: 'Tenant was modified by another user. Reload and retry.',
  TENANT_STATUS_INVALID: 'Status must be active or paused.',
  TENANT_PAUSED: 'This deployment is paused.',
  AUTH_EMAIL_INVALID: 'Enter a valid email address.',
  AUTH_INVALID_CREDENTIALS: 'Email or password is incorrect.',
  AUTH_USER_DISABLED: 'This account is disabled. Contact an operator.',
  AUTH_RATE_LIMITED: 'Too many login attempts. Try again in a few minutes.',
  AUTH_REFRESH_INVALID: 'Session expired. Sign in again.',
  AUTH_UNAUTHORIZED: 'Sign in required.',
  // Malformed/missing request body on `/public/sessions/{id}/end` (QA Phase
  // 3 D-5) — distinct from AUTH_UNAUTHORIZED so a client can tell "you sent
  // a bad request" apart from "your token was rejected".
  AUTH_TOKEN_REQUIRED: 'A session token is required to end this call.',
  AUTH_ALREADY_SEEDED: 'Platform already has an operator.',
  AUTH_EMAIL_EXISTS: 'An admin with this email already exists.',
  AUTH_INVITE_INVALID: 'This invite link is invalid or has expired.',
  AUTH_PASSWORD_INVALID: 'Password must be at least 8 characters and include a letter and a digit.',
  AUTH_ROLE_FORBIDDEN: 'Only operators can grant the operator role.',
  CONFIG_INCOMPLETE: 'This deployment is not configured for conversations yet.',
  DISPLAY_NAME_INVALID: 'Display name must be 1–40 characters.',
  PROVIDER_CATEGORY_EMPTY: 'At least one provider must remain enabled in this category.',
  PROVIDER_UNKNOWN: "Unknown provider '{key}'.",
  PROVIDER_ENDPOINT_INVALID: 'Endpoint must be an https URL.',
  PROVIDER_SECRET_IN_BODY: 'Do not send raw secrets. Store a credential_ref instead.',
  PROVIDER_CREDENTIAL_EXISTS: 'A credential with this label already exists for the provider.',
  PROVIDER_PROBE_RATE_LIMITED: 'Too many provider probes. Try again shortly.',
  PROVIDER_UNREACHABLE: 'Could not reach {label} at {endpoint}.',
  CONFIG_TRANSPORT_UNSUPPORTED: 'v1 supports only LiveKit as transport.',
  CONFIG_PROVIDER_DISABLED: '{key} is disabled on this platform.',
  CONFIG_CREDENTIAL_MISSING: 'Add an endpoint and credential ref for {key} in Provider Registry.',
  CONFIG_FALLBACK_IDENTICAL: 'Fallback LLM must differ from the primary provider or model.',
  CONFIG_RESIDENCY_BLOCKS_LLM:
    "Residency policy 'none' cannot be used with a remote LLM. Choose prompt_text_only or an on-prem LLM (not available in v1).",
  CONFIG_SECRET_IN_YAML: 'Remove secrets from YAML. Use credential_ref fields only.',
  CONFIG_YAML_UNKNOWN_KEY: "Unknown key '{key}'.",
  CONFIG_YAML_PARSE: 'YAML could not be parsed: {parser_reason}.',
  CONFIG_VERSION_UNSUPPORTED: 'Only config version 1 is supported.',
  CONFIG_LANGUAGE_INVALID: 'stt.language must be a BCP-47 tag (e.g. en-US).',
  CONFIG_MODEL_REQUIRED: 'llm.primary.model is required.',
  CONFIG_VOICE_REQUIRED: 'tts.voice_id is required.',
  CONFIG_AVATAR_ID_REQUIRED: 'avatar.avatar_id is required.',
  CONFIG_PROMPT_TOO_LARGE: 'system_prompt must be at most 32768 bytes.',
  CONFIG_RETRY_INVALID: 'retry.max_attempts must be between 1 and 5.',
  CONFIG_RETENTION_INVALID: 'retain_transcripts_days must be between 1 and 730.',
  CONFIG_CONFLICT: 'Config was modified by another user. Reload and retry.',
  CONFIG_TOOL_UNKNOWN: "Unknown tool api_ref '{ref}'.",
  // Phase 9 (BL-035, docs/v2/BACKLOG.md) — reasoning graph structural checks.
  CONFIG_GRAPH_NODE_ID_DUPLICATE: "Duplicate graph node id '{id}'.",
  CONFIG_GRAPH_REF_UNKNOWN: "'{ref}' does not reference a node in this graph.",
  CONFIG_GRAPH_ENTRY_UNKNOWN: "reasoning.entry_node_id '{ref}' does not reference a node in this graph.",
  // Phase 10 (BL-040/041, docs/v2/BACKLOG.md) — V-1 critical-path/turn-budget check.
  CONFIG_CRITICAL_PATH_EXCEEDS_BUDGET: 'The critical path ({actual}ms) exceeds the turn budget ({budget}ms).',
  CONFIG_VERSION_NOT_FOUND: 'Config version not found.',
  // Phase 11 (BL-042/043, docs/v2/BACKLOG.md) — Parallel/Loop structural checks.
  CONFIG_LOOP_GUARD_INVALID: "Loop node '{id}' must have a positive {field} (R-G4 — a loop without guards cannot be saved).",
  CONFIG_GRAPH_CYCLE_DETECTED: 'This graph has a cycle outside of a Loop node, which is not allowed (R-G5).',
  CONFIG_GRAPH_QUORUM_N_INVALID: "Parallel node '{id}' with join_policy 'quorum' must set quorum_n between 1 and its branch count.",
  // Phase 12b (BL-045/047, docs/v2/BACKLOG.md) — V-10 retrieval-pipeline budget check.
  CONFIG_RETRIEVAL_BUDGET_EXCEEDED:
    "Retrieve node '{id}' pipeline stage budgets ({actual}ms) exceed its own budget ({budget}ms).",
  // Phase 13 (BL-049/050/051, docs/v2/BACKLOG.md) — V-12/V-11.
  CONFIG_SKILL_UNKNOWN: "Unknown or unpublished skill '{ref}'.",
  CONFIG_BASE_PROMPT_COST_HIGH: 'Base prompt (~{actual} tokens) exceeds the recommended ceiling (~{budget} tokens).',
  // Phase 8 (BL-033, docs/v2/BACKLOG.md) — Tools registry CRUD.
  TOOL_NAME_REQUIRED: 'Name is required and must be 1–80 characters.',
  TOOL_URL_INVALID: 'URL must be a valid https address.',
  TOOL_CREDENTIAL_MISSING: 'This tool requires a credential reference before it can be saved.',
  TOOL_NOT_FOUND: 'Tool not found.',
  TOOL_API_REF_EXISTS: 'A tool with this api_ref already exists for this tenant.',
  TRANSPORT_UNAVAILABLE: 'LiveKit is unreachable. Try again shortly.',
  TRANSPORT_MIC_MISSING: 'Microphone track was not published.',
  TRANSPORT_CAPACITY: 'All conversation slots are busy. Try again shortly.',
  SESS_RANGE_INVALID: 'from must be before to.',
  SESS_QUERY_TOO_LONG: 'Search query must be at most 200 characters.',
  SESSION_NOT_FOUND: 'Session not found.',
  GPU_HEARTBEAT_INVALID: 'GPU heartbeat payload is invalid.',
  TRANSCRIPT_PURGED: 'Transcript was deleted per the retention policy.',
  CALL_MIC_DENIED: 'Microphone access is required to start. Allow the microphone in your browser and retry.',
  CALL_RECONNECT_FAILED: 'Connection lost. Return to the start screen to rejoin.',
  CALL_BROWSER_UNSUPPORTED:
    'This browser cannot run a live video call. Use the latest Chrome, Edge, Firefox, or Safari.',
  CALL_SUMMARY_EXPIRED: 'This summary link has expired.',
  FEEDBACK_ALREADY_SUBMITTED: 'Feedback was already sent. Thank you.',
  FEEDBACK_INVALID: 'Rating must be between 1 and 5.',
  RANGE_INVALID: 'Invalid time range.',
  SUMMARY_UNAVAILABLE: 'A summary is not available for this session.',
  // Phase 4 (BL-013..017): malformed agent-facing /internal request body
  // (events/utterances/hops/summary/alerts). Internal-only surface — this
  // sentence is never rendered in an end-user or admin UI.
  INTERNAL_PAYLOAD_INVALID: 'Internal request payload is invalid.',
  // Phase 12a (BL-044/046, docs/v2/BACKLOG.md) — RAG ingestion.
  KNOWLEDGE_SOURCE_NOT_FOUND: 'Knowledge source not found.',
  KNOWLEDGE_SOURCE_FORBIDDEN: 'You are not assigned to this tenant.',
  KNOWLEDGE_SOURCE_FILE_MISSING: 'A file is required to create a knowledge source.',
  KNOWLEDGE_SOURCE_FILE_TOO_LARGE: 'File exceeds the 10 MiB upload limit.',
  KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED: 'Only plain text (.txt) and markdown (.md) files are supported.',
  KNOWLEDGE_PARSER_NOT_SUPPORTED: 'This parser is not available yet.',
  KNOWLEDGE_CHUNKING_STRATEGY_NOT_SUPPORTED: 'This chunking strategy is not available yet.',
  KNOWLEDGE_EMBEDDING_MODEL_NOT_SUPPORTED: 'This embedding model is not available yet.',
  KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID: 'chunk_overlap must be zero or greater and less than chunk_size.',
  KNOWLEDGE_SOURCE_NAME_REQUIRED: 'Name is required and must be 1–160 characters.',
  KNOWLEDGE_SOURCE_STALE: 'This knowledge source has not been re-indexed since its configuration changed.',
  KNOWLEDGE_INGEST_FAILED: 'The embedding service could not process this request.',
  // Phase 13 (BL-049/050/051, docs/v2/BACKLOG.md) — Skills.
  SKILL_NOT_FOUND: 'Skill not found.',
  SKILL_FORBIDDEN: 'You are not assigned to this tenant.',
  SKILL_NAME_REQUIRED: 'Name is required and must be 1–80 characters.',
  SKILL_SLUG_EXISTS: 'A skill with this name already exists for this tenant.',
  SKILL_DESCRIPTION_REQUIRED: 'Description is required and must be 1–500 characters.',
  SKILL_INSTRUCTIONS_REQUIRED: 'Instructions are required before this skill can be published.',
  SKILL_TOOL_REF_UNKNOWN: "Unknown tool api_ref '{ref}'.",
  SKILL_VERSION_NOT_FOUND: 'Skill version not found.',
  // Phase 14 (BL-052..057, docs/v2/BACKLOG.md) — HITL.
  HITL_GATE_NOT_FOUND: 'HITL gate not found.',
  HITL_GATE_FORBIDDEN: 'You are not assigned to this tenant.',
  HITL_REVIEWER_GROUP_NOT_FOUND: 'Reviewer group not found.',
  HITL_REVIEWER_GROUP_NAME_REQUIRED: 'Name is required and must be 1–80 characters.',
  HITL_REVIEWER_GROUP_NAME_EXISTS: 'A reviewer group with this name already exists for this tenant.',
  // R-H1 — all six mandatory fields (trigger condition, gate type, reviewer
  // group, SLA, hold treatment, timeout behaviour) or the gate cannot be saved.
  HITL_GATE_INCOMPLETE:
    'A HITL gate must specify a trigger condition, gate type, reviewer group, SLA, hold treatment, and timeout behaviour before it can be saved.',
  // V-7 — production-publish-blocking.
  HITL_REVIEWER_COVERAGE_MISSING:
    "Blocking gate '{id}' needs a reviewer group with at least one member and a notification channel before publish.",
  // V-8 — production-publish-blocking.
  HITL_AUTO_APPROVE_ACK_REQUIRED:
    "Gate '{id}' uses auto_approve on timeout for a consequential tool, which requires a written acknowledgement.",
  HITL_DECISION_NOT_FOUND: 'HITL decision not found.',
  HITL_DECISION_ALREADY_DECIDED: 'This decision has already been resolved.',
  HITL_DECISION_FORBIDDEN: 'You are not a member of this gate’s reviewer group.',
  // V-6 — production-publish-blocking.
  CONFIG_CONSEQUENTIAL_TOOL_UNGATED:
    "Consequential tool '{ref}' has no HITL gate and no written autonomous-use acknowledgement.",
  CONFIG_HITL_GATE_UNKNOWN: "Unknown HITL gate '{ref}'.",
  // Phase 15 (BL-058..060, docs/v2/BACKLOG.md) — Sub-agent/Handoff/State.
  CONFIG_SUBAGENT_TENANT_UNKNOWN: "Unknown or unpublished target agent '{ref}'.",
  CONFIG_SUBAGENT_SELF_REFERENCE: 'A Sub-agent node cannot delegate to its own tenant.',
  // R-G6/V-3 — blocks save.
  CONFIG_SUBAGENT_NESTING_EXCEEDED: "Sub-agent node '{id}' would exceed the 2-level nesting limit (R-G6) — the target agent already delegates to another sub-agent.",
  CONFIG_STATE_VALUE_REQUIRED: "State node '{id}' must set a value when mode is 'write'.",
};

/**
 * Looks up the spec sentence for a code.
 * @param code - Closed error-code union member
 * @returns Spec sentence (never throws; unknown strings fall back to INTERNAL_ERROR)
 */
export function messageForCode(code: AppErrorCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
}
