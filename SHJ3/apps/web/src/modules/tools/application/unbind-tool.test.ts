import { describe, expect, it } from "vitest";
import { FakeToolBindingRepository } from "../testing/fakes.js";
import { BindTool } from "./bind-tool.js";
import { UnbindTool } from "./unbind-tool.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("unbinding a tool from an agent version", () => {
  it("disables the binding rather than deleting it", async () => {
    const bindings = new FakeToolBindingRepository();
    const bind = new BindTool({ bindings });
    const unbind = new UnbindTool({ bindings });
    await bind.execute({
      agentVersionId: "agentver_1",
      targetKind: "ApiConnector",
      targetId: "conn_a",
      requiredAssurance: "Verified",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    const result = await unbind.execute({
      agentVersionId: "agentver_1",
      targetKind: "ApiConnector",
      targetId: "conn_a",
    });

    expect(result).toEqual({ ok: true });
    const rows = await bindings.listForVersion("agentver_1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isEnabled).toBe(false);
  });

  it("returns tools.binding_not_found for a binding that was never made", async () => {
    const bindings = new FakeToolBindingRepository();
    const unbind = new UnbindTool({ bindings });

    const result = await unbind.execute({
      agentVersionId: "agentver_1",
      targetKind: "Skill",
      targetId: "skill_ghost",
    });

    expect(result).toEqual({ ok: false, reason: "tools.binding_not_found" });
  });
});
