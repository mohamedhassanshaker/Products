import type { InviteRecord } from './invite';

/** Invite persistence. */
export interface InviteRepositoryPort {
  create(input: {
    email: string;
    roles: string[];
    tokenHash: string;
    expiresAt: Date;
    createdBy: string;
    tenantIds: string[];
  }): Promise<InviteRecord>;
  findById(id: string): Promise<InviteRecord | null>;
  findByTokenHash(tokenHash: string): Promise<InviteRecord | null>;
  list(input: { page: number; pageSize: number; pendingOnly?: boolean }): Promise<{
    items: InviteRecord[];
    total: number;
  }>;
  markAccepted(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export const INVITE_REPOSITORY = Symbol('INVITE_REPOSITORY');
