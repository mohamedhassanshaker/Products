import { describe, expect, it } from "vitest";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import { FakeClock, FakeUserRepository, staffUserFixture } from "../testing/fakes.js";
import { ReactivateUser } from "./reactivate-user.js";

/**
 * Reactivating a suspended user.
 *
 * Mirrors `suspend-user.test.ts`'s own structure — see that file first. The
 * property worth calling out here is the one `SuspendUser`'s own doc comment
 * documents about its counterpart: reactivation does not restore sessions.
 * This test file demonstrates that structurally by never constructing a
 * `SessionStore` at all — `ReactivateUserDeps` has no field for one, so there
 * is nothing a test could assert against even if it wanted to.
 */

interface Harness {
  readonly reactivate: ReactivateUser;
  readonly users: FakeUserRepository;
  readonly clock: FakeClock;
}

function harness(): Harness {
  const clock = new FakeClock();
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  users.seed({ user: staffUserFixture({ status: "Suspended" }), roles: ["AgentDesigner"] });

  return { reactivate: new ReactivateUser({ users, clock }), users, clock };
}

const INPUT = {
  staffUserId: "usr_01JBSARA",
  actorId: "usr_01JBADMIN",
  environment: "production",
  reason: "Rejoined the department",
};

describe("reactivating a user", () => {
  it("sets the status back to Active", async () => {
    const h = harness();
    await h.reactivate.execute(INPUT);
    const user = await h.users.findById("usr_01JBSARA");
    expect(user?.status).toBe("Active");
  });

  it("writes the audit entry as part of the status change", async () => {
    const h = harness();
    await h.reactivate.execute(INPUT);

    expect(h.users.statusChanges).toHaveLength(1);
    const change = h.users.statusChanges[0];
    expect(change?.status).toBe("Active");
    expect(change?.audit.action).toBe("user.reactivated");
    expect(change?.audit.actorId).toBe("usr_01JBADMIN");
    expect(change?.audit.detail).toEqual({
      previousStatus: "Suspended",
      reason: "Rejoined the department",
    });
  });

  it("omits the reason from the audit detail when none was given", async () => {
    const h = harness();
    await h.reactivate.execute({
      staffUserId: INPUT.staffUserId,
      actorId: INPUT.actorId,
      environment: INPUT.environment,
    });
    expect(h.users.statusChanges[0]?.audit.detail).toEqual({ previousStatus: "Suspended" });
  });

  it("is idempotent, and does not audit a second time, once already Active", async () => {
    const h = harness();
    await h.reactivate.execute(INPUT);
    const second = await h.reactivate.execute(INPUT);

    expect(second).toEqual({});
    expect(h.users.statusChanges).toHaveLength(1);
  });

  it("refuses to reactivate a user that does not exist", async () => {
    const h = harness();
    await expect(h.reactivate.execute({ ...INPUT, staffUserId: "usr_nobody" })).rejects.toThrow(
      /no such user/i,
    );
  });

  it("returns an empty result — no session count to report", async () => {
    const h = harness();
    const result = await h.reactivate.execute(INPUT);
    expect(result).toEqual({});
  });
});
