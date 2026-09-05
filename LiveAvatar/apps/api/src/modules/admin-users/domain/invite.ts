/** Persisted invite (domain). */
export interface InviteRecord {
  id: string;
  email: string;
  roles: string[];
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  tenantIds: string[];
}
