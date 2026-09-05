import { randomUUID } from 'node:crypto';
import type pino from 'pino';
import type { PasswordHasherPort } from '@/server/common/ports/password-hasher.port';
import type { PlatformAdminRepository } from '../infrastructure/platform-admin.repository';

/** Both bootstrap env vars, or neither — a partial pair is treated as "not configured". */
export interface PlatformAdminBootstrapConfig {
  email: string | undefined;
  password: string | undefined;
}

/**
 * Idempotently seeds exactly one Platform Admin from `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD` —
 * ported verbatim (logic unchanged) from
 * `legacy/api/src/platform/auth/platform-admin-bootstrap.service.ts`'s `PlatformAdminBootstrapService`.
 *
 * Legacy runs this from Nest's `OnApplicationBootstrap` lifecycle hook (once per process boot, before
 * the HTTP listener opens). This app has no DI-container lifecycle hook — `instrumentation.ts`'s
 * `register()` (Next's own once-per-process boot hook, already used for env validation, Phase 0) is
 * this app's equivalent call site; see that file for the wiring.
 *
 * **Idempotent by row-count, not by email**: once *any* Platform Admin exists (bootstrapped or
 * otherwise), this permanently no-ops even if the bootstrap env vars are still set — safe to leave
 * configured indefinitely, never overwrites an existing admin's credentials.
 */
export class PlatformAdminBootstrapService {
  constructor(
    private readonly admins: PlatformAdminRepository,
    private readonly hasher: PasswordHasherPort,
    private readonly logger: pino.Logger,
  ) {}

  async run(config: PlatformAdminBootstrapConfig): Promise<void> {
    const email = config.email?.trim().toLowerCase();
    const password = config.password;
    if (!email || !password) return; // Both required together; a partial pair is a no-op.

    const existingCount = await this.admins.count();
    if (existingCount > 0) return; // Only runs when the table is completely empty.

    const passwordHash = await this.hasher.hash(password);
    await this.admins.insert({
      id: randomUUID(),
      email,
      passwordHash,
      name: 'Platform Admin', // Hardcoded literal, ported verbatim — not configurable.
      isActive: true,
      lastLoginAt: null,
    });
    this.logger.info({ email }, 'platform_admin_bootstrap_seeded');
  }
}
