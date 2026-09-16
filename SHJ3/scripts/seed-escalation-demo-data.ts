/**
 * Deterministic demo data for B-7 (Handover): the wireframe's own B8 routing-rule table
 * and canned replies, transcribed from `docs/SHJ3-wireframes-guide.md` verbatim for `sewa`
 * — plus, since the 2026-09-10 stakeholder review pass (Issue 2, `tasks/todo.md`), a
 * tenant-appropriate routing-rule/canned-reply/demo-ticket set for `customs`, `libraries`
 * and `sharjah` too, closing the exact "sewa-only seeded, others empty" gap
 * `tasks/lessons.md`'s "sewa-only seed script" lesson names this file under.
 *
 * **Why not a blind copy of `sewa`'s own rule set onto the other three tenants.** `sewa`'s
 * four rules exist because the wireframe's own sample state needs three real teams
 * (`SEWA Billing`/`Senior Agents`/`WhatsApp-Trained Agents`) to demonstrate ordered
 * precedence — none of that is real for `customs`/`libraries`/`sharjah`, which each have
 * exactly one real team from `seed-iam-demo-data.ts` (`Customs`/`Libraries`/`Platform`).
 * So each of those three gets its own smaller, honest two-rule set: route this tenant's
 * one real `topicKey` to its one real team, plus the same tenant-agnostic overflow rule
 * `sewa` also has (`WaitTime > 5` → requeue, alert the supervisor) — a genuine operational
 * safety net, not a domain-specific judgment call, so it generalises cleanly. Canned
 * replies are written per tenant's own real government-service domain (Customs
 * declarations, library memberships, Sharjah's own general wayfinding for the platform
 * tenant) rather than reusing `sewa`'s Billing-flavoured copy.
 *
 * **A real, seeded, `Queued` escalation ticket per non-`sewa` tenant** (two for `sharjah`,
 * one each for `customs`/`libraries`) — a real `Conversation` + real `ConversationTurns` +
 * a real, unrouted `EscalationTicket`, so `/escalations`' Queue tab has something a
 * reviewer can actually open, read a transcript for, and claim — not just an empty table
 * behind now-populated routing rules. `ListEscalationQueue`'s own lazy-routing (`list-
 * escalation-queue.ts`) assigns each ticket to its real team the first time the queue
 * loads, exactly as it would for a ticket a real citizen produced — nothing here
 * pre-computes `routedByRoutingRuleId`.
 *
 * Idempotent throughout: every section checks for its own already-seeded rows (a real
 * unique constraint, or — for demo tickets, which mint a fresh `Conversation` per run — a
 * fixed, distinctive `topic` string checked by `findFirst` before creating) before
 * writing, matching every other `scripts/seed-*.ts` file's own convention.
 */
import { randomUUID } from "node:crypto";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import type { TenantSlug } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { getTenantDb } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../apps/web/src/modules/platform/adapters/outbound/sql/ulid.js";

const SEWA_TEAM_NAME = "SEWA Billing";
const SENIOR_TEAM_NAME = "Senior Agents";
const WHATSAPP_TEAM_NAME = "WhatsApp-Trained Agents";

async function ensureTeam(name: string, now: Date): Promise<string> {
  const db = getTenantDb();
  const existing = await db.team.findFirst({ where: { name } });
  if (existing) return existing.id;
  const created = await db.team.create({
    data: {
      id: newUlid(now),
      name,
      scope: "Tenant",
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    },
  });
  return created.id;
}

interface CannedReplySeed {
  readonly name: string;
  readonly body: string;
  readonly topicKey: string | null;
}

const SEWA_CANNED_REPLIES: readonly CannedReplySeed[] = [
  {
    name: "Billing greeting",
    body: "Hi, I can help with your SEWA bill — could you confirm the account number ending you mentioned?",
    topicKey: "Billing",
  },
  {
    name: "Billing hold",
    body: "Thanks for confirming — give me a moment to pull up your account.",
    topicKey: "Billing",
  },
  {
    name: "Billing close",
    body: "That's resolved on our end now. Is there anything else I can help with?",
    topicKey: "Billing",
  },
];

const CUSTOMS_CANNED_REPLIES: readonly CannedReplySeed[] = [
  {
    name: "Customs greeting",
    body: "Hello, I can help with your customs declaration — could you share the declaration reference?",
    topicKey: "Customs",
  },
  {
    name: "Customs hold",
    body: "Checking that reference against the customs system now, one moment.",
    topicKey: "Customs",
  },
  {
    name: "Customs close",
    body: "Your declaration has been updated. Let me know if you need anything further.",
    topicKey: "Customs",
  },
];

