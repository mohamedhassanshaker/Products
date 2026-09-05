import { Type, type Static } from '@sinclair/typebox';

/**
 * Process environment validated at bootstrap. Secrets are never logged.
 */
export const EnvSchema = Type.Object({
  DATABASE_URL: Type.String({ minLength: 1 }),
  REDIS_URL: Type.Optional(Type.String()),
  JWT_ACCESS_SECRET: Type.String({ minLength: 16 }),
  JWT_REFRESH_SECRET: Type.String({ minLength: 16 }),
  BOOTSTRAP_SECRET: Type.String({ minLength: 8 }),
  PORT: Type.Optional(Type.String()),
  NODE_ENV: Type.Optional(Type.String()),
  // LiveKit (Phase 3, FR-TRANSPORT-1/FR-AUTH-4). A single ws(s):// URL is used
  // both for server-side RoomServiceClient calls (the SDK accepts ws(s) and
  // converts internally) and as the `ws_url` handed back to the browser, so
  // there is one source of truth for "where LiveKit lives" rather than two
  // URLs that can drift apart behind a reverse proxy.
  LIVEKIT_URL: Type.String({ minLength: 1 }),
  LIVEKIT_API_KEY: Type.String({ minLength: 1 }),
  LIVEKIT_API_SECRET: Type.String({ minLength: 8 }),
  // Explicit-dispatch agent identity (LLD §8.3), matches the Python agent's
  // AGENT_NAME (apps/agent/src/avatar_agent/settings.py).
  AGENT_NAME: Type.Optional(Type.String()),
  // Phase 4 (BL-013..017): shared secret the Python agent presents as
  // `X-Internal-Token` on every agent-facing `/internal` route
  // (InternalTokenGuard). The LiveKit webhook route is unaffected — it
  // authenticates via LiveKit's own HMAC signature instead (LLD §5.9).
  INTERNAL_TOKEN: Type.String({ minLength: 16 }),
});

/** Validated env. */
export type Env = Static<typeof EnvSchema>;
