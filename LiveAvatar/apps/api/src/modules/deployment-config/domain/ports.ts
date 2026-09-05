import type { PartialAgentConfig } from './agent-config';

/** Denormalized provider columns kept alongside the YAML (LLD §4.1). */
export interface DeploymentConfigProviders {
  transport: string | null;
  stt: string | null;
  llm: string | null;
  llmFallback: string | null;
  tts: string | null;
  avatar: string | null;
}

/** Deployment config aggregate as the application layer sees it. */
export interface DeploymentConfigRecord {
  id: string;
  tenantId: string;
  yamlText: string;
  status: 'draft' | 'published';
  providers: DeploymentConfigProviders;
  updatedAt: Date;
  updatedBy: string | null;
  publishedAt: Date | null;
  /** Structured form parsed back out of `yamlText`, for the live preview / prefill. */
  structured: PartialAgentConfig;
  /**
   * Phase 9 (BL-035) — set by `rollback-config-version.use-case.ts` when
   * this draft was created from an old `ConfigVersion`'s `yamlText`.
   * Consumed (read + cleared) by the repository the next time this row is
   * saved with `status: 'published'`, becoming that new version's
   * `rolledBackFrom` — this is what makes "rollback never silently
   * republishes" true while still correctly attributing the eventual
   * publish's origin (`ARCHITECTURE_NOTES.md` §2).
   */
  pendingRollbackFromVersionId: string | null;
}

/** Deployment config persistence (FR-CONFIG-3). One row per tenant (Phase 1 creates it empty). */
export interface DeploymentConfigRepositoryPort {
  findByTenantId(tenantId: string): Promise<DeploymentConfigRecord | null>;
  save(
    tenantId: string,
    input: {
      yamlText: string;
      status: 'draft' | 'published';
      providers: DeploymentConfigProviders;
      updatedBy: string | null;
      /** `undefined` leaves the stored value unchanged; only `published` saves set it. */
      publishedAt?: Date;
      /**
       * Phase 9 (BL-035, `ARCHITECTURE_NOTES.md` §2) — when present, the
       * repository inserts one `ConfigVersion` row (`versionNumber =
       * max+1`) in the same transaction as this `DeploymentConfig` update.
       * Only ever set for `status: 'published'` saves.
       */
      createVersion?: { publishedAt: Date; createdBy: string | null };
      /**
       * `undefined` leaves the stored value unchanged. A string sets it
       * (rollback-created draft); `null` explicitly clears it. When
       * `createVersion` is set (a publish), the repository always reads
       * the pre-update value into the new version's `rolledBackFrom` and
       * clears the column as part of the same update, regardless of what
       * this field is set to on that same call.
       */
      pendingRollbackFromVersionId?: string | null;
    },
    ifMatch: Date,
  ): Promise<DeploymentConfigRecord | 'conflict' | 'missing'>;
}

export const DEPLOYMENT_CONFIG_REPOSITORY = Symbol('DEPLOYMENT_CONFIG_REPOSITORY');

/** One `ConfigVersion` row (`ARCHITECTURE_NOTES.md` §2) — append-only, written on publish only. */
export interface ConfigVersionRecord {
  id: string;
  tenantId: string;
  versionNumber: number;
  yamlText: string;
  status: 'published' | 'superseded' | 'rolled_back';
  publishedAt: Date;
  createdBy: string | null;
  createdAt: Date;
  rolledBackFrom: string | null;
}

/**
 * `ConfigVersion` read/rollback-support persistence (Phase 9, BL-035). The
 * append-only *write* path (insert-on-publish) lives on
 * `DeploymentConfigRepositoryPort.save`'s `createVersion` option instead of
 * here, so it can share the `DeploymentConfig` update's transaction — this
 * port is for the three read/rollback use-cases
 * (list/diff/rollback-config-version).
 */
export interface ConfigVersionRepositoryPort {
  listByTenantId(tenantId: string): Promise<ConfigVersionRecord[]>;
  findByTenantAndVersion(tenantId: string, versionNumber: number): Promise<ConfigVersionRecord | null>;
  /** Marks `versionNumber` as the source of a rollback (`rolledBackFrom` on the *new* version is set by the caller's draft save, not here). */
  markRolledBack(tenantId: string, versionNumber: number): Promise<void>;
}

export const CONFIG_VERSION_REPOSITORY = Symbol('CONFIG_VERSION_REPOSITORY');
