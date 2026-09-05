import { createMetaGraphClient, MetaGraphTransportError, type MetaMessageTemplate } from "@nextbot/channel-adapters";
import type { SyncTemplatesResult, WhatsAppTemplateDto } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { findMetaBusinessAccountByChannelId, updateMetaBusinessAccountStatus, upsertWhatsAppTemplate, listWhatsAppTemplates } from "../infrastructure/whatsapp-repository.js";
import { resolveSystemUserToken } from "./whatsapp-config-service.js";
import { MetaBusinessAccountNotFoundError } from "@nextbot/contracts";

/**
 * FR-META: "WhatsApp message templates are synced from Meta with status
 * (Approved/Pending/Rejected)." Real Graph API integration
 * (`GET /{waba-id}/message_templates`), proven end-to-end against a local mock
 * server in tests (no real Meta App exists in this sandbox — same disclosed
 * limitation as the Git/LLM provider integrations).
 */
export async function syncWhatsAppTemplates(ctx: TenantContext, channelId: string, opts: { graphApiBaseUrl?: string } = {}): Promise<SyncTemplatesResult> {
  const account = await findMetaBusinessAccountByChannelId(ctx, channelId);
  if (!account) throw new MetaBusinessAccountNotFoundError();
  if (!account.wabaId) throw new Error("Set a WABA ID before syncing templates.");

  const { accessToken } = await resolveSystemUserToken(ctx, channelId);
  const client = createMetaGraphClient({ accessToken, baseUrl: opts.graphApiBaseUrl ?? process.env.NEXTBOT_META_GRAPH_API_BASE_URL });

  let templates: MetaMessageTemplate[];
  try {
    templates = await client.listMessageTemplates(account.wabaId);
  } catch (err) {
    if (err instanceof MetaGraphTransportError) await updateMetaBusinessAccountStatus(ctx, account.id, "Unreachable");
    throw err;
  }
  await updateMetaBusinessAccountStatus(ctx, account.id, "Connected");

  for (const t of templates) {
    const bodyComponent = t.components.find((c) => c.type === "BODY");
    const body = bodyComponent?.text ?? "";
    await upsertWhatsAppTemplate(ctx, {
      channelId,
      externalTemplateId: t.id,
      name: t.name,
      language: t.language,
      category: t.category ?? null,
      status: mapTemplateStatus(t.status),
      body,
      variables: extractVariables(body),
    });
  }

  const rows = await listWhatsAppTemplates(ctx, channelId);
  return { synced: templates.length, templates: rows.map(toDto) };
}

export async function listWhatsAppTemplateDtos(ctx: TenantContext, channelId: string): Promise<WhatsAppTemplateDto[]> {
  const rows = await listWhatsAppTemplates(ctx, channelId);
  return rows.map(toDto);
}

function toDto(row: Awaited<ReturnType<typeof listWhatsAppTemplates>>[number]): WhatsAppTemplateDto {
  return {
    id: row.id,
    externalTemplateId: row.externalTemplateId,
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    body: row.body,
    variables: row.variables,
    syncedAt: row.syncedAt.toISOString(),
  };
}

function mapTemplateStatus(status: MetaMessageTemplate["status"]): WhatsAppTemplateDto["status"] {
  switch (status) {
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    default:
      return "Pending";
  }
}

/** Meta templates use `{{1}}`, `{{2}}`, ... positional placeholders in the body text. */
function extractVariables(body: string): string[] {
  const matches = body.match(/\{\{\d+\}\}/g) ?? [];
  return Array.from(new Set(matches));
}
