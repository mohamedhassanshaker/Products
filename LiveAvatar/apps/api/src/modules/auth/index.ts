/** Public API of the auth module. */
export { AuthModule } from './auth.module';
export { LoginUseCase } from './application/login.use-case';
export { issueTokenPair, toUserDto } from './application/token-pair';
export {
  PASSWORD_HASHER,
  TOKEN_SIGNER,
  TOKEN_DIGEST,
  ADMIN_USER_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
} from './domain/ports';
export type {
  AdminUserRepositoryPort,
  PasswordHasherPort,
  RefreshTokenRepositoryPort,
  TokenDigestPort,
  TokenSignerPort,
} from './domain/ports';
export type { AdminIdentity } from './domain/admin-identity';
export { normalizeEmail, assertPasswordPolicy } from './domain/validation';
