import type { TenantRecord } from './tenant';

/** Tenant persistence including create side-effects. */
export interface TenantRepositoryPort {
  create(input: { name: string; slug: string; status: 'active' | 'paused' }): Promise<TenantRecord>;
  findById(id: string): Promise<TenantRecord | null>;
  findBySlug(slug: string): Promise<TenantRecord | null>;
  count(): Promise<number>;
  list(input: {
    q?: string;
    status?: 'active' | 'paused';
    page: number;
    pageSize: number;
    tenantIds?: string[] | null;
  }): Promise<{ items: TenantRecord[]; total: number }>;
  updateName(id: string, name: string, ifMatch: Date): Promise<TenantRecord | 'conflict' | 'missing'>;
  updateStatus(id: string, status: 'active' | 'paused'): Promise<TenantRecord | null>;
}

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');
