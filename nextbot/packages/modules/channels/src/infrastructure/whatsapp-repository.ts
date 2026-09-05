import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type {
  ConsentStateValue,
  MetaBusinessAccountStatusValue,
  WhatsAppMessagingTierValue,
  WhatsAppPhoneVerificationStatusValue,
  WhatsAppTemplateStatusValue,
  WhatsAppWebhookVerificationStatusValue,
} from "@nextbot/contracts";

export interface MetaBusinessAccountRow {
  id: string;
  tenantId: string;
  channelId: string;
  businessId: string;
  businessName: string;
  wabaId: string | null;
  status: MetaBusinessAccountStatusValue;
  systemUserTokenCredentialId: string | null;
  appId: string | null;
  appSecretCredentialId: string | null;
  webhookVerifyTokenCredentialId: string | null;
  sessionWindowWarningEnabled: boolean;
  /** QA D1 fix: Webhook tab's verification-status badge state. */
  webhookVerificationStatus: WhatsAppWebhookVerificationStatusValue;
  webhookVerifiedAt: Date | null;
  lastEventReceivedAt: Date | null;
  linkedAt: Date | null;
  lastCheckedAt: Date | null;
}

export async function findMetaBusinessAccountByChannelId(ctx: TenantContext, channelId: string): Promise<MetaBusinessAccountRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.metaBusinessAccount)
      .where(and(eq(schema.metaBusinessAccount.tenantId, ctx.tenantId), eq(schema.metaBusinessAccount.channelId, channelId)));
    return (rows[0] as MetaBusinessAccountRow | undefined) ?? null;
  });
}

/** Cross-tenant-scoped lookup used only by the inbound webhook route (resolves
 * which tenant/account a phone-number-id belongs to before any tenant context is
 * known) — reads via the platform-context-free per-tenant `withTenant` scan is
 * infeasible here since the caller doesn't yet know the tenant; the webhook route
 * instead looks the account up by `channelId` embedded in the webhook URL path
 * (routing only, not a security boundary — see the route's own doc comment), so
 * this function is unused in that path and kept for admin-UI reads. */
export async function findMetaBusinessAccountById(ctx: TenantContext, id: string): Promise<MetaBusinessAccountRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.metaBusinessAccount).where(and(eq(schema.metaBusinessAccount.tenantId, ctx.tenantId), eq(schema.metaBusinessAccount.id, id)));
    return (rows[0] as MetaBusinessAccountRow | undefined) ?? null;
  });
}

/**
 * Persists the row as `Connected` — safe to call unconditionally here because
 * QA D2's fix moved the real verification (a `GET /{business-id}` Meta Graph API
 * call) into `connectMetaBusinessAccount` (application layer), which never calls
 * this function unless that verification already succeeded. This function itself
 * performs no network call, so it must never be invoked as a bare "record the
 * connect attempt" step ahead of verification.
 */
export async function insertMetaBusinessAccount(
  ctx: TenantContext,
  input: {
    channelId: string;
    businessId: string;
    businessName: string;
    systemUserTokenCredentialId: string;
    appId: string;
    appSecretCredentialId: string;
    webhookVerifyTokenCredentialId: string;
  },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.metaBusinessAccount).values({
      id,
      tenantId: ctx.tenantId,
      channelId: input.channelId,
      businessId: input.businessId,
      businessName: input.businessName,
      status: "Connected",
      systemUserTokenCredentialId: input.systemUserTokenCredentialId,
      appId: input.appId,
      appSecretCredentialId: input.appSecretCredentialId,
      webhookVerifyTokenCredentialId: input.webhookVerifyTokenCredentialId,
      linkedAt: new Date(),
      lastCheckedAt: new Date(),
    });
  });
  return id;
}

export async function updateMetaBusinessAccountStatus(ctx: TenantContext, id: string, status: MetaBusinessAccountStatusValue): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.metaBusinessAccount)
      .set({ status, lastCheckedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.metaBusinessAccount.tenantId, ctx.tenantId), eq(schema.metaBusinessAccount.id, id)));
  });
}

/**
 * QA D1 fix: records the real outcome of a `hub.challenge` handshake (or an
 * admin-triggered "Re-verify Challenge") — `Verified` sets `webhookVerifiedAt` to
 * now, `Failed` leaves the last-known-good `webhookVerifiedAt` untouched (a past
 * success isn't erased by a later transient failure, only ever superseded by a
 * later success).
 */
export async function updateWebhookVerificationStatus(ctx: TenantContext, id: string, status: WhatsAppWebhookVerificationStatusValue): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.metaBusinessAccount)
      .set({
        webhookVerificationStatus: status,
        ...(status === "Verified" ? { webhookVerifiedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.metaBusinessAccount.tenantId, ctx.tenantId), eq(schema.metaBusinessAccount.id, id)));
  });
}

