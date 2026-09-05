import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AdminIdentity } from '../domain/admin-identity';
import type { AdminUserRepositoryPort } from '../domain/ports';

/**
 * Prisma persistence for admin users and memberships.
 */
@Injectable()
export class PrismaAdminUserRepository implements AdminUserRepositoryPort {
  /**
   * Fixed Postgres advisory-lock key scoping the bootstrap ("only one
   * operator may ever be seeded") critical section. Arbitrary but stable —
   * changing it is safe (it only needs to be consistent within one process
   * lineage; a differing key across deploys just means the lock does not
   * collide with itself, which is harmless).
   */
  private static readonly SEED_LOCK_KEY = 7825551234;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param email - Citext email
   */
  async findByEmail(email: string): Promise<AdminIdentity | null> {
    const row = await this.prisma.db.adminUser.findUnique({
      where: { email },
      include: { memberships: true },
    });
    return row ? this.toIdentity(row) : null;
  }

  /**
   * @param id - User id
   */
  async findById(id: string): Promise<AdminIdentity | null> {
    const row = await this.prisma.db.adminUser.findUnique({
      where: { id },
      include: { memberships: true },
    });
    return row ? this.toIdentity(row) : null;
  }

  /** @returns Count of users whose roles include operator */
  async countOperators(): Promise<number> {
    return this.prisma.db.adminUser.count({
      where: { roles: { has: 'operator' } },
    });
  }

  /**
   * @param input - New admin + optional memberships
   */
  async create(input: {
    email: string;
    passwordHash: string;
    roles: string[];
    tenantIds: string[];
  }): Promise<AdminIdentity> {
    const row = await this.prisma.withBypass(() =>
      this.prisma.db.adminUser.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          roles: input.roles,
          memberships: {
            create: input.tenantIds.map((tenantId) => ({ tenantId })),
          },
        },
        include: { memberships: true },
      }),
    );
    return this.toIdentity(row);
  }

  /**
   * @param input - Candidate email + already-hashed password for the first operator
   * @returns The created operator, or null if one already exists (D-4)
   */
  async createFirstOperator(input: { email: string; passwordHash: string }): Promise<AdminIdentity | null> {
    return this.prisma.transaction(async (tx) => {
      // Serializes concurrent bootstrap attempts across DB connections; the
      // lock is transaction-scoped so it releases automatically on
      // commit/rollback — no separate unlock call is needed.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PrismaAdminUserRepository.SEED_LOCK_KEY})`;
      const alreadySeeded =
        (await tx.adminUser.count({ where: { roles: { has: 'operator' } } })) > 0;
      if (alreadySeeded) {
        return null;
      }
      const row = await tx.adminUser.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          roles: ['operator'],
        },
        include: { memberships: true },
      });
      return this.toIdentity(row);
    });
  }

  /**
   * @param email - Candidate
   */
  async emailExists(email: string): Promise<boolean> {
    const row = await this.prisma.db.adminUser.findUnique({
      where: { email },
      select: { id: true },
    });
    return !!row;
  }

  private toIdentity(row: {
    id: string;
    email: string;
    passwordHash: string;
    roles: string[];
    disabled: boolean;
    memberships: { tenantId: string }[];
  }): AdminIdentity {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      roles: row.roles,
      disabled: row.disabled,
      tenantIds: row.memberships.map((m) => m.tenantId),
    };
  }
}
