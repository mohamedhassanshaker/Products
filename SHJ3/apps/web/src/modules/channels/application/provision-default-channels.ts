import { CHANNEL_DISPLAY_NAMES, CHANNEL_KEYS } from "../domain/vocabulary.js";
import type { ChannelRepository } from "../ports/channel-repository.js";
import type { WidgetConfigRepository } from "../ports/widget-config-repository.js";

export interface ProvisionDefaultChannelsInput {
  readonly now: Date;
}

export interface ProvisionDefaultChannelsResult {
  /** Channel keys actually created this call — empty for an already-fully-provisioned
   *  tenant. */
  readonly createdKeys: readonly string[];
  /** Whether `WebWidget`'s default `WidgetConfig` was created this call — see this class's
   *  own doc comment for why `WhatsApp` has no equivalent. */
  readonly widgetConfigCreated: boolean;
}

/**
 * Creates whichever of B10 tab 1's fixed four channels (`CHANNEL_KEYS` — a closed enum, not
 * a user-created catalogue; `channels-tab.tsx` has no "add channel" action anywhere) a tenant
 * is still missing, each starting `Disabled` with no bound agent — exactly the shape
 * `seed-channels-demo-data.ts` hand-seeds for the `sewa` demo tenant, now real, first-class
 * tenant-provisioning logic every tenant gets. Also provisions `WebWidget`'s default
 * `WidgetConfig` (B10 tab 2), for the reason explained below.
 *
 * ## The bug this closes
 *
 * `ProvisionTenant` (platform/application) never created a `Channel` row for any tenant —
 * the only place `Channel` rows were ever created was the `sewa`-only demo seed script.
 * `sharjah`/`customs`/`libraries` were provisioned with zero channels and, per the wireframe
 * (no add-channel UI), no way to ever get one.
 *
 * That alone is not the whole bug, confirmed live against this app's own `/channels` route
 * (`channels-screen.tsx`): the Web widget studio tab only ever renders an edit form when a
 * `WidgetConfig` row already exists for the channel, and `WidgetConfigRepository.update()` is
 * a strict update, never an upsert — so a `WebWidget` channel with a `Channel` row but no
 * `WidgetConfig` row *still* shows "not provisioned" with no way to fix it, the exact
 * symptom the product owner hit. `WidgetConfig` has no external dependency (its fields are
 * all in-app style/text with sensible, tenant-neutral defaults), so it is safe — and
 * necessary — to default it too. `WhatsAppConfig` is deliberately NOT defaulted the same way:
 * its fields (a real phone number, a real BSP/WABA account) cannot be fabricated, so the
 * WhatsApp tab correctly remains "not provisioned" until an operator supplies real
 * credentials through a distinct onboarding path — that is honest, not a bug, and out of this
 * fix's scope.
 *
 * ## Why this lives in `channels`, not `platform`
 *
 * `platform` depends on nothing (architecture.md §3) — `ProvisionTenant` cannot import this
 * use case directly. `ProvisionDefaultChannelsHook` (adapters/outbound/sql/) implements
 * platform's own `TenantProvisionedHook` port and calls this; the composition root is what
 * wires the concrete hook into `ProvisionTenant`'s deps, so `platform` never learns
 * `channels` exists.
 *
 * ## Idempotent per field, not per call
 *
 * Safe to re-run against an already-provisioned tenant — the backfill script for the three
 * already-active tenants missing this (`sharjah`, `customs`, `libraries`) needs exactly this
 * property, and re-running it against `sewa` (already fully seeded) is a correct no-op. Also
 * safe to re-run against a tenant this fix's own first backfill pass already gave `Channel`
 * rows to but not yet a `WidgetConfig` — the two are checked independently, not "both or
 * neither".
 */
export class ProvisionDefaultChannelsForTenant {
  constructor(
    private readonly deps: {
      readonly channels: ChannelRepository;
      readonly widgetConfig: WidgetConfigRepository;
    },
  ) {}

  async execute(input: ProvisionDefaultChannelsInput): Promise<ProvisionDefaultChannelsResult> {
    const existing = await this.deps.channels.list();
    const existingByKey = new Map(existing.map((row) => [row.key, row]));

    const createdKeys: string[] = [];
    let webWidgetChannelId = existingByKey.get("WebWidget")?.id ?? null;

    for (const key of CHANNEL_KEYS) {
      if (existingByKey.has(key)) continue;
      const created = await this.deps.channels.createDefault({
        key,
        displayName: CHANNEL_DISPLAY_NAMES[key],
        now: input.now,
      });
      createdKeys.push(key);
      if (key === "WebWidget") webWidgetChannelId = created.id;
    }

    let widgetConfigCreated = false;
    if (webWidgetChannelId) {
      const existingConfig = await this.deps.widgetConfig.findByChannelId(webWidgetChannelId);
      if (!existingConfig) {
        await this.deps.widgetConfig.createDefault({
          channelId: webWidgetChannelId,
          now: input.now,
        });
        widgetConfigCreated = true;
      }
    }

    return { createdKeys, widgetConfigCreated };
  }
}
