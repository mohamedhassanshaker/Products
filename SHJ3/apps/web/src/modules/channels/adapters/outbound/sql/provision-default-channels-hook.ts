/**
 * Implements platform's `TenantProvisionedHook` port (ports/provisioning.ts) — the seam that
 * lets `ProvisionTenant` (which depends on nothing, architecture.md §3) trigger this
 * feature module's own default-channel seeding without ever importing `channels` directly.
 * The composition root (wherever `ProvisionTenant`'s real deps are built —
 * `tests/isolation/setup.ts` today, `scripts/backfill-default-channels.ts` for the three
 * tenants provisioned before this fix existed) is what wires an instance of this class into
 * `ProvisionTenant`'s `postProvisionHooks`.
 *
 * Binds a fresh `TenantContext` for the target tenant itself (`runWithTenant`) rather than
 * assuming one is already ambient — `ProvisionTenant.execute()` runs with no tenant context
 * bound at all (it operates across tenants by explicit slug, via `getPlatformDb()`), so this
 * hook needs its own, exactly like `seed-channels-demo-data.ts`'s own CLI entry point does.
 */
import { randomUUID } from "node:crypto";
import type { TenantProvisionedHook } from "../../../../platform/ports/provisioning.js";
import { runWithTenant } from "../../../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../../../platform/tenancy/tenant-slug.js";
import { ProvisionDefaultChannelsForTenant } from "../../../application/provision-default-channels.js";
import { PrismaChannelRepository } from "./prisma-channel-repository.js";
import { PrismaWidgetConfigRepository } from "./prisma-widget-config-repository.js";

export class ProvisionDefaultChannelsHook implements TenantProvisionedHook {
  readonly name = "channels.provision-default-channels";

  async onTenantProvisioned(tenant: TenantSlug): Promise<void> {
    await runWithTenant(
      { tenant, principal: null, traceId: randomUUID().replace(/-/g, "") },
      async () => {
        const useCase = new ProvisionDefaultChannelsForTenant({
          channels: new PrismaChannelRepository(),
          widgetConfig: new PrismaWidgetConfigRepository(),
        });
        await useCase.execute({ now: new Date() });
      },
    );
  }
}
