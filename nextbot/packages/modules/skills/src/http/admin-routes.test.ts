import { describe, expect, it, vi, beforeEach } from "vitest";

const createSkillMock = vi.fn();
const listSkillsForLibraryMock = vi.fn();
const getSkillByIdMock = vi.fn();
const listVersionsMock = vi.fn();
const getVersionMock = vi.fn();
const createSkillVersionMock = vi.fn();
const publishVersionMock = vi.fn();
const deprecateVersionMock = vi.fn();
const structuralDiffVersionsMock = vi.fn();

vi.mock("../application/skill-service.js", () => ({
  createSkill: (...a: unknown[]) => createSkillMock(...a),
  listSkillsForLibrary: (...a: unknown[]) => listSkillsForLibraryMock(...a),
  getSkillById: (...a: unknown[]) => getSkillByIdMock(...a),
  listVersions: (...a: unknown[]) => listVersionsMock(...a),
  getVersion: (...a: unknown[]) => getVersionMock(...a),
  createSkillVersion: (...a: unknown[]) => createSkillVersionMock(...a),
  publishVersion: (...a: unknown[]) => publishVersionMock(...a),
  deprecateVersion: (...a: unknown[]) => deprecateVersionMock(...a),
  structuralDiffVersions: (...a: unknown[]) => structuralDiffVersionsMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

/** Unit coverage for the thin `http/` pass-through layer (LLD §2.2) — every
 * `handle*` here is a one-line delegation; these tests assert the delegation
 * itself (correct target, correct argument order) rather than re-testing
 * `skill-service.ts`'s own logic (already covered by the real-Postgres
 * integration suite). */
describe("skills http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handleCreateSkill delegates to createSkill", async () => {
    createSkillMock.mockResolvedValue({ skill: { id: "s1" } });
    const { handleCreateSkill } = await import("./admin-routes.js");
    const input = { name: "x", artifact: {} } as never;
    expect(await handleCreateSkill(ctx, input, "user-1")).toEqual({ skill: { id: "s1" } });
    expect(createSkillMock).toHaveBeenCalledWith(ctx, input, "user-1");
  });

  it("handleListSkills delegates to listSkillsForLibrary", async () => {
    listSkillsForLibraryMock.mockResolvedValue([{ id: "s1" }]);
    const { handleListSkills } = await import("./admin-routes.js");
    expect(await handleListSkills(ctx)).toEqual([{ id: "s1" }]);
    expect(listSkillsForLibraryMock).toHaveBeenCalledWith(ctx);
  });

  it("handleGetSkill delegates to getSkillById", async () => {
    getSkillByIdMock.mockResolvedValue({ id: "s1" });
    const { handleGetSkill } = await import("./admin-routes.js");
    expect(await handleGetSkill(ctx, "s1")).toEqual({ id: "s1" });
    expect(getSkillByIdMock).toHaveBeenCalledWith(ctx, "s1");
  });

  it("handleListVersions delegates to listVersions", async () => {
    listVersionsMock.mockResolvedValue([{ id: "v1" }]);
    const { handleListVersions } = await import("./admin-routes.js");
    expect(await handleListVersions(ctx, "s1")).toEqual([{ id: "v1" }]);
    expect(listVersionsMock).toHaveBeenCalledWith(ctx, "s1");
  });

  it("handleGetVersion delegates to getVersion", async () => {
    getVersionMock.mockResolvedValue({ id: "v1" });
    const { handleGetVersion } = await import("./admin-routes.js");
    expect(await handleGetVersion(ctx, "v1")).toEqual({ id: "v1" });
    expect(getVersionMock).toHaveBeenCalledWith(ctx, "v1");
  });

  it("handleCreateVersion delegates to createSkillVersion with the artifact unwrapped", async () => {
    createSkillVersionMock.mockResolvedValue({ id: "v2" });
    const { handleCreateVersion } = await import("./admin-routes.js");
    const artifact = { kind: "skill" } as never;
    expect(await handleCreateVersion(ctx, "s1", { artifact }, "user-1")).toEqual({ id: "v2" });
    expect(createSkillVersionMock).toHaveBeenCalledWith(ctx, "s1", artifact, "user-1");
  });

  it("handlePublishVersion delegates to publishVersion", async () => {
    publishVersionMock.mockResolvedValue({ id: "v1", status: "Published" });
    const { handlePublishVersion } = await import("./admin-routes.js");
    expect(await handlePublishVersion(ctx, "v1", "user-1")).toEqual({ id: "v1", status: "Published" });
    expect(publishVersionMock).toHaveBeenCalledWith(ctx, "v1", "user-1");
  });

  it("handleDeprecateVersion delegates to deprecateVersion with the note unwrapped", async () => {
    deprecateVersionMock.mockResolvedValue({ id: "v1", status: "Deprecated" });
    const { handleDeprecateVersion } = await import("./admin-routes.js");
    expect(await handleDeprecateVersion(ctx, "v1", { note: "superseded" })).toEqual({ id: "v1", status: "Deprecated" });
    expect(deprecateVersionMock).toHaveBeenCalledWith(ctx, "v1", "superseded");
  });

  it("handleStructuralDiffVersions delegates to structuralDiffVersions", async () => {
    structuralDiffVersionsMock.mockResolvedValue([{ op: "changed", path: "trigger" }]);
    const { handleStructuralDiffVersions } = await import("./admin-routes.js");
    expect(await handleStructuralDiffVersions(ctx, "v1", "v2")).toEqual([{ op: "changed", path: "trigger" }]);
    expect(structuralDiffVersionsMock).toHaveBeenCalledWith(ctx, "v1", "v2");
  });
});
