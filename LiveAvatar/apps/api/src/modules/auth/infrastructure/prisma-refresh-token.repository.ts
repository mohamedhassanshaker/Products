import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RefreshTokenRecord, RefreshTokenRepositoryPort } from '../domain/ports';

/**
 * Prisma persistence for refresh tokens and family revocation.
 */
@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param input - New refresh row
   */
  async create(input: {
    adminUserId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.db.refreshToken.create({ data: input });
  }

  /**
   * @param tokenHash - SHA-256 of the opaque token
   */
  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.db.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * @param familyId - Rotation family
   */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * @param tokenHash - Single row to mark used
   */
  async revokeByHash(tokenHash: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
