import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Appends to the transactional outbox (`domain_event`, LLD §2.4) built generically in
 * Phase 0 precisely so later phases don't retrofit it. This phase is the first real
 * writer: every FR-AI-05 fallback class (`BackendTimeout`/`GoalNotUnderstood`/
 * `ToolCallFailure`) and every `PolicyDenied` tool call emits one row here, giving
 * each failure a correlatable, audit-log-shaped event (`type` + `payload` + tenant +
 * timestamp) even before `audit` (Phase 17) exists to consume the outbox.
 *
 * `payload` never carries unmasked PII (security review, §7 of this dispatch): args
 * are passed through `maskArgsForLogging` before being written here.
 */
export interface DomainEventInput {
  type: string;
  payload: Record<string, unknown>;
}

export async function appendDomainEvent(ctx: TenantContext, input: DomainEventInput): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.domainEvent).values({
      id,
      tenantId: ctx.tenantId,
      type: input.type,
      payload: input.payload,
    });
  });
  return id;
}
