import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  LoginRequestSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
  SeedRequestSchema,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { AppError } from '../../../common/errors/app-error';
import { LoginUseCase } from '../application/login.use-case';
import { RefreshUseCase } from '../application/refresh.use-case';
import { LogoutUseCase } from '../application/logout.use-case';
import { SeedOperatorUseCase } from '../application/seed-operator.use-case';
import { GetMeUseCase } from '../application/get-me.use-case';

/**
 * Auth HTTP surface (LLD §5.2) excluding invites (owned by admin-users).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly login: LoginUseCase,
    private readonly refresh: RefreshUseCase,
    private readonly logout: LogoutUseCase,
    private readonly seed: SeedOperatorUseCase,
    private readonly me: GetMeUseCase,
  ) {}

  /** POST /api/auth/login */
  @Post('login')
  @HttpCode(200)
  loginUser(
    @Body(new TypeBoxValidationPipe(LoginRequestSchema, 'AUTH_EMAIL_INVALID'))
    body: { email: string; password: string },
    @Req() req: Request,
  ) {
    const ip = (req.ip ?? req.socket.remoteAddress ?? '0.0.0.0').replace('::ffff:', '');
    return this.login.execute(body, ip);
  }

  /** POST /api/auth/refresh */
  @Post('refresh')
  @HttpCode(200)
  refreshSession(
    @Body(new TypeBoxValidationPipe(RefreshRequestSchema, 'AUTH_REFRESH_INVALID'))
    body: { refresh_token: string },
  ) {
    return this.refresh.execute(body.refresh_token);
  }

  /** POST /api/auth/logout */
  @Post('logout')
  @UseGuards(AdminJwtGuard)
  @HttpCode(204)
  async logoutUser(
    @Body(new TypeBoxValidationPipe(LogoutRequestSchema, 'AUTH_UNAUTHORIZED'))
    body: { refresh_token: string },
  ): Promise<void> {
    await this.logout.execute(body.refresh_token);
  }

  /** GET /api/auth/me */
  @Get('me')
  @UseGuards(AdminJwtGuard)
  getMe(@CurrentUser() actor: AdminActor) {
    return this.me.execute(actor);
  }

  /** POST /api/auth/seed */
  @Post('seed')
  @HttpCode(201)
  seedOperator(
    @Headers('x-bootstrap-secret') secret: string | undefined,
    @Body(new TypeBoxValidationPipe(SeedRequestSchema, 'AUTH_EMAIL_INVALID'))
    body: { email: string; password: string },
  ) {
    const expected = process.env.BOOTSTRAP_SECRET;
    if (!secret || !expected || secret !== expected) {
      throw AppError.unauthorized();
    }
    return this.seed.execute(body);
  }
}
