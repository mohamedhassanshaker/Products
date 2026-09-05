import { describe, expect, it, vi } from "vitest";
import type * as WorkflowArtifactModule from "../domain/workflow-artifact.js";

/**
 * Unit-level (mocked) coverage for `validateWorkflowVersionYaml`'s one genuinely
 * defensive branch: `parseWorkflowArtifact` re-throwing something OTHER than a
 * `WorkflowGraphValidationError`. By construction it never actually throws
 * anything else in real operation (every failure path it has wraps in that one
 * error type) — this test exists purely to exercise that defensive re-throw, the
 * same way this codebase treats an "impossible in practice, kept for safety"
 * branch elsewhere (e.g. `evaluateOrDeny`'s own catch-all).
 */
const parseWorkflowArtifactMock = vi.fn();
vi.mock("../domain/workflow-artifact.js", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkflowArtifactModule>();
  return { ...actual, parseWorkflowArtifact: (...args: unknown[]) => parseWorkflowArtifactMock(...args) };
});

const CTX = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("validateWorkflowVersionYaml — defensive re-throw path", () => {
  // 60s timeout: importing `workflow-service.js` transitively pulls in
  // `agent-platform`/`authz`/`model-gateway` (via `graph-validator.js`) — the
  // same one-time cold-worker transform cost `teams`' own `admin-routes.test.ts`
  // already documents needing a generous timeout for.
  it(
    "propagates an unexpected (non-WorkflowGraphValidationError) throw from parseWorkflowArtifact rather than swallowing it",
    async () => {
      parseWorkflowArtifactMock.mockImplementation(() => {
        throw new Error("unexpected");
      });
      const { validateWorkflowVersionYaml } = await import("./workflow-service.js");

      await expect(validateWorkflowVersionYaml(CTX, "wf", "yaml text")).rejects.toThrow("unexpected");
    },
    60_000,
  );
});