/** QA D1 fix: stamps `lastEventReceivedAt` — called once per real inbound webhook
 * POST delivery (any event kind), backing the Webhook tab's "last event received"
 * field. */
export async function updateLastEventReceivedAt(ctx: TenantContext, id: string, occurredAt: Date = new Date()): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.metaBusinessAccount)
      .set({ lastEventReceivedAt: occurredAt, updatedAt: new Date() })
      .where(and(eq(schema.metaBusinessAccount.tenantId, ctx.tenantId), eq(schema.metaBusinessAccount.id, id)));
  });
}

export async function updateWabaConfig(ctx: TenantContext, id: string, input: { wabaId?: string; sessionWindowWarningEnabled?: boolean }): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.metaBusinessAccount)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(schema.metaBusinessAccount.tenantId, ctx.tenantId), eq(schema.metaBusinessAccount.id, id)));
  });
}

export async function deleteMetaBusinessAccount(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.delete(schema.metaBusinessAccount).where(and(eq(schema.metaBusinessAccount.tenantId, ctx.tenantId), eq(schema.metaBusinessAccount.id, id)));
  });
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export interface WhatsAppNumberRow {
  id: string;
  tenantId: string;
  metaBusinessAccountId: string;
  phoneNumberId: string;
  e164: string;
  displayName: string | null;
  verificationStatus: WhatsAppPhoneVerificationStatusValue;
  messagingTier: WhatsAppMessagingTierValue;
  qualityRating: string | null;
}

export async function listWhatsAppNumbers(ctx: TenantContext, metaBusinessAccountId: string): Promise<WhatsAppNumberRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    return (await db
      .select()
      .from(schema.whatsappNumber)
      .where(and(eq(schema.whatsappNumber.tenantId, ctx.tenantId), eq(schema.whatsappNumber.metaBusinessAccountId, metaBusinessAccountId)))) as WhatsAppNumberRow[];
  });
}

export async function findWhatsAppNumberByPhoneNumberId(ctx: TenantContext, phoneNumberId: string): Promise<WhatsAppNumberRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.whatsappNumber).where(and(eq(schema.whatsappNumber.tenantId, ctx.tenantId), eq(schema.whatsappNumber.phoneNumberId, phoneNumberId)));
    return (rows[0] as WhatsAppNumberRow | undefined) ?? null;
  });
}

/** Upsert-by-`phoneNumberId` sync from Meta (mirrors the template-sync idempotency
 * pattern below) — re-syncing never creates duplicates. */
export async function upsertWhatsAppNumber(
  ctx: TenantContext,
  input: {
    metaBusinessAccountId: string;
    phoneNumberId: string;
    e164: string;
    displayName?: string | null;
    verificationStatus: WhatsAppPhoneVerificationStatusValue;
    messagingTier: WhatsAppMessagingTierValue;
    qualityRating?: string | null;
  },
): Promise<void> {
  const existing = await findWhatsAppNumberByPhoneNumberId(ctx, input.phoneNumberId);
  await withTenant(ctx, async (db: TenantScopedClient) => {
    if (existing) {
      await db
        .update(schema.whatsappNumber)
        .set({
          e164: input.e164,
          displayName: input.displayName ?? null,
          verificationStatus: input.verificationStatus,
          messagingTier: input.messagingTier,
          qualityRating: input.qualityRating ?? null,
        })
        .where(and(eq(schema.whatsappNumber.tenantId, ctx.tenantId), eq(schema.whatsappNumber.id, existing.id)));
      return;
    }
    await db.insert(schema.whatsappNumber).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      metaBusinessAccountId: input.metaBusinessAccountId,
      phoneNumberId: input.phoneNumberId,
      e164: input.e164,
      displayName: input.displayName ?? null,
      verificationStatus: input.verificationStatus,
      messagingTier: input.messagingTier,
      qualityRating: input.qualityRating ?? null,
    });
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface WhatsAppTemplateRow {
  id: string;
  tenantId: string;
  channelId: string;
  externalTemplateId: string | null;
  name: string;
  language: string;
  category: string | null;
  status: WhatsAppTemplateStatusValue;
  body: string;
  variables: string[];
  syncedAt: Date;
}

export async function listWhatsAppTemplates(ctx: TenantContext, channelId: string): Promise<WhatsAppTemplateRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    return (await db
      .select()
      .from(schema.whatsappTemplate)
      .where(and(eq(schema.whatsappTemplate.tenantId, ctx.tenantId), eq(schema.whatsappTemplate.channelId, channelId)))) as WhatsAppTemplateRow[];
  });
}

