import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { ANONYMOUS_ASSURANCE } from "../domain/assurance.js";
import { CITIZEN_SESSION_TTL, type ClientBinding } from "../domain/session.js";
import { FakeClock, InMemorySessionStore } from "../testing/fakes.js";
import { ResolveCitizenSession } from "./resolve-citizen-session.js";

/**
 * The citizen-surface read path (B-6) — `resolve-session.test.ts`'s much
 * smaller sibling: no `Principal`, no roles, no `StaffUsers` epoch, just a
 * `SessionRecord` and the three ways it can stop being usable (absent,
 * expired, rebound to a different client).
 */

const TENANT = "sewa" as TenantSlug;
const CLIENT: ClientBinding = { userAgentFamily: "Mozilla", ipBlock: "10.20.30" };

interface Harness {
  readonly resolve: ResolveCitizenSession;
  readonly clock: FakeClock;
  readonly sessions: InMemorySessionStore;
}

function harness(): Harness {
  const clock = new FakeClock();
  const sessions = new InMemorySessionStore();
  return { resolve: new ResolveCitizenSession({ sessions, clock }), clock, sessions };
}

describe("ResolveCitizenSession", () => {
  it("resolves an active citizen session", async () => {
    const h = harness();
    const session = await h.sessions.create(
      {
        kind: "citizen",
        stage: "full",
        subjectId: "cs_1",
        tenant: TENANT,
        displayName: "",
        assurance: ANONYMOUS_ASSURANCE,
        epoch: 0,
        binding: CLIENT,
        ttl: CITIZEN_SESSION_TTL,
      },
      h.clock.now(),
    );

    const result = await h.resolve.execute({ sessionId: session.id, client: CLIENT });

    expect(result.kind).toBe("active");
    if (result.kind === "active") {
      expect(result.session.subjectId).toBe("cs_1");
      expect(result.session.tenant).toBe(TENANT);
    }
  });

  it("reports absent for an id that never existed", async () => {
    const h = harness();
    const result = await h.resolve.execute({ sessionId: "does-not-exist", client: CLIENT });
    expect(result.kind).toBe("absent");
  });

  it("reports absent (not a distinct 'wrong kind') for a staff session id presented here", async () => {
    // Indistinguishable from "never existed" on purpose — the same
    // not-found/expired conflation `SessionStore.read`'s own doc comment
    // requires, so a caller cannot fingerprint which failure mode a guessed
    // id hit.
    const h = harness();
    const staffSession = await h.sessions.create(
      {
        kind: "staff",
        stage: "full",
        subjectId: "usr_1",
        tenant: TENANT,
        displayName: "Someone",
        assurance: ANONYMOUS_ASSURANCE,
        epoch: 0,
        binding: CLIENT,
        ttl: CITIZEN_SESSION_TTL,
      },
      h.clock.now(),
    );

    const result = await h.resolve.execute({ sessionId: staffSession.id, client: CLIENT });
    expect(result.kind).toBe("absent");
  });

  it("reports expired once the idle window has passed", async () => {
    const h = harness();
    const session = await h.sessions.create(
      {
        kind: "citizen",
        stage: "full",
        subjectId: "cs_2",
        tenant: TENANT,
        displayName: "",
        assurance: ANONYMOUS_ASSURANCE,
        epoch: 0,
        binding: CLIENT,
        ttl: CITIZEN_SESSION_TTL,
      },
      h.clock.now(),
    );

    h.clock.advanceSeconds(CITIZEN_SESSION_TTL.idleSeconds + 1);

    const result = await h.resolve.execute({ sessionId: session.id, client: CLIENT });
    expect(result.kind).toBe("expired");
  });

  it("reports a binding mismatch for a cookie replayed from a different client", async () => {
    const h = harness();
    const session = await h.sessions.create(
      {
        kind: "citizen",
        stage: "full",
        subjectId: "cs_3",
        tenant: TENANT,
        displayName: "",
        assurance: ANONYMOUS_ASSURANCE,
        epoch: 0,
        binding: CLIENT,
        ttl: CITIZEN_SESSION_TTL,
      },
      h.clock.now(),
    );

    const result = await h.resolve.execute({
      sessionId: session.id,
      client: { userAgentFamily: "curl", ipBlock: "203.0.113" },
    });
    expect(result.kind).toBe("binding_mismatch");
  });

  it("slides the idle window on a successful resolution", async () => {
    const h = harness();
    const session = await h.sessions.create(
      {
        kind: "citizen",
        stage: "full",
        subjectId: "cs_4",
        tenant: TENANT,
        displayName: "",
        assurance: ANONYMOUS_ASSURANCE,
        epoch: 0,
        binding: CLIENT,
        ttl: CITIZEN_SESSION_TTL,
      },
      h.clock.now(),
    );

    // Just short of idle expiry — would report expired without a slide.
    h.clock.advanceSeconds(CITIZEN_SESSION_TTL.idleSeconds - 1);
    const first = await h.resolve.execute({ sessionId: session.id, client: CLIENT });
    expect(first.kind).toBe("active");

    // Advance the same distance again — only survives if the first read slid it.
    h.clock.advanceSeconds(CITIZEN_SESSION_TTL.idleSeconds - 1);
    const second = await h.resolve.execute({ sessionId: session.id, client: CLIENT });
    expect(second.kind).toBe("active");
  });
});
