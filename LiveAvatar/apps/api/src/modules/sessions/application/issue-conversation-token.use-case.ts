import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PublicSessionCreateRequest, PublicSessionResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../../deployment-config';
import {
  LIVEKIT_CLIENT,
  agentIdentity,
  buildRoomName,
  DEFAULT_AGENT_NAME,
  DEFAULT_MAX_DURATION_SECONDS,
  tokenTtlSeconds,
  userIdentity,
  type LiveKitClientPort,
} from '../../transport';
import { SESSION_REPOSITORY, RESIDENCY_SNAPSHOT_READER, type SessionRepositoryPort, type ResidencySnapshotReaderPort } from '../domain/ports';
import type { ProviderStackSnapshot } from '../domain/session';

const DEFAULT_DISPLAY_NAME = 'Guest';

/**
 * `POST /public/sessions` (FR-AUTH-4). The only legal way a conversation
 * token gets minted — reached exclusively from the Screen 9 pre-call flow,
 * never a general-purpose token endpoint. No admin JWT: end users have no
 * accounts.
 */
@Injectable()
export class IssueConversationTokenUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(RESIDENCY_SNAPSHOT_READER) private readonly residency: ResidencySnapshotReaderPort,
    @Inject(LIVEKIT_CLIENT) private readonly liveKit: LiveKitClientPort,
  ) {}

  /** @param input - `{slug|tenant_id, display_name?, tab_key?}` */
  async execute(input: PublicSessionCreateRequest): Promise<PublicSessionResponse> {
    const tenant = await this.resolveTenant(input);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (tenant.status === 'paused') {
      throw AppError.forbidden('TENANT_PAUSED');
    }

    const config = await this.configs.findByTenantId(tenant.id);
    if (!config || config.status !== 'published' || !isConfigComplete(config.providers)) {
      throw new AppError('CONFIG_INCOMPLETE', 422);
    }

    const displayName = input.display_name?.trim() || DEFAULT_DISPLAY_NAME;

    // FR-AUTH-4 idempotency: a re-request from the same tab before join
    // abandons the previous unjoined session rather than leaving two
    // `pending` rows racing for the same tab.
    if (input.tab_key) {
      const previous = await this.sessions.findPendingByTabKey(tenant.id, input.tab_key);
      if (previous) {
        await this.sessions.applyStatus(previous.id, { status: 'abandoned', endedAt: new Date() });
        await this.liveKit.deleteRoom(previous.roomName);
      }
    }

    const residencySnapshot = await this.residency.read(tenant.id);
    const sessionId = randomUUID();
    const roomName = buildRoomName(tenant.roomNamespace, sessionId);

    const outcome = await this.liveKit.createRoom({
      roomName,
      metadata: { tenant_id: tenant.id, session_id: sessionId },
    });
    if (outcome.kind === 'unavailable') {
      throw new AppError('TRANSPORT_UNAVAILABLE', 503);
    }
    if (outcome.kind === 'capacity') {
      throw new AppError('TRANSPORT_CAPACITY', 503);
    }

    const providerStack: ProviderStackSnapshot = {
      transport: config.providers.transport,
      stt: config.providers.stt,
      llm: config.providers.llm,
      llmFallback: config.providers.llmFallback,
      tts: config.providers.tts,
      avatar: config.providers.avatar,
    };

    await this.sessions.create({
      id: sessionId,
      tenantId: tenant.id,
      roomName,
      providerStack,
      residencySnapshot,
      displayName,
      tabKey: input.tab_key ?? null,
      maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    });

    const ttlSeconds = tokenTtlSeconds(DEFAULT_MAX_DURATION_SECONDS);
    const userToken = await this.liveKit.mintToken({
      roomName,
      identity: userIdentity(sessionId),
      canPublish: true,
      canSubscribe: true,
      ttlSeconds,
    });

    // Agent join token + explicit dispatch (LLD §8.3 steps 6-7). Both are
    // best-effort: no worker is registered before Phase 4 (agent may be a
    // stub per the Phase 3 backlog exit condition), so neither may fail
    // token issuance to the browser.
    const agentToken = await this.liveKit.mintToken({
      roomName,
      identity: agentIdentity(sessionId),
      canPublish: true,
      canSubscribe: false,
      ttlSeconds,
    });
    await this.liveKit.createAgentDispatch({
      roomName,
      agentName: process.env.AGENT_NAME || DEFAULT_AGENT_NAME,
      metadata: { session_id: sessionId, tenant_id: tenant.id, agent_token: agentToken },
    });

    return {
      session_id: sessionId,
      room_name: roomName,
      ws_url: publicLiveKitUrl(),
      token: userToken,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** Resolves by `tenant_id` when present, else by `slug`; neither present resolves to nothing found. */
  private async resolveTenant(input: PublicSessionCreateRequest) {
    if (input.tenant_id) {
      return this.tenants.findById(input.tenant_id);
    }
    if (input.slug) {
      return this.tenants.findBySlug(input.slug);
    }
    return null;
  }
}

/**
 * A published config's Gate A/B validation (deployment-config module) already
 * guarantees every required layer is set before it can reach `published`, so
 * this is a defense-in-depth re-check, not the primary gate.
 * @param providers - Denormalized provider columns
 */
function isConfigComplete(providers: {
  transport: string | null;
  stt: string | null;
  llm: string | null;
  tts: string | null;
  avatar: string | null;
}): boolean {
  return Boolean(providers.transport && providers.stt && providers.llm && providers.tts && providers.avatar);
}

/** @param name - Env var name */
function requireEnv(name: 'LIVEKIT_URL'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * The `ws(s)://` address the *browser's* LiveKit client connects to —
 * `LIVEKIT_PUBLIC_URL`, falling back to the container-internal `LIVEKIT_URL`
 * only when no public override is configured (e.g. a real deployment where
 * both sides resolve the same `wss://` hostname). In compose/k8s, `LIVEKIT_URL`
 * is a cluster-only hostname (`ws://livekit:7880`) a browser can never
 * resolve, so handing it to the browser here would make every call fail to
 * connect (see `publicLiveKitConnectSrc` in `main.ts`, which allows this
 * same origin through the CSP `connect-src`).
 */
function publicLiveKitUrl(): string {
  return process.env.LIVEKIT_PUBLIC_URL ?? requireEnv('LIVEKIT_URL');
}
