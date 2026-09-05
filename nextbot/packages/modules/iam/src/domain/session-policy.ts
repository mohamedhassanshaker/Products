/**
 * Shared session lifetime constant (Phase 4, BL-36). Lives in `domain/` (pure,
 * no I/O) so both `application/session-token.ts` (JWT `exp`) and
 * `infrastructure/session-repository.ts` (`auth_session.expires_at`) derive the
 * same value from one place — the two must always agree, since a JWT that
 * outlives its DB-side session row (or vice versa) would create exactly the
 * "meaningful window of continued access" gap the revocation requirement
 * exists to close.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h — Admin Console session lifetime.