const LIBRARY_CANNED_REPLIES: readonly CannedReplySeed[] = [
  {
    name: "Library greeting",
    body: "Hi, happy to help with your library membership — what's the issue you're seeing?",
    topicKey: "Library",
  },
  {
    name: "Library hold",
    body: "Let me check your membership record, one moment please.",
    topicKey: "Library",
  },
  {
    name: "Library close",
    body: "That's sorted — your membership is active again.",
    topicKey: "Library",
  },
];

const GENERAL_CANNED_REPLIES: readonly CannedReplySeed[] = [
  {
    name: "General greeting",
    body: "Hi, thanks for reaching out — could you tell me a little more about which Sharjah government service you need help with?",
    topicKey: "General",
  },
  {
    name: "General hold",
    body: "Let me find the right department for that, one moment please.",
    topicKey: "General",
  },
  {
    name: "General close",
    body: "I've passed the details on and the right team will follow up. Is there anything else I can help with?",
    topicKey: "General",
  },
];

interface RoutingRuleSeed {
  readonly attribute: "Topic" | "Priority" | "Channel" | "WaitTime";
  readonly operator: "Eq" | "Gt";
  readonly value: string;
  readonly targetKind: "Team" | "Requeue";
  readonly targetTeamName: string | null;
  readonly alertSupervisor: boolean;
}

interface DemoTicketTurnSeed {
  readonly role: "Citizen" | "Assistant" | "System" | "HumanAgent";
  readonly content: string;
}

interface DemoTicketSeed {
  /** Fixed, distinctive text — this script's own idempotency check for demo tickets, since
   *  each run would otherwise mint a fresh `Conversation`/`EscalationTicket` pair. */
  readonly topic: string;
  readonly topicKey: "Billing" | "Customs" | "Library" | "General";
  readonly reason: "ToolFailure" | "UserRequest" | "LowConfidence";
  readonly priority: "Normal" | "High";
  readonly reasonDetail: string;
  readonly turns: readonly DemoTicketTurnSeed[];
}

/** One real `Conversation` + its real `ConversationTurns` + one real, unrouted, `Queued`
 *  `EscalationTicket` — the same shape `RequestHandover` (`conversation/application/
 *  request-handover.ts`) produces for a real citizen, minted directly here since this is a
 *  seed script, not a live handover request. */
async function ensureDemoTicket(seed: DemoTicketSeed, now: Date): Promise<boolean> {
  const db = getTenantDb();
  const existing = await db.escalationTicket.findFirst({ where: { topic: seed.topic } });
  if (existing) return false;

  const conversationId = newUlid(now);
  await db.conversation.create({
    data: {
      id: conversationId,
      channelKey: "WebWidget",
      localeCode: "en",
      // Matches `markEscalated`'s own real invariant (`modules/conversation/domain/
      // containment.ts`) from the very first write — a demo ticket must never disagree
      // with `outcome`/`wasContained`'s real coherence rule (`CK_` backed at the
      // `ConversationMetricsDaily` rollup level, `tasks/lessons.md`'s own B-9 finding).
      outcome: "Escalated",
      wasContained: false,
      turnCount: seed.turns.length,
      startedAt: now,
      lastTurnAt: now,
      piiMaskApplied: true,
      retentionExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      createdAt: now,
    },
  });

  const turnRows: { role: string; contentMasked: string; ordinal: number }[] = [];
  for (const [index, turn] of seed.turns.entries()) {
    const ordinal = index + 1;
    await db.conversationTurn.create({
      data: {
        id: newUlid(now),
        conversationId,
        ordinal,
        role: turn.role,
        contentMasked: turn.content,
        contentFormat: "Text",
        localeCode: "en",
        wasRefused: false,
        createdAt: now,
      },
    });
    turnRows.push({ role: turn.role, contentMasked: turn.content, ordinal });
  }

  const contextSnapshotJson = JSON.stringify({ turns: turnRows, pendingSlot: null });

  await db.escalationTicket.create({
    data: {
      id: newUlid(now),
      conversationId,
      topic: seed.topic,
      topicKey: seed.topicKey,
      channelKey: "WebWidget",
      priority: seed.priority,
      reason: seed.reason,
      reasonDetail: seed.reasonDetail,
      verificationState: "L0",
      pendingSlotName: null,
      contextSnapshotJson,
      status: "Queued",
      wasRequeued: false,
      queuedAt: now,
      createdAt: now,
    },
  });
  return true;
}

interface TenantEscalationSeed {
  readonly tenant: TenantSlug;
  readonly rules: readonly RoutingRuleSeed[];
  readonly cannedReplies: readonly CannedReplySeed[];
  readonly tickets: readonly DemoTicketSeed[];
}

