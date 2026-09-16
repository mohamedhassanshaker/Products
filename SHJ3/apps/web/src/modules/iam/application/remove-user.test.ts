import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import { STAFF_SESSION_TTL } from "../domain/session.js";
import { FakeUserRepository, InMemorySessionStore, staffUserFixture } from "../testing/fakes.js";
import { RemoveUser } from "./remove-user.js";

/**
 * B9 tab 1's **Remove**.
 *
 * Covers the same ground `suspend-user.test.ts` covers for suspension: a
 * tenant-scoped write followed by session destruction, in that order, and
 * the repository's own refusal when there is no membership to revoke.
 */

const TENANT = "sewa" as TenantSlug;
const CLIENT = { userAgentFamily: "Mozilla", ipBlock: "10.20.30" };

interface Harness {
  readonly remove: RemoveUser;
  readonly users: FakeUserRepository;
  readonly sessions: InMemorySessionStore;
}

function harness(): Harness {
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  users.seed({ user: staffUserFixture(), roles: ["AgentDesigner"] });
  const sessions = new InMemorySessionStore();
  return { remove: new RemoveUser({ users, sessions }), users, sessions };
}

const INPUT = {
  staffUserId: "usr_01JBSARA",
  tenant: TENANT,
  actorId: "usr_01JBADMIN",
  environment: "production",
  reason: "Left the department",
};

describe("removing a user from a tenant", () => {
  it("revokes the membership and destroys every live session", async () => {
    const h = harness();
    await h.sessions.create(
      {
        kind: "staff",
        stage: "full",
        subjectId: INPUT.staffUserId,
        tenant: TENANT,
        displayName: "Sara Al Mazrouei",
        assurance: "L0",
        epoch: 0,
        binding: CLIENT,
        ttl: STAFF_SESSION_TTL,
      },
      new Date("2026-09-08T09:00:00.000Z"),
    );

    const result = await h.remove.execute(INPUT);

    expect(result.sessionsRevoked).toBe(1);
    expect(h.sessions.size()).toBe(0);
    expect(await h.users.membershipsFor(INPUT.staffUserId)).not.toContain(TENANT);
  });

  it("propagates the repository's own error when there is no membership to revoke", async () => {
    const h = harness();
    await expect(h.remove.execute({ ...INPUT, tenant: "customs" as TenantSlug })).rejects.toThrow(
      /no active membership in tenant "customs"/,
    );
  });
});
