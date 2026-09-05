import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The transactional outbox (LLD §2.4). Writers append a row here **in the same
 * transaction** as the state change they describe; `audit`, `reporting`, notification
 * and alerting consumers all read from this table rather than being called directly
 * by the writer. Built generically here in Phase 0 (rather than deferred to the audit
 * module in Phase 17) precisely so no later phase has to retrofit outbox writes onto
 * mutations that already shipped without them — every module from Phase 1 onward
 * appends to this table as part of its own transactions.
 *
 * `payload` holds one member of the `DomainEvent` union (packages/contracts/src/events.ts);
 * this package does not import `contracts` to avoid a cycle, so the column is typed as
 * `jsonb` here and narrowed by consumers using the contracts package's TypeBox schema.
 *
 * NOTE (Phase 0 scoping decision, local & reversible): LLD §3.2 rule 5 lists
 * `domain_event` among the tables that should eventually be monthly-partitioned for
 * volume; at Phase 0/1 data volumes that is not yet load-bearing, so this table starts
 * as a plain table and partitioning is added, without an application-code change, once
 * a phase that produces meaningful event volume (Phase 12+) is reached.
 */
export const domainEvent = pgTable(
  "domain_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("domain_event_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("domain_event_unprocessed_idx").on(t.tenantId, t.processed),
  ],
);
