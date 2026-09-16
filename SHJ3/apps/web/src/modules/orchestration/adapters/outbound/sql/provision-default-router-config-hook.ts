/**
 * Implements platform's `TenantProvisionedHook` port (ports/provisioning.ts) — the seam that
 * lets `ProvisionTenant` (which depends on nothing, architecture.md §3) trigger this
 * feature module's own default-`RouterConfigs` seeding without ever importing `orchestration`
 * directly. Exactly mirrors `channels`' own `ProvisionDefaultChannelsHook`. The composition
 * root (wherever `ProvisionTenant`'s real deps are built — `tests/isolation/setup.ts` today,
 * `scripts/backfill-default-router-config.ts` for the three tenants provisioned before this
 * fix existed) is what wires an instance of this class into `ProvisionTenant`'s
 * `postProvisionHooks`.
 *
 * Binds a fresh `TenantContext` for the target tenant itself (`runWithTenant`) rather than
 * assuming one is already ambient — `ProvisionTenant.execute()` runs with no tenant context
 * bound at all (it operates across tenants by explicit slug, via `getPlatformDb()`), so this
 * hook needs its own, exactly like `ProvisionDefaultChannelsHook`'s identical note.
 */
import { randomUUID } from "node:crypto";
import type { TenantProvisionedHook } from "../../../../platform/ports/provisioning.js";
import { runWithTenant } from "../../../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../../../platform/tenancy/tenant-slug.js";
import { ProvisionDefaultRouterConfigForTenant } from "../../../application/provision-default-router-config.js";
import { PrismaRouterConfigRepository } from "./prisma-router-config-repository.js";

export class ProvisionDefaultRouterConfigHook implements TenantProvisionedHook {
  readonly name = "orchestration.provision-default-router-config";

  async onTenantProvisioned(tenant: TenantSlug): Promise<void> {
    await runWithTenant(
      { tenant, principal: null, traceId: randomUUID().replace(/-/g, "") },
      async () => {
        const useCase = new ProvisionDefaultRouterConfigForTenant({
          routerConfig: new PrismaRouterConfigRepository(),
        });
        await useCase.execute({ now: new Date() });
      },
    );
  }
}