async function seedTenant(config: TenantEscalationSeed, now: Date): Promise<void> {
  await runWithTenant(
    {
      tenant: config.tenant,
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "identity",
    },
    async () => {
      const db = getTenantDb();

      // `RoutingRules.createdByStaffUserId`/`CannedReplies.createdByStaffUserId` are both
      // `@db.Char(26)` — a real ULID, not a hand-typed shorter string, which SQL Server
      // would otherwise silently space-pad at rest (`tasks/lessons.md`'s own documented
      // gotcha, hit five times in this project already).
      const systemStaffUserId = newUlid(now);

      const teamIdByName: Record<string, string> = {};
      for (const rule of config.rules) {
        if (rule.targetTeamName && !(rule.targetTeamName in teamIdByName)) {
          teamIdByName[rule.targetTeamName] = await ensureTeam(rule.targetTeamName, now);
        }
      }

      // Per-rule existence check (not "does this tenant have ANY rule at all") — a real
      // tenant's `RoutingRules` table can already hold unrelated rows by the time this
      // runs (a staff-added self-service rule, an E2E fixture such as `escalations.spec
      // .ts`'s own reorder-rule regression test) that must never block this script's own
      // real rules from being seeded. Ordinals continue from the tenant's current
      // maximum rather than a hardcoded `index + 1`, so this never collides with — or
      // reorders — whatever already exists.
      const existingRules = await db.routingRule.findMany();
      let nextOrdinal = existingRules.reduce((max, r) => Math.max(max, r.ordinal), 0) + 1;
      let rulesCreated = 0;
      for (const rule of config.rules) {
        const targetTeamId = rule.targetTeamName ? teamIdByName[rule.targetTeamName] : null;
        const alreadyPresent = existingRules.some(
          (r) =>
            r.attribute === rule.attribute &&
            r.operator === rule.operator &&
            r.value === rule.value &&
            r.targetKind === rule.targetKind &&
            r.targetTeamId === targetTeamId,
        );
        if (alreadyPresent) continue;
        await db.routingRule.create({
          data: {
            id: newUlid(now),
            ordinal: nextOrdinal,
            attribute: rule.attribute,
            operator: rule.operator,
            value: rule.value,
            targetKind: rule.targetKind,
            targetTeamId,
            alertSupervisor: rule.alertSupervisor,
            isEnabled: true,
            createdByStaffUserId: systemStaffUserId,
            updatedByStaffUserId: systemStaffUserId,
            createdAt: now,
          },
        });
        nextOrdinal += 1;
        rulesCreated += 1;
      }
      console.info(
        `[seed-escalation-demo-data] "${config.tenant}": seeded ${String(rulesCreated)} new routing rule(s).`,
      );

      let cannedCreated = 0;
      for (const [index, reply] of config.cannedReplies.entries()) {
        const existing = await db.cannedReply.findFirst({
          where: { name: reply.name, localeCode: "en", deletedAt: null },
        });
        if (existing) continue;
        await db.cannedReply.create({
          data: {
            id: newUlid(now),
            name: reply.name,
            body: reply.body,
            teamId: null,
            topicKey: reply.topicKey,
            localeCode: "en",
            ordinal: index + 1,
            isEnabled: true,
            createdByStaffUserId: systemStaffUserId,
            createdAt: now,
          },
        });
        cannedCreated += 1;
      }
      console.info(
        `[seed-escalation-demo-data] "${config.tenant}": seeded ${String(cannedCreated)} new canned replies.`,
      );

      let ticketsCreated = 0;
      for (const ticket of config.tickets) {
        if (await ensureDemoTicket(ticket, now)) ticketsCreated += 1;
      }
      console.info(
        `[seed-escalation-demo-data] "${config.tenant}": seeded ${String(ticketsCreated)} new demo escalation ticket(s).`,
      );
    },
  );
}

// Overflow safety net — genuinely tenant-agnostic (an operational rule, not a domain
// judgment call), so it is the one rule reused verbatim across every tenant below.
const WAIT_TIME_OVERFLOW_RULE: RoutingRuleSeed = {
  attribute: "WaitTime",
  operator: "Gt",
  value: "5",
  targetKind: "Requeue",
  targetTeamName: null,
  alertSupervisor: true,
};