export async function findApprovedTemplateByName(ctx: TenantContext, channelId: string, name: string, language: string): Promise<WhatsAppTemplateRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.whatsappTemplate)
      .where(
        and(
          eq(schema.whatsappTemplate.tenantId, ctx.tenantId),
          eq(schema.whatsappTemplate.channelId, channelId),
          eq(schema.whatsappTemplate.name, name),
          eq(schema.whatsappTemplate.language, language),
          eq(schema.whatsappTemplate.status, "Approved"),
        ),
      );
    return (rows[0] as WhatsAppTemplateRow | undefined) ?? null;
  });
}

/** Upsert-by-`(channelId, name, language)` — re-running "Sync from Meta" never
 * duplicates a template row, it refreshes `status`/`body`/`variables`/`syncedAt` in
 * place (Meta's approval status can change between syncs). */
export async function upsertWhatsAppTemplate(
  ctx: TenantContext,
  input: {
    channelId: string;
    externalTemplateId: string | null;
    name: string;
    language: string;
    category: string | null;
    status: WhatsAppTemplateStatusValue;
    body: string;
    variables: string[];
  },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select({ id: schema.whatsappTemplate.id })
      .from(schema.whatsappTemplate)
      .where(
        and(
          eq(schema.whatsappTemplate.tenantId, ctx.tenantId),
          eq(schema.whatsappTemplate.channelId, input.channelId),
          eq(schema.whatsappTemplate.name, input.name),
          eq(schema.whatsappTemplate.language, input.language),
        ),
      );
    if (existing[0]) {
      await db
        .update(schema.whatsappTemplate)
        .set({
          externalTemplateId: input.externalTemplateId,
          category: input.category,
          status: input.status,
          body: input.body,
          variables: input.variables,
          syncedAt: new Date(),
        })
        .where(and(eq(schema.whatsappTemplate.tenantId, ctx.tenantId), eq(schema.whatsappTemplate.id, existing[0].id)));
      return;
    }
    await db.insert(schema.whatsappTemplate).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      channelId: input.channelId,
      externalTemplateId: input.externalTemplateId,
      name: input.name,
      language: input.language,
      category: input.category,
      status: input.status,
      body: input.body,
      variables: input.variables,
    });
  });
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export interface ConsentRecordRow {
  id: string;
  tenantId: string;
  channelId: string;
  customerIdentifier: string;
  channelType: string;
  state: ConsentStateValue;
  source: string;
  recordedAt: Date;
}

export async function listConsentRecords(ctx: TenantContext, channelId: string): Promise<ConsentRecordRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    return (await db
      .select()
      .from(schema.consentRecord)
      .where(and(eq(schema.consentRecord.tenantId, ctx.tenantId), eq(schema.consentRecord.channelId, channelId)))) as ConsentRecordRow[];
  });
}

export async function findConsentRecord(ctx: TenantContext, channelId: string, customerIdentifier: string): Promise<ConsentRecordRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.consentRecord)
      .where(
        and(
          eq(schema.consentRecord.tenantId, ctx.tenantId),
          eq(schema.consentRecord.channelId, channelId),
          eq(schema.consentRecord.customerIdentifier, customerIdentifier),
        ),
      );
    return (rows[0] as ConsentRecordRow | undefined) ?? null;
  });
}

/** Upsert-by-`(channelId, customerIdentifier)` — recording consent twice for the
 * same customer updates the state/source rather than creating a duplicate row
 * (FR-META's consent log is the current-state record, not an append-only event
 * stream — history is deliberately out of this dispatch's scope). */
export async function upsertConsentRecord(
  ctx: TenantContext,
  input: { channelId: string; customerIdentifier: string; state: ConsentStateValue; source: string },
): Promise<void> {
  const existing = await findConsentRecord(ctx, input.channelId, input.customerIdentifier);
  await withTenant(ctx, async (db: TenantScopedClient) => {
    if (existing) {
      await db
        .update(schema.consentRecord)
        .set({ state: input.state, source: input.source, recordedAt: new Date() })
        .where(and(eq(schema.consentRecord.tenantId, ctx.tenantId), eq(schema.consentRecord.id, existing.id)));
      return;
    }
    await db.insert(schema.consentRecord).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      channelId: input.channelId,
      customerIdentifier: input.customerIdentifier,
      state: input.state,
      source: input.source,
    });
  });
}

export async function insertConsentImportLog(
  ctx: TenantContext,
  input: { channelId: string; filename: string | null; totalRows: number; succeededRows: number; failedRows: number; errors: { row: number; reason: string }[]; importedByUserId: string | null },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.consentImportLog).values({
      id,
      tenantId: ctx.tenantId,
      channelId: input.channelId,
      filename: input.filename,
      totalRows: input.totalRows,
      succeededRows: input.succeededRows,
      failedRows: input.failedRows,
      errors: input.errors,
      importedByUserId: input.importedByUserId,
    });
  });
  return id;
}
