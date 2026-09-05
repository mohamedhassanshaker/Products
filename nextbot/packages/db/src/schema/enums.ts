import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared Postgres enums (LLD §3.1: "Enums are Postgres native enums declared with
 * Drizzle `pgEnum`, values `PascalCase`"). Enums used by more than one module's
 * tables live here so they aren't redeclared.
 */

/** NFR-6 — extensible data-residency region. */
export const regionEnum = pgEnum("region", ["UAE", "EU", "US"]);

/** LLD §3.3 — connector/channel environment vocabulary (distinct from DeployEnvironment). */
export const environmentEnum = pgEnum("environment", ["Sandbox", "Staging", "Production"]);

/** LLD §3.3 — tenant lifecycle status. */
export const tenantStatusEnum = pgEnum("tenant_status", ["Active", "Suspended", "Trial"]);

/** LLD §3.3 / NFR-4a — drives `tenant_runtime_quota` seeding and the Enterprise escape hatch. */
export const planTierEnum = pgEnum("plan_tier", ["Starter", "Growth", "Enterprise"]);

/** LLD §3.3 — `app_user.status` (BL-01 IAM slice). */
export const userStatusEnum = pgEnum("user_status", ["Active", "Locked", "Disabled", "Invited"]);

/** LLD §3.3 — `app_user.mfa_method` (FR-SEC-03). TOTP is fully implemented this phase;
 * Sms/Email are stubbed behind the same `MfaChallenger` interface (plan open item #2). */
export const mfaMethodEnum = pgEnum("mfa_method", ["Totp", "Sms", "Email"]);

/** LLD §3.3 — `login_attempt.outcome`, feeds lockout + audit. `SsoFailed` added
 * Phase 4 (BL-36, FR-SEC-10) — a SAML/OIDC assertion/token that fails validation
 * is a distinct, auditable outcome from a bad local password. */
export const loginOutcomeEnum = pgEnum("login_outcome", [
  "Success",
  "BadCredentials",
  "Locked",
  "NoRole",
  "MfaFailed",
  "SsoFailed",
]);

/** Phase 4 (BL-36) — `app_user.kind`: distinguishes a human console user from a
 * non-human service account (FR-SEC-10). A service account never has a password/
 * SSO subject and is never presented in the ordinary "sign in" flow — it
 * authenticates exclusively via a scoped `api_key`. */
export const userKindEnum = pgEnum("user_kind", ["Human", "ServiceAccount"]);

/** Phase 4 (BL-36) — `sso_connection.protocol`. One connection per tenant (see
 * `packages/modules/iam/README.md`'s Phase 4 decision log). */
export const ssoProtocolEnum = pgEnum("sso_protocol", ["Saml", "Oidc"]);

/** Phase 4 (BL-36) — `sso_connection.status`: `Disabled` until an admin has
 * supplied and (implicitly) exercised valid IdP configuration; login is rejected
 * fail-closed while `Disabled` regardless of how complete the stored config looks. */
export const ssoConnectionStatusEnum = pgEnum("sso_connection_status", ["Disabled", "Active"]);

/**
 * Phase 4 retry (QA `20260829-054900` Finding 1) — `user_role.source`: distinguishes
 * a role grant an admin (or SCIM provisioning, which is an equivalent administrative
 * act) made deliberately (`Manual`) from one this codebase itself derived from the
 * IdP's current group assertion (`Sso`). This distinction is what lets SSO login
 * re-derive its OWN grants on every login (add/remove to match the current IdP
 * assertion exactly) without ever touching a grant an admin made through the console
 * — see `application/sso-login.ts`'s `syncSsoRoleAssignment` doc comment for the full
 * rationale. Defaults to `Manual` so every pre-existing/administrative call site
 * (register/invite, SCIM, service accounts) is unaffected without having to pass it
 * explicitly.
 */
export const userRoleSourceEnum = pgEnum("user_role_source", ["Manual", "Sso"]);

/** LLD §3.4 — channel type vocabulary (X dropped from scope, mirrors `contracts`' `ChannelTypeSchema`). */
export const channelTypeEnum = pgEnum("channel_type", [
  "WebWidget",
  "WhatsApp",
  "Messenger",
  "Instagram",
  "Voice",
  "Email",
  "Sms",
  "Slack",
  "Teams",
]);

/** LLD §3.4 — a channel is exactly one of these three statuses. */
export const channelStatusEnum = pgEnum("channel_status", ["Active", "Inactive", "Error"]);

/** LLD §3.4 `channel_capability.form_strategy` — FR-OC-06 automatic degradation. */
export const formStrategyEnum = pgEnum("form_strategy", ["Native", "SequentialPrompt"]);

/** LLD §3.4 `channel_capability.list_strategy` — FR-OC-06 automatic degradation. */
export const listStrategyEnum = pgEnum("list_strategy", ["Native", "NumberedText"]);

/** LLD §3.7 — `conversation.status`. */
export const conversationStatusEnum = pgEnum("conversation_status", [
  "Active",
  "Resolved",
  "Escalated",
  "Abandoned",
]);

/** LLD §3.7 — `conversation.resolution_type`, NULL until closed. */
export const resolutionTypeEnum = pgEnum("resolution_type", ["AI", "Human", "Abandoned"]);

/** LLD §3.7 — `message.sender`. */
export const messageSenderEnum = pgEnum("message_sender", ["Customer", "AI", "HumanAgent", "System"]);

/** LLD §3.9 — `escalation.reason` (FR-ESC-01, required non-null). */
export const escalationReasonEnum = pgEnum("escalation_reason", [
  "LowConfidence",
  "ToolFailure",
  "CustomerRequest",
  "SensitiveTopic",
]);

/** LLD §3.9 — `escalation.status`. */
export const escalationStatusEnum = pgEnum("escalation_status", [
  "Waiting",
  "InProgress",
  "Resolved",
  "ReturnedToBot",
]);

/**
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) —
 * `agent_presence.state`. Purely informational/self-service this phase (does not
 * gate claiming — only `current_load`/`max_concurrent` do; see `agent-presence-
 * service.ts`'s own doc comment for the rationale).
 */
export const agentPresenceStateEnum = pgEnum("agent_presence_state", ["Available", "Busy", "Away", "Offline"]);

/**
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) —
 * `escalation_assignment_log.action`. Append-only audit trail of every load-affecting
 * transition (never updated in place).
 */
export const escalationAssignmentActionEnum = pgEnum("escalation_assignment_action", [
  "Claimed",
  "Released",
  "Reassigned",
  "AutoAssigned",
]);

/**
 * LLD §3.7 — `message.content_type`: "the 14 FR-AI-04 types + `Error`" (15 total).
 * All 15 values exist in the Postgres enum from this phase on (cheap, avoids a future
 * `ALTER TYPE ... ADD VALUE` migration) even though only 5 have a TypeBox payload
 * schema / code path yet — see `packages/contracts/src/messages.ts`'s module doc.
 */
export const messageContentTypeEnum = pgEnum("message_content_type", [
  "Text",
  "QuickReply",
  "List",
  "ExternalLink",
  "Document",
  "DataSummary",
  "DataTable",
  "Form",
  "OTP",
  "Confirmation",
  "TicketCreated",
  "TicketStatus",
  "FileUpload",
  "Error",
]);

/** LLD §3.7 — `message.delivery_status`. */
export const deliveryStatusEnum = pgEnum("delivery_status", [
  "Pending",
  "Sent",
  "Delivered",
  "Read",
  "Failed",
]);
