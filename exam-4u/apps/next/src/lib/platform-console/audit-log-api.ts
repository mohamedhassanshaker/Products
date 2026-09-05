import { platformFetch } from './http-client';

/** Local mirror of `AuditLogRow` (server: `@/server/platform/audit`). */
export interface AuditLogRow {
  id: string;
  actorType: 'PlatformAdmin' | 'TenantUser' | 'System';
  actorId: string | null;
  tenantId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogListResult {
  items: AuditLogRow[];
  total: number;
}

/** Filters for the Audit Log console page — every field optional, combined with AND server-side. */
export interface AuditLogFilters {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  page?: number;
  pageSize?: number;
}

/** `GET /api/platform/audit-log`. */
export function listAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogListResult> {
  const params = new URLSearchParams();
  if (filters.actorId) params.set('actorId', filters.actorId);
  if (filters.action) params.set('action', filters.action);
  if (filters.targetType) params.set('targetType', filters.targetType);
  if (filters.targetId) params.set('targetId', filters.targetId);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();
  return platformFetch<AuditLogListResult>(`/api/platform/audit-log${qs ? `?${qs}` : ''}`, { method: 'GET' });
}
