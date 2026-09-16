/**
 * Composition helpers for the `/channels` route's Server Component page and Server Actions —
 * identical precedent to `tools/composition.ts`: thin, stateless wrappers over the already-
 * cached `getTenantDb()`/`getTenantCache()` clients, constructed fresh per call.
 *
 * This is the composition root for B10 — the one place in this route allowed to name
 * concrete adapters.
 */
import { getTenantDb } from "../../../../modules/platform/adapters/outbound/sql/tenant-db.js";
import { PrismaCampaignRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-campaign-repository.js";
import { PrismaChannelRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-channel-repository.js";
import { PrismaConsentRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-consent-repository.js";
import { PrismaHandoverConfigRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-handover-config-repository.js";
import { PrismaLocaleRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-locale-repository.js";
import { PrismaMessageTemplateRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-message-template-repository.js";
import { PrismaQuietHoursRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-quiet-hours-repository.js";
import { PrismaWhatsAppConfigRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-whatsapp-config-repository.js";
import { PrismaWidgetConfigRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-widget-config-repository.js";
import { PrismaWorkingHoursRepository } from "../../../../modules/channels/adapters/outbound/sql/prisma-working-hours-repository.js";

export function channelRepository(): PrismaChannelRepository {
  return new PrismaChannelRepository();
}
export function workingHoursRepository(): PrismaWorkingHoursRepository {
  return new PrismaWorkingHoursRepository();
}
export function handoverConfigRepository(): PrismaHandoverConfigRepository {
  return new PrismaHandoverConfigRepository();
}
export function widgetConfigRepository(): PrismaWidgetConfigRepository {
  return new PrismaWidgetConfigRepository();
}
export function whatsAppConfigRepository(): PrismaWhatsAppConfigRepository {
  return new PrismaWhatsAppConfigRepository();
}
export function messageTemplateRepository(): PrismaMessageTemplateRepository {
  return new PrismaMessageTemplateRepository();
}
export function campaignRepository(): PrismaCampaignRepository {
  return new PrismaCampaignRepository();
}
export function quietHoursRepository(): PrismaQuietHoursRepository {
  return new PrismaQuietHoursRepository();
}
export function localeRepository(): PrismaLocaleRepository {
  return new PrismaLocaleRepository();
}
export function consentRepository(): PrismaConsentRepository {
  return new PrismaConsentRepository();
}

export function now(): Date {
  return new Date();
}

/** Bindable-agent options for the tab 1 "bound agent" selector — a direct, narrow read of
 *  `Agent`, not a full port: this route only ever needs `{id, name}` for a dropdown, and
 *  `modules/agents` is a parallel wave's own files (out of this module's scope to extend). */
export interface AgentOption {
  readonly id: string;
  readonly name: string;
}

export async function listBindableAgents(): Promise<readonly AgentOption[]> {
  const db = getTenantDb("channels bindable-agent options");
  const rows = await db.agent.findMany({
    where: { status: "Published", deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows;
}
