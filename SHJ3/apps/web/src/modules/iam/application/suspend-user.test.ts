import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import { STAFF_SESSION_TTL } from "../domain/session.js";
import {
  FakeClock,
  FakeUserRepository,
  InMemorySessionStore,
  staffUserFixture,
} from "../testing/fakes.js";
import { SignOut } from "./sign-out.js";
import { SuspendUser } from "./suspend-user.js";

/**
 * Suspension ends a session now.
 *
 * api.md §3.6 promises that B9's `Suspend` is not a flag checked at next login,
 * and that promise is the single strongest argument for ADR-0006 rule 2's choice
 * of opaque server-side sessions over JWTs. These tests are what make it a
 * property rather than an intention.
 *
 * Covers FR-IAM-06, ADR-0006 rule 2, api.md §3.6 and §12 invariant 3.
 */

const TENANT = "sewa" as TenantSlug;
const CLIENT = { userAgentFamily: "Mozilla", ipBlock: "10.20.30" };

interface Harness {
  readonly suspend: SuspendUser;
  readonly signOut: SignOut;
  readonly users: FakeUserRepository;
  readonly sessions: InMemorySessionStore;
  readonly clock: FakeClock;
}

function harness(): Harness {
  const clock = new FakeClock();
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  users.seed({ user: staffUserFixture(), roles: ["AgentDesigner"] });
  const sessions = new InMemorySessionStore();

  return {
    suspend: new SuspendUser({ users, sessions, clock }),
    signOut: new SignOut({ sessions }),
    users,
    sessions,
    clock,
  };
}

async function openSession(h: Harness, subjectId = "usr_01JBSARA"): Promise<string> {
  const session = await h.sessions.create(
    {
      kind: "staff",
      stage: "full",
      subjectId,
      tenant: TENANT,
      displayName: "Sara Al Mazrouei",
      assurance: "L0",
      epoch: 0,
      binding: CLIENT,
      ttl: STAFF_SESSION_TTL,
    },
    h.clock.now(),
  );
  return session.id;
}

const INPUT = {
  staffUserId: "usr_01JBSARA",
  actorId: "usr_01JBADMIN",
  environment: "production",
  reason: "Left the department",
};

describe("suspending a user", () => {
  it("destroys every live session, not just the current one", async () => {
    // A user signed in on a laptop and a phone must lose both.
    const h = harness();
    await openSession(h);
    await openSession(h);
    await openSession(h);

    const result = await h.suspend.execute(INPUT);
    expect(result.sessionsRevoked).toBe(3);
    expect(h.sessions.size()).toBe(0);
  });

  it("bumps the session epoch, which catches a request already in flight", async () => {
    // The record on another pod has already been read; the epoch is what fails
    // that request too.
    const h = harness();
    const result = await h.suspend.execute(INPUT);
    expect(result.sessionEpoch).toBe(1);
  });

  it("sets the status", async () => {
    const h = harness();
    await h.suspend.execute(INPUT);
    const user = await h.users.findById("usr_01JBSARA");
    expect(user?.status).toBe("Suspended");
  });

  it("writes the audit entry as part of the status change", async () => {
    // api.md §12 invariant 3: same transaction. Expressed as one port call, so
    // there is no method available that changes a status without auditing it.
    const h = harness();
    await h.suspend.execute(INPUT);

    expect(h.users.statusChanges).toHaveLength(1);
    const change = h.users.statusChanges[0];
    expect(change?.status).toBe("Suspended");
    expect(change?.audit.action).toBe("user.suspended");
    expect(change?.audit.actorId).toBe("usr_01JBADMIN");
    expect(change?.audit.detail).toEqual({
      previousStatus: "Active",
      reason: "Left the department",
    });
  });

  it("omits the reason from the audit detail when none was given", async () => {
    const h = harness();
    await h.suspend.execute({
      staffUserId: INPUT.staffUserId,
      actorId: INPUT.actorId,
      environment: INPUT.environment,
    });
    expect(h.users.statusChanges[0]?.audit.detail).toEqual({ previousStatus: "Active" });
  });

  it("leaves other users' sessions alone", async () => {
    const h = harness();
    h.users.seed({
      user: staffUserFixture({ id: "usr_other", email: "other@shj.ae" }),
      roles: ["Analyst"],
    });
    await openSession(h);
    const otherSession = await openSession(h, "usr_other");

    await h.suspend.execute(INPUT);
    expect(await h.sessions.read(otherSession)).not.toBeNull();
  });

  it("is idempotent, and does not audit a second time", async () => {
    // An audit log that records a suspension which changed nothing says
    // something happened when nothing did.
    const h = harness();
    await h.suspend.execute(INPUT);
    const second = await h.suspend.execute(INPUT);

    expect(second.sessionsRevoked).toBe(0);
    expect(h.users.statusChanges).toHaveLength(1);
  });

  it("refuses to suspend a user that does not exist", async () => {
    // Suspension is a status transition on an existing record, never a deletion.
    const h = harness();
    await expect(h.suspend.execute({ ...INPUT, staffUserId: "usr_nobody" })).rejects.toThrow(
      /no such user/i,
    );
  });

  it("does not restore sessions when the user is reactivated", async () => {
    // api.md §3.6: reactivation does not restore sessions; the user signs in
    // again.
    const h = harness();
    await openSession(h);
    await h.suspend.execute(INPUT);

    await h.users.changeStatus({
      staffUserId: "usr_01JBSARA",
      status: "Active",
      at: h.clock.now(),
      audit: { actorId: INPUT.actorId, action: "user.reactivated", environment: "production" },
    });

    expect(h.sessions.size()).toBe(0);
  });
});

describe("signing out", () => {
  it("destroys one session and leaves the others", async () => {
    const h = harness();
    const first = await openSession(h);
    const second = await openSession(h);

    await h.signOut.execute(first);
    expect(await h.sessions.read(first)).toBeNull();
    expect(await h.sessions.read(second)).not.toBeNull();
  });

  it("is silent about an id that never existed", async () => {
    // Reporting it would tell an unauthenticated caller whether a guessed id was
    // real.
    const h = harness();
    await expect(h.signOut.execute("session-999")).resolves.toBeUndefined();
  });

  it("signs out everywhere and reports how many went", async () => {
    const h = harness();
    await openSession(h);
    await openSession(h);
    expect(await h.signOut.everywhere("usr_01JBSARA")).toBe(2);
    expect(h.sessions.size()).toBe(0);
  });
});
