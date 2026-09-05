import { Inject, Injectable } from '@nestjs/common';
import type { PreflightResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../../deployment-config';
import { LIVEKIT_CLIENT, type LiveKitClientPort } from '../../transport';

/**
 * `GET /public/deployments/{slug}/preflight` (FR-CALL-1 step 2). No admin
 * JWT — this is the connection check the end-user pre-call screen runs
 * before requesting mic permission's token. Every failure path throws
 * instead of returning a `false`/`incomplete` flag: the documented success
 * shape (LLD §5.1) always reads `reachable: true`/`complete: true`.
 */
@Injectable()
export class GetPreflightUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
    @Inject(LIVEKIT_CLIENT) private readonly liveKit: LiveKitClientPort,
  ) {}

  /** @param slug - Tenant's public deployment slug */
  async execute(slug: string): Promise<PreflightResponse> {
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (tenant.status === 'paused') {
      throw AppError.forbidden('TENANT_PAUSED');
    }

    const config = await this.configs.findByTenantId(tenant.id);
    if (!config || config.status !== 'published') {
      throw new AppError('CONFIG_INCOMPLETE', 422);
    }

    const reachable = await this.liveKit.checkReachable();
    if (!reachable) {
      throw new AppError('TRANSPORT_UNAVAILABLE', 503);
    }

    return {
      deployment: { slug: tenant.slug, name: tenant.name },
      transport: { reachable: true, ws_url: publicLiveKitUrl() },
      config: { complete: true },
      // No v1 avatar adapter exists yet (Phase 5/6); omit so the client falls
      // back to its placeholder, exactly as FR-CALL-1 specifies.
      avatar: {},
    };
  }
}

/**
 * @param name - Env var name
 */
function requireEnv(name: 'LIVEKIT_URL'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/** See `publicLiveKitUrl` in `issue-conversation-token.use-case.ts` for why this can't just be `LIVEKIT_URL`. */
function publicLiveKitUrl(): string {
  return process.env.LIVEKIT_PUBLIC_URL ?? requireEnv('LIVEKIT_URL');
}