async function main(): Promise<void> {
  const now = new Date();

  const tenants: readonly TenantEscalationSeed[] = [
    {
      // Wireframe's own B8 table, verbatim — order 1..4 is the real, meaningful
      // precedence: "Because order determines the outcome, a Billing + High-priority
      // ticket routes to the SEWA billing team, not Senior agents."
      tenant: assertValidSlugShape("sewa"),
      rules: [
        {
          attribute: "Topic",
          operator: "Eq",
          value: "Billing",
          targetKind: "Team",
          targetTeamName: SEWA_TEAM_NAME,
          alertSupervisor: false,
        },
        {
          attribute: "Priority",
          operator: "Eq",
          value: "High",
          targetKind: "Team",
          targetTeamName: SENIOR_TEAM_NAME,
          alertSupervisor: false,
        },
        {
          attribute: "Channel",
          operator: "Eq",
          value: "WhatsApp",
          targetKind: "Team",
          targetTeamName: WHATSAPP_TEAM_NAME,
          alertSupervisor: false,
        },
        WAIT_TIME_OVERFLOW_RULE,
      ],
      cannedReplies: SEWA_CANNED_REPLIES,
      // `sewa`'s own live-proof scripts (B-7) already exercise real tickets against this
      // tenant — no seeded demo ticket needed on top of that.
      tickets: [],
    },
    {
      tenant: assertValidSlugShape("customs"),
      rules: [
        {
          attribute: "Topic",
          operator: "Eq",
          value: "Customs",
          targetKind: "Team",
          targetTeamName: "Customs",
          alertSupervisor: false,
        },
        WAIT_TIME_OVERFLOW_RULE,
      ],
      cannedReplies: CUSTOMS_CANNED_REPLIES,
      tickets: [
        {
          topic: "Customs enquiry — declaration held in review",
          topicKey: "Customs",
          reason: "UserRequest",
          priority: "Normal",
          reasonDetail: "Citizen asked to speak with a person about a delayed declaration.",
          turns: [
            {
              role: "Citizen",
              content:
                "My customs declaration has been sitting in review for 3 days, can someone look into it?",
            },
            {
              role: "Assistant",
              content:
                "I can help — could you share your declaration reference number so I can check its status?",
            },
            {
              role: "Citizen",
              content: "It's SC-2026-004471, but I'd rather speak to someone directly.",
            },
          ],
        },
      ],
    },
    {
      tenant: assertValidSlugShape("libraries"),
      rules: [
        {
          attribute: "Topic",
          operator: "Eq",
          value: "Library",
          targetKind: "Team",
          targetTeamName: "Libraries",
          alertSupervisor: false,
        },
        WAIT_TIME_OVERFLOW_RULE,
      ],
      cannedReplies: LIBRARY_CANNED_REPLIES,
      tickets: [
        {
          topic: "Library enquiry — membership renewal keeps failing",
          topicKey: "Library",
          reason: "ToolFailure",
          priority: "Normal",
          reasonDetail: "The membership-renewal tool failed twice for the same request.",
          turns: [
            {
              role: "Citizen",
              content: "I tried to renew my library membership online but it keeps failing.",
            },
            { role: "Assistant", content: "Let me look into that for you, one moment." },
            {
              role: "System",
              content:
                "Membership renewal tool call failed twice — escalating per guardrail policy.",
            },
          ],
        },
      ],
    },
    {
      // The platform-operator tenant — see `seed-iam-demo-data.ts`'s identical constant
      // for why `sharjah`, not `platform`, is the slug. Ahmed Saeed (Super Admin) is a
      // member of the tenant's one real team, "Platform" — the same team this rule
      // routes `General`-topic tickets to.
      tenant: assertValidSlugShape("sharjah"),
      rules: [
        {
          attribute: "Topic",
          operator: "Eq",
          value: "General",
          targetKind: "Team",
          targetTeamName: "Platform",
          alertSupervisor: false,
        },
        WAIT_TIME_OVERFLOW_RULE,
      ],
      cannedReplies: GENERAL_CANNED_REPLIES,
      tickets: [
        {
          topic: "General enquiry — trade licence renewal",
          topicKey: "General",
          reason: "UserRequest",
          priority: "Normal",
          reasonDetail: "Citizen asked to speak with a person about a trade licence renewal.",
          turns: [
            {
              role: "Citizen",
              content:
                "Hi, I need to renew my trade licence but the portal keeps asking for a document I don't have. Can someone help?",
            },
            {
              role: "Assistant",
              content:
                "I can help point you to the right service. Trade licence renewals are handled by the Department of Economic Development — would you like the renewal checklist, or to speak with a person?",
            },
            { role: "Citizen", content: "I'd like to speak with a person please." },
          ],
        },
        {
          topic: "General enquiry — unclear request needs a human",
          topicKey: "General",
          reason: "LowConfidence",
          priority: "Normal",
          reasonDetail: "Assistant had low grounding confidence on an underspecified request.",
          turns: [
            { role: "Citizen", content: "can you check on my thing from last week" },
            {
              role: "Assistant",
              content:
                "I'm not confident I understood which service or request you mean — could you share a reference number or a bit more detail?",
            },
            { role: "Citizen", content: "no I don't have a reference, just check for me" },
          ],
        },
      ],
    },
  ];

  for (const config of tenants) {
    await seedTenant(config, now);
  }

  console.info("[seed-escalation-demo-data] done.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed-escalation-demo-data] failed:", error);
    process.exit(1);
  });
