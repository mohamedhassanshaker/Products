import { eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { GitConnectionStatusValue, GitProviderValue } from "@nextbot/contracts";

export interface GitConnectionRow {
  tenantId: string;
  provider: GitProviderValue;
  baseUrl: string | null;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  credentialId: string;
  webhookSecretCredentialId: string | null;
  status: GitConnectionStatusValue;
  lastCheckedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function upsertGitConnection(
  ctx: TenantContext,
  input: {
    provider: GitProviderValue;
    baseUrl?: string;
    repoOwner: string;
    repoName: string;
    defaultBranch?: string;
    credentialId: string;
    webhookSecretCredentialId?: string;
    createdByUserId: string;
  },
): Promise<GitConnectionRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db.select().from(schema.gitConnection).where(eq(schema.gitConnection.tenantId, ctx.tenantId));
    if (existing.length > 0) {
      await db
        .update(schema.gitConnection)
        .set({
          provider: input.provider,
          baseUrl: input.baseUrl,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          defaultBranch: input.defaultBranch ?? "main",
          credentialId: input.credentialId,
          webhookSecretCredentialId: input.webhookSecretCredentialId,
          status: "Connected",
          updatedAt: new Date(),
        })
        .where(eq(schema.gitConnection.tenantId, ctx.tenantId));
    } else {
      await db.insert(schema.gitConnection).values({
        tenantId: ctx.tenantId,
        provider: input.provider,
        baseUrl: input.baseUrl,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        defaultBranch: input.defaultBranch ?? "main",
        credentialId: input.credentialId,
        webhookSecretCredentialId: input.webhookSecretCredentialId,
        status: "Connected",
        createdByUserId: input.createdByUserId,
      });
    }
    const [row] = await db.select().from(schema.gitConnection).where(eq(schema.gitConnection.tenantId, ctx.tenantId));
    if (!row) throw new Error("upsertGitConnection: no row after upsert");
    return row;
  });
}

export async function getGitConnection(ctx: TenantContext): Promise<GitConnectionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.gitConnection).where(eq(schema.gitConnection.tenantId, ctx.tenantId));
    return rows[0] ?? null;
  });
}

export async function setGitConnectionStatus(ctx: TenantContext, status: GitConnectionStatusValue): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.gitConnection).set({ status, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(schema.gitConnection.tenantId, ctx.tenantId)),
  );
}

export async function deleteGitConnection(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) => db.delete(schema.gitConnection).where(eq(schema.gitConnection.tenantId, ctx.tenantId)));
}

/** id generator re-exported for callers that need to mint an id before insert
 * (kept local to avoid every application-layer file importing `@nextbot/db` merely
 * for this one helper). */
export { generateId };
