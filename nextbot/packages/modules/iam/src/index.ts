// PUBLIC API for @nextbot/iam — the ONLY file other packages may import from (LLD §2.2).

// domain
export { hashPassword, verifyPassword } from "./domain/password.js";
export {
  DEFAULT_LOCKOUT_POLICY,
  isLocked,
  lockoutRetryAfterSeconds,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  type LockoutPolicy,
  type LockoutState,
} from "./domain/lockout-policy.js";
export { hasAtLeast, mergePermissionMatrices, requirePermission } from "./domain/permission-matrix.js";
export { SYSTEM_ROLES, type SystemRoleDefinition } from "./domain/system-roles.js";
export { generateTotpEnrollment, verifyTotpCode, generateBackupCodes, type TotpEnrollment } from "./domain/totp.js";

// application
export {
  login,
  verifyMfaAndCompleteLogin,
  completeMfaEnrollmentAndLogin,
  type LoginInput,
  type LoginResult,
} from "./application/authenticate-user.js";
export { registerUser, EmailAlreadyRegisteredError, RoleNotFoundError, type RegisterUserInput } from "./application/register-user.js";
export { seedSystemRoles } from "./application/seed-system-roles.js";
export { listRoles, createRole, updateRole } from "./application/manage-roles.js";
export { listUsers, createUser, updateUserRoles, type CreateUserInput } from "./application/manage-users.js";
export { issueSessionToken, verifySessionToken, type SessionClaims } from "./application/session-token.js";
export {
  issueSandboxPreviewToken,
  verifySandboxPreviewToken,
  type SandboxPreviewClaims,
} from "./application/sandbox-preview-token.js";
export { enrollTotpMfa } from "./application/mfa-secret-vault.js";
export { generateAndPersistBackupCodes, consumeBackupCode } from "./application/mfa-backup-codes.js";
export { resetUserMfa } from "./application/reset-mfa.js";
export { iamTenantContext, findUserById, type UserRow, type UserWithRoles } from "./infrastructure/user-repository.js";

// Phase 4 (BL-36, FR-SEC-10) — SSO (SAML/OIDC), SCIM, session management,
// service accounts + scoped API keys.
export { isSessionActive } from "./infrastructure/session-repository.js";
export { upsertConnection, setConnectionStatus, getSsoConnectionConfig } from "./application/sso-connection.js";
export { buildSsoLoginUrl, completeOidcLogin, completeSamlLogin, type SsoLoginSuccess } from "./application/sso-login.js";
export {
  listMySessions,
  listTenantSessions,
  revokeMySession,
  revokeAllMySessions,
  adminRevokeSession,
  adminRevokeAllSessionsForUser,
} from "./application/session-management.js";
export {
  listServiceAccounts,
  createServiceAccount,
  disableServiceAccount,
  issueApiKey,
  listApiKeys,
  revokeApiKeyAction,
  verifyApiKey,
} from "./application/service-account.js";
export {
  listScimUsers,
  getScimUser,
  createScimUser,
  replaceScimUser,
  setScimUserActive,
  deleteScimUser,
  type ScimUserResource,
} from "./application/scim-users.js";
export {
  listSsoGroupMappings,
  upsertSsoGroupMapping,
  deleteSsoGroupMapping,
} from "./infrastructure/sso-group-mapping-repository.js";

// http (thin adapters for apps/web) — Phase 4 additions.
export {
  handleGetSsoConnection,
  handleUpsertSsoConnection,
  handleSetSsoConnectionStatus,
  handleListSsoGroupMappings,
  handleUpsertSsoGroupMapping,
  handleDeleteSsoGroupMapping,
} from "./http/sso-admin-routes.js";
export { handleSsoLoginStart, handleOidcCallback, handleSamlCallback } from "./http/sso-login-routes.js";
export {
  handleListMySessions,
  handleRevokeMySession,
  handleRevokeAllMySessions,
  handleListTenantSessions,
  handleAdminRevokeSession,
  handleAdminRevokeAllSessionsForUser,
} from "./http/session-routes.js";
export {
  handleListServiceAccounts,
  handleCreateServiceAccount,
  handleDisableServiceAccount,
  handleListApiKeys,
  handleIssueApiKey,
  handleRevokeApiKey,
} from "./http/service-account-routes.js";
export {
  handleScimListUsers,
  handleScimGetUser,
  handleScimCreateUser,
  handleScimReplaceUser,
  handleScimSetActive,
  handleScimDeleteUser,
} from "./http/scim-routes.js";
export { handleGetScimTokenStatus, handleRotateScimToken, handleRevokeScimToken } from "./http/scim-admin-routes.js";

// http (thin adapters for apps/web)
export {
  handleLogin,
  handleMfaChallenge,
  handleMfaEnrollmentConfirm,
  handleGetSession,
  handleListRoles,
  handleCreateRole,
  handleUpdateRole,
  handleResetUserMfa,
  handleListUsers,
  handleCreateUser,
  handleUpdateUserRoles,
} from "./http/admin-routes.js";
