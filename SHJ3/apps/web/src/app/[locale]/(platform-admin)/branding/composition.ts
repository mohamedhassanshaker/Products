/**
 * Composition helpers for the `/branding` route (Part D + E of the platform-admin
 * wave) — real adapters, constructed fresh per call, matching `(backoffice)/iam/
 * composition.ts`'s own precedent.
 */

import { loadConfig } from "../../../../modules/platform/config.js";
import { PrismaTenantRegistry } from "../../../../modules/platform/adapters/outbound/sql/tenant-registry.js";
import { PlatformAuditSink } from "../../../../modules/platform/adapters/outbound/sql/audit-sink.js";
import { RequirePlatformOperator } from "../../../../modules/platform/application/require-platform-operator.js";
import { PrismaTenantProfileReader } from "../../../../modules/platform/adapters/outbound/sql/prisma-tenant-profile-reader.js";
import { ManageAppearance } from "../../../../modules/theming/application/manage-appearance.js";
import { PrismaThemeRepository } from "../../../../modules/theming/adapters/outbound/sql/prisma-theme-repository.js";
import { UploadBrandAsset } from "../../../../modules/theming/application/upload-brand-asset.js";
import { LocalBrandAssetStorage } from "../../../../modules/theming/adapters/outbound/fs/local-brand-asset-storage.js";

export function tenantRegistry(): PrismaTenantRegistry {
  return new PrismaTenantRegistry();
}

export function auditSink(): PlatformAuditSink {
  return new PlatformAuditSink();
}

/** `SHJ3_ENVIRONMENT`, validated at boot (`config.ts`) — every audit entry this route writes names it. */
export function environment(): string {
  return loadConfig().environment;
}

/** The compound platform-operator gate, real `TenantProfileReader` adapter. */
export function platformOperatorGate(): RequirePlatformOperator {
  return new RequirePlatformOperator({ tenantProfile: new PrismaTenantProfileReader() });
}

/** Reads/writes the AMBIENT tenant's `ThemeRepository` data — callers rebind first for a cross-tenant target. */
export function manageAppearance(): ManageAppearance {
  return new ManageAppearance(new PrismaThemeRepository());
}

export function themeRepository(): PrismaThemeRepository {
  return new PrismaThemeRepository();
}

export function uploadBrandAsset(): UploadBrandAsset {
  return new UploadBrandAsset(new PrismaThemeRepository(), new LocalBrandAssetStorage());
}
