import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import { FakeClock, FakeUserRepository, staffUserFixture } from "../testing/fakes.js";
import { InviteUser } from "./invite-user.js";

/**
 * B9 tab 1's **+ Invite user**.
 *
 * The one behaviour worth a test beyond "it calls the port": ADR-0006 rule 3's
 * "one email is one account across the whole backoffice", which
 * `UserRepository.create` implements and this use case must not bypass or
 * duplicate.
 */

const TENANT = "sewa" as TenantSlug;
const OTHER_TENANT = "customs" as TenantSlug;

interface Harness {
  readonly invite: InviteUser;
  readonly users: FakeUserRepository;
  readonly clock: FakeClock;
}

function harness(): Harness {
  const clock = new FakeClock();
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  return { invite: new InviteUser({ users, clock }), users, clock };
}

describe("inviting a user", () => {
  it("creates a brand-new account as Invited", async () => {
    const h = harness();
    const { user } = await h.invite.execute({
      email: "new.hire@shj.ae",
      displayName: "New Hire",
      tenant: TENANT,
      invitedByStaffUserId: "usr_01JBADMIN",
      environment: "production",
    });

    expect(user.status).toBe("Invited");
    expect(user.homeTenant).toBe(TENANT);
  });

  it("reuses the existing account when the email already belongs to a live staff user", async () => {
    // ADR-0006 rule 3: one email is one account across the whole backoffice.
    const h = harness();
    const existing = staffUserFixture();
    h.users.seed({ user: existing, roles: ["AgentDesigner"] });

    const { user } = await h.invite.execute({
      email: existing.email,
      displayName: "Sara Al Mazrouei (Customs)",
      tenant: OTHER_TENANT,
      invitedByStaffUserId: "usr_01JBADMIN",
      environment: "production",
    });

    expect(user.id).toBe(existing.id);
    expect(await h.users.membershipsFor(existing.id)).toContain(OTHER_TENANT);
  });
});
