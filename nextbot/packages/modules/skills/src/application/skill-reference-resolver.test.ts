import { describe, expect, it, vi, beforeEach } from "vitest";
import { SkillReferenceNotFoundError } from "@nextbot/contracts";

const resolveCapabilityGroupIdsByNamesMock = vi.fn();
const findToolByNameMock = vi.fn();
const findConnectorByNameMock = vi.fn();

vi.mock("@nextbot/tool-registry", () => ({
  resolveCapabilityGroupIdsByNames: (...a: unknown[]) => resolveCapabilityGroupIdsByNamesMock(...a),
  findToolByName: (...a: unknown[]) => findToolByNameMock(...a),
}));
vi.mock("@nextbot/connectors", () => ({
  findConnectorByName: (...a: unknown[]) => findConnectorByNameMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

/**
 * FR-AGT-11 / ADR-0015 §2.2 — unit coverage (mocked collaborators) for every
 * resolution branch `resolveSkillScopeReferences` has: capability-group not
 * found, malformed tool pin (no '@' / trailing '@'), connector not found, tool not
 * found, and the success path resolving multiple references in order. The
 * real-Postgres integration suite (`skill-service.int.test.ts`) already covers the
 * end-to-end happy path and one negative case through the real repositories —
 * this file exists to reach the branches that require a specific collaborator
 * response the integration fixtures don't naturally produce.
 */
describe("resolveSkillScopeReferences (unit, mocked collaborators)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves capability groups and tools in order, preserving array position", async () => {
    resolveCapabilityGroupIdsByNamesMock.mockResolvedValueOnce(["cg-1"]).mockResolvedValueOnce(["cg-2"]);
    findConnectorByNameMock.mockResolvedValue({ id: "conn-1" });
    findToolByNameMock.mockResolvedValue({ id: "tool-1" });

    const { resolveSkillScopeReferences } = await import("./skill-reference-resolver.js");
    const result = await resolveSkillScopeReferences(ctx, { capabilityGroups: ["billing", "support"], tools: ["payment.refund@billing_core"], knowledge: [] });

    expect(result).toEqual({ capabilityGroupIds: ["cg-1", "cg-2"], toolIds: ["tool-1"] });
    expect(findConnectorByNameMock).toHaveBeenCalledWith(ctx, ctx.environment, "billing_core");
    expect(findToolByNameMock).toHaveBeenCalledWith(ctx, "conn-1", "payment.refund");
  });

  it("names the exact missing capability group at its array index", async () => {
    resolveCapabilityGroupIdsByNamesMock.mockResolvedValueOnce([]);
    const { resolveSkillScopeReferences } = await import("./skill-reference-resolver.js");
    await expect(resolveSkillScopeReferences(ctx, { capabilityGroups: ["nonexistent"], tools: [], knowledge: [] })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SkillReferenceNotFoundError);
      expect((err as SkillReferenceNotFoundError).fields?.[0]?.path).toBe("scope.capabilityGroups[0]");
      return true;
    });
  });

  it("rejects a tool pin with no '@' at all", async () => {
    const { resolveSkillScopeReferences } = await import("./skill-reference-resolver.js");
    await expect(resolveSkillScopeReferences(ctx, { capabilityGroups: [], tools: ["no_at_sign"], knowledge: [] })).rejects.toThrow(/toolName@connectorName/);
  });

  it("rejects a tool pin with a trailing '@' and no connector name", async () => {
    const { resolveSkillScopeReferences } = await import("./skill-reference-resolver.js");
    await expect(resolveSkillScopeReferences(ctx, { capabilityGroups: [], tools: ["payment.refund@"], knowledge: [] })).rejects.toThrow(/toolName@connectorName/);
  });

  it("names the missing connector when the connector half of a tool pin doesn't resolve", async () => {
    findConnectorByNameMock.mockResolvedValue(null);
    const { resolveSkillScopeReferences } = await import("./skill-reference-resolver.js");
    await expect(resolveSkillScopeReferences(ctx, { capabilityGroups: [], tools: ["payment.refund@ghost_connector"], knowledge: [] })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SkillReferenceNotFoundError);
      expect((err as SkillReferenceNotFoundError).message).toContain("ghost_connector");
      return true;
    });
  });

  it("names the missing tool when the connector resolves but the tool name doesn't", async () => {
    findConnectorByNameMock.mockResolvedValue({ id: "conn-1" });
    findToolByNameMock.mockResolvedValue(null);
    const { resolveSkillScopeReferences } = await import("./skill-reference-resolver.js");
    await expect(resolveSkillScopeReferences(ctx, { capabilityGroups: [], tools: ["payment.void@billing_core"], knowledge: [] })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SkillReferenceNotFoundError);
      expect((err as SkillReferenceNotFoundError).message).toContain("payment.void@billing_core");
      return true;
    });
  });
});
