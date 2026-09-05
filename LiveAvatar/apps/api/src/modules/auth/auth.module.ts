import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminJwtStrategy } from '../../common/auth/admin-jwt.strategy';
import {
  ADMIN_USER_REPOSITORY,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_DIGEST,
  TOKEN_SIGNER,
} from './domain/ports';
import { LoginUseCase } from './application/login.use-case';
import { RefreshUseCase } from './application/refresh.use-case';
import { LogoutUseCase } from './application/logout.use-case';
import { SeedOperatorUseCase } from './application/seed-operator.use-case';
import { GetMeUseCase } from './application/get-me.use-case';
import { Argon2Hasher } from './infrastructure/argon2.hasher';
import { JwtSigner } from './infrastructure/jwt.signer';
import { Sha256TokenDigest } from './infrastructure/sha256-digest';
import { PrismaAdminUserRepository } from './infrastructure/prisma-admin-user.repository';
import { PrismaRefreshTokenRepository } from './infrastructure/prisma-refresh-token.repository';
import { RedisLoginRateLimiter } from './infrastructure/redis-login-rate-limiter';
import { AuthController } from './interface/auth.controller';

/**
 * Auth bounded context — login, refresh, logout, seed, JWT strategy.
 * Ports are exported so admin-users can issue tokens on invite-accept.
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'admin-jwt' }),
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AdminJwtStrategy,
    LoginUseCase,
    RefreshUseCase,
    LogoutUseCase,
    SeedOperatorUseCase,
    GetMeUseCase,
    JwtSigner,
    Argon2Hasher,
    Sha256TokenDigest,
    PrismaAdminUserRepository,
    PrismaRefreshTokenRepository,
    RedisLoginRateLimiter,
    { provide: PASSWORD_HASHER, useExisting: Argon2Hasher },
    { provide: TOKEN_SIGNER, useExisting: JwtSigner },
    { provide: TOKEN_DIGEST, useExisting: Sha256TokenDigest },
    { provide: ADMIN_USER_REPOSITORY, useExisting: PrismaAdminUserRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useExisting: PrismaRefreshTokenRepository },
    { provide: LOGIN_RATE_LIMITER, useExisting: RedisLoginRateLimiter },
  ],
  exports: [
    LoginUseCase,
    PASSWORD_HASHER,
    TOKEN_SIGNER,
    TOKEN_DIGEST,
    ADMIN_USER_REPOSITORY,
    REFRESH_TOKEN_REPOSITORY,
  ],
})
export class AuthModule {}
