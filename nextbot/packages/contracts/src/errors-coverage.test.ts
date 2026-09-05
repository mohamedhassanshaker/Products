import { describe, expect, it } from "vitest";
import {
  AccountLockedError,
  AuthNoRoleAssignedError,
  BreakglassAccessDeniedError,
  BreakglassGrantAlreadyActiveError,
  BreakglassGrantExpiryTooLongError,
  ConnectorEndpointInvalidError,
  ConnectorNotFoundError,
  CredentialRequiredError,
  ForbiddenModuleError,
  InvalidCredentialsError,
  InvalidRoleAssignmentError,
  MfaChallengeInvalidError,
  MfaRequiredError,
  PermissionRuleInvalidError,
  RoleNameDuplicateError,
  RoleNotFoundInTenantError,
  SandboxPreviewInvalidError,
  SessionInvalidError,
  SystemRoleImmutableError,
  ToolNotFoundError,
  UserNotFoundInTenantError,
} from "./index.js";

/**
 * Direct construction tests for every `DomainError` subclass that isn't already
 * exercised as a side effect of an integration test (LLD §11.2's error-code table —
 * each of these is a real, user-facing RFC 9457 body via `problemResponse()` in
 * `apps/web`, so its message text is itself a small contract worth pinning).
 */
describe("contracts error classes", () => {
  it("ToolNotFoundError names the tool id and maps to 404", () => {
    const err = new ToolNotFoundError("tool-1");
    expect(err.code).toBe("TOOL_NOT_FOUND");
    expect(err.httpStatus).toBe(404);
    expect(err.message).toContain("tool-1");
  });

  it("PermissionRuleInvalidError includes the reason and maps to 422", () => {
    const err = new PermissionRuleInvalidError("scope/target mismatch");
    expect(err.httpStatus).toBe(422);
    expect(err.message).toContain("scope/target mismatch");
  });

  it("ConnectorNotFoundError/ConnectorEndpointInvalidError/CredentialRequiredError carry the right status codes", () => {
    expect(new ConnectorNotFoundError("c1").httpStatus).toBe(404);
    expect(new ConnectorEndpointInvalidError("must be https").httpStatus).toBe(422);
    expect(new CredentialRequiredError().httpStatus).toBe(422);
  });

  it("AccountLockedError renders the retry-after in minutes and is distinct from InvalidCredentialsError (FR-SEC-03)", () => {
    const locked = new AccountLockedError(300);
    const badCreds = new InvalidCredentialsError();
    expect(locked.message).toContain("5 minute");
    expect(locked.message).not.toBe(badCreds.message);
    expect(locked.httpStatus).toBe(423);
  });

  it("AuthNoRoleAssignedError / MfaRequiredError / MfaChallengeInvalidError / SessionInvalidError construct correctly", () => {
    expect(new AuthNoRoleAssignedError().code).toBe("AUTH_NO_ROLE_ASSIGNED");
    expect(new MfaRequiredError("challenge-token").challengeToken).toBe("challenge-token");
    expect(new MfaChallengeInvalidError().httpStatus).toBe(401);
    expect(new SessionInvalidError().httpStatus).toBe(401);
  });

  it("RoleNameDuplicateError / ForbiddenModuleError name the offending role/module", () => {
    expect(new RoleNameDuplicateError("Custom Role").message).toContain("Custom Role");
    const forbidden = new ForbiddenModuleError("connectors", "Write");
    expect(forbidden.module).toBe("connectors");
    expect(forbidden.required).toBe("Write");
  });

  it("SystemRoleImmutableError names the role and maps to 409 (Users & Roles screen completion)", () => {
    const err = new SystemRoleImmutableError("Tenant Admin");
    expect(err.code).toBe("SYSTEM_ROLE_IMMUTABLE");
    expect(err.httpStatus).toBe(409);
    expect(err.message).toContain("Tenant Admin");
  });

  it("RoleNotFoundInTenantError / UserNotFoundInTenantError map to 404", () => {
    expect(new RoleNotFoundInTenantError().httpStatus).toBe(404);
    expect(new UserNotFoundInTenantError().httpStatus).toBe(404);
  });

  it("InvalidRoleAssignmentError maps to 422", () => {
    expect(new InvalidRoleAssignmentError().httpStatus).toBe(422);
    expect(new InvalidRoleAssignmentError().code).toBe("INVALID_ROLE_ASSIGNMENT");
  });

  it("SandboxPreviewInvalidError maps to 403 (Phase 6 fail-closed sandbox-preview gate)", () => {
    const err = new SandboxPreviewInvalidError();
    expect(err.code).toBe("SANDBOX_PREVIEW_INVALID");
    expect(err.httpStatus).toBe(403);
  });

  it("BreakglassAccessDeniedError maps to 403 and carries its denial reason (Phase 20, FR-ADM-09 fail-closed gate)", () => {
    const noGrant = new BreakglassAccessDeniedError("no_grant");
    expect(noGrant.code).toBe("BREAKGLASS_ACCESS_DENIED");
    expect(noGrant.httpStatus).toBe(403);
    expect(noGrant.reason).toBe("no_grant");
    expect(new BreakglassAccessDeniedError("revoked").reason).toBe("revoked");
    expect(new BreakglassAccessDeniedError("expired").reason).toBe("expired");
  });

  it("BreakglassGrantAlreadyActiveError maps to 409 (Phase 20)", () => {
    const err = new BreakglassGrantAlreadyActiveError();
    expect(err.code).toBe("BREAKGLASS_GRANT_ALREADY_ACTIVE");
    expect(err.httpStatus).toBe(409);
  });

  it("BreakglassGrantExpiryTooLongError names the max hours and maps to 422 (Phase 20)", () => {
    const err = new BreakglassGrantExpiryTooLongError(24);
    expect(err.code).toBe("BREAKGLASS_GRANT_EXPIRY_TOO_LONG");
    expect(err.httpStatus).toBe(422);
    expect(err.message).toContain("24");
  });
});
