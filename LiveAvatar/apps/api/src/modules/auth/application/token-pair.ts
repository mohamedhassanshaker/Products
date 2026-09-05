import type { AdminIdentity } from '../domain/admin-identity';
import type { RefreshTokenRepositoryPort, TokenDigestPort, TokenSignerPort } from '../domain/ports';

const ACCESS_EXPIRES_IN = 28800 as const;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Maps an identity to the public user DTO (empty tenant_ids = operator).
 * @param user - Identity
 */
export function toUserDto(user: AdminIdentity) {
  const tenantIds = user.roles.includes('operator') ? [] : user.tenantIds;
  return {
    id: user.id,
    email: user.email,
    roles: user.roles,
    tenant_ids: tenantIds,
  };
}

/**
 * Creates an access JWT plus a rotated opaque refresh token (new family).
 * @param user - Identity
 * @param signer - JWT signer
 * @param refresh - Refresh store
 * @param digest - Opaque token helper
 */
export async function issueTokenPair(
  user: AdminIdentity,
  signer: TokenSignerPort,
  refresh: RefreshTokenRepositoryPort,
  digest: TokenDigestPort,
  familyId = digest.randomFamilyId(),
) {
  const accessToken = signer.signAccess({
    ...user,
    tenantIds: user.roles.includes('operator') ? [] : user.tenantIds,
  });
  const refreshToken = digest.randomToken();
  await refresh.create({
    adminUserId: user.id,
    tokenHash: digest.digest(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return {
    access_token: accessToken,
    expires_in: ACCESS_EXPIRES_IN,
    refresh_token: refreshToken,
  };
}
