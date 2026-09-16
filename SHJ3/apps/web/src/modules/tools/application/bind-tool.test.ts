import { describe, expect, it } from "vitest";
import { FakeToolBindingRepository } from "../testing/fakes.js";
import { BindTool } from "./bind-tool.js";
import { UnbindTool } from "./unbind-tool.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("binding a tool to an agent version — the shared path", () => {
  it("round-trips: binding via one call is visible via listForVersion immediately", async () => {
    // The real cross-surface proof (wizard step 4 and B5 both reading the same
    // live data through real infrastructure) is the parent orchestrator's job;
    // this proves the shared path is genuinely one code path against one store,
    // which is the property that makes that later proof possible at all.
    const bindings = new FakeToolBindingRepository();
    const bind = new BindTool({ bindings });

    const result = await bind.execute({
      agentVersionId: "agentver_1",
      targetKind: "Skill",
      targetId: "skill_a",
      requiredAssurance: "Verified",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    const rows = await bindings.listForVersion("agentver_1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.skillId).toBe("skill_a");
    expect(rows[0]?.isEnabled).toBe(true);
  });

  it("re-binding a previously-unbound target flips isEnabled back on without disturbing original attribution", async () => {
    const bindings = new FakeToolBindingRepository();
    const bind = new BindTool({ bindings });
    const unbind = new UnbindTool({ bindings });

    const first = await bind.execute({
      agentVersionId: "agentver_1",
      targetKind: "Skill",
      targetId: "skill_a",
      requiredAssurance: "Verified",
      actorStaffUserId: "usr_original_binder",
      now: NOW,
    });
    await unbind.execute({
      agentVersionId: "agentver_1",
      targetKind: "Skill",
      targetId: "skill_a",
    });

    const second = await bind.execute({
      agentVersionId: "agentver_1",
      targetKind: "Skill",
      targetId: "skill_a",
      requiredAssurance: "VerifiedPlusOtp",
      actorStaffUserId: "usr_someone_else",
      now: new Date(NOW.getTime() + 1000),
    });

    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.binding.id).toBe(first.binding.id);
      expect(second.binding.boundByStaffUserId).toBe("usr_original_binder");
      expect(second.binding.boundAt).toEqual(first.binding.boundAt);
      expect(second.binding.isEnabled).toBe(true);
    }
  });

  it("propagates a trigger-rejection reason unchanged", async () => {
    const bindings = new FakeToolBindingRepository();
    bindings.rejectNextBind("tools.server_not_connected");
    const bind = new BindTool({ bindings });

    const result = await bind.execute({
      agentVersionId: "agentver_1",
      targetKind: "McpTool",
      targetId: "mcptool_a",
      requiredAssurance: "Anonymous",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "tools.server_not_connected" });
    expect(await bindings.listForVersion("agentver_1")).toEqual([]);
  });
});
