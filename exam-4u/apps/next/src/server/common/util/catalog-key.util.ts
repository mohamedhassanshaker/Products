/**
 * Shared `key` shape validator for the platform catalog (`platform.feature`/`platform.package`) —
 * ported from legacy's two, independently-duplicated but byte-identical `class-validator` `@Matches`
 * patterns (`legacy/api/src/platform/features/api/dto/create-feature.dto.ts`'s
 * `FEATURE_KEY_PATTERN` and `legacy/api/src/platform/packages/api/dto/create-package.dto.ts`'s
 * `PACKAGE_KEY_PATTERN`). Consolidated into one shared util here since this app has no per-DTO
 * `class-validator` layer to duplicate the pattern into twice — both `FeaturesService` and
 * `PackagesService` import this single definition, matching this codebase's own established
 * precedent of validating a business-shape rule (not just type/length) inside the service layer via
 * a shared `common/util` helper (see `tenant-slug.util.ts`'s `isValidSubdomainSlug`, used identically
 * by `TenantsService.create`).
 */
const CATALOG_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** Lowercase letters/digits, dot/hyphen/underscore-separated segments, never a leading/trailing/
 * doubled separator, 1-100 characters (matches `feature.key`/`package.key`'s `VARCHAR(100)` column
 * width) — e.g. `exams.create`, `pro`, `full-bank-assessment`. */
export function isValidCatalogKey(key: string): boolean {
  return key.length > 0 && key.length <= 100 && CATALOG_KEY_PATTERN.test(key);
}
