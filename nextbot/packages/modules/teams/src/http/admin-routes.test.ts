import { describe, expect, it, vi } from "vitest";

/**
 * Thin `http/` delegation checks: every handler is a pure adapter onto an
 * application-layer function, so the only thing worth asserting here is that it
 * calls the right one with the right arguments (the behaviour itself is covered by
 * the real-Postgres integration suites).
 *
 * **Timeout note**: Phase 14 (BL-46) turned this module from four files into Module
 * E proper, so importing `admin-routes.js` now transitively pulls in
 * `orchestration`/`model-gateway`/`authz`/`ai-registry`. That one-time transform +
 * import cost regularly exceeds vitest's 5s default on a cold worker — the same
 * heavy-import timeout class this project's own decision log already documents for
 * `apps/web/app/api/internal/ops/**`. The generous per-test timeout below is about
 * module loading, not about anything this test actually waits on.
 */
const getDelegationTreeMock = vi.fn();
const listTeamsForAdminMock = vi.fn();
const validateTeamArtifactMock = vi.fn();
const transitionTeamVersionMock = vi.fn();

vi.mock("../application/delegation-tree-service.js", () => ({ getDelegationTree: (...args: unknown[]) => getDelegationTreeMock(...args) }));
vi.mock("../application/team-service.js", () => ({
  listTeamsForAdmin: (...args: unknown[]) => listTeamsForAdminMock(...args),
  createTeamWithFirstVersion: vi.fn(),
  getTeam: vi.fn(),
  updateTeam: vi.fn(),
}));
vi.mock("../application/team-version-service.js", () => ({
  validateTeamArtifact: (...args: unknown[]) => validateTeamArtifactMock(...args),
  transitionTeamVersion: (...args: unknown[]) => transitionTeamVersionMock(...args),
  createTeamVersion: vi.fn(),
  getAllowedTransitions: vi.fn(),
  getSandboxCoverage: vi.fn(),
}));
vi.mock("../application/team-run-service.js", () => ({ runTeamSandbox: vi.fn() }));

const CTX = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("teams http/admin-routes (unit, mocked application layer)", () => {
  it(
    "handleGetDelegationTree delegates to getDelegationTree()",
    async () => {
      const { handleGetDelegationTree } = await import("./admin-routes.js");
      getDelegationTreeMock.mockResolvedValue({ agentRunId: "run-1", roots: [] });

      const result = await handleGetDelegationTree(CTX, "run-1");

      expect(getDelegationTreeMock).toHaveBeenCalledWith(CTX, "run-1");
      expect(result).toEqual({ agentRunId: "run-1", roots: [] });
    },
    60_000,
  );

  it(
    "handleListTeams delegates to listTeamsForAdmin()",
    async () => {
      const { handleListTeams } = await import("./admin-routes.js");
      listTeamsForAdminMock.mockResolvedValue([{ id: "team-1" }]);

      expect(await handleListTeams(CTX)).toEqual([{ id: "team-1" }]);
      expect(listTeamsForAdminMock).toHaveBeenCalledWith(CTX);
    },
    60_000,
  );

  it(
    "handleValidateTeamVersion parses the raw YAML before validating — a YAML syntax error never reaches the validator",
    async () => {
      const { handleValidateTeamVersion } = await import("./admin-routes.js");
      await expect(handleValidateTeamVersion(CTX, "kind: team\n  bad indent: [")).rejects.toThrow(/not valid YAML/);
      expect(validateTeamArtifactMock).not.toHaveBeenCalled();
    },
    60_000,
  );

  it(
    "handleTransitionTeamVersion passes the ACTING user through — the four-eyes check has real input",
    async () => {
      const { handleTransitionTeamVersion } = await import("./admin-routes.js");
      transitionTeamVersionMock.mockResolvedValue({ id: "v1", status: "Approved" });

      const result = await handleTransitionTeamVersion(CTX, "v1", "Approved", "user-9");

      expect(transitionTeamVersionMock).toHaveBeenCalledWith(CTX, "v1", "Approved", "user-9");
      expect(result).toEqual({ version: { id: "v1", status: "Approved" } });
    },
    60_000,
  );
});
