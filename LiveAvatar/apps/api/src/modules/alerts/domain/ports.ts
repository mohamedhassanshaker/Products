/** `AlertPolicy` aggregate as the application layer sees it (FR-ALERT-1). */
export interface AlertPolicyRecord {
  tenantId: string;
  retryMaxAttempts: number;
  retryBackoffMs: number[];
  degradedModeMessage: string;
  updatedAt: Date;
}

/**
 * `AlertPolicy` persistence. One row per tenant (Phase 1 creates it with
 * spec defaults). `llm.fallback` *identity* is intentionally not part of this
 * port — it stays owned by `deployment-config`'s `SaveConfigUseCase`/Agent
 * Builder (see `UpdateAlertPolicyUseCase`'s docstring).
 */
export interface AlertPolicyRepositoryPort {
  findByTenantId(tenantId: string): Promise<AlertPolicyRecord | null>;
  update(
    tenantId: string,
    input: { retryMaxAttempts: number; retryBackoffMs: number[]; degradedModeMessage: string },
    ifMatch: Date,
  ): Promise<AlertPolicyRecord | 'conflict' | 'missing'>;
}

export const ALERT_POLICY_REPOSITORY = Symbol('ALERT_POLICY_REPOSITORY');
