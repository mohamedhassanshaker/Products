import { Value } from '@sinclair/typebox/value';
import { EnvSchema, type Env } from '../domain/env-schema';

/**
 * Validates process.env against the platform env schema at bootstrap.
 * @param env - process.env
 * @returns Typed env
 * @throws Error when required secrets or DATABASE_URL are missing
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const candidate = {
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    BOOTSTRAP_SECRET: env.BOOTSTRAP_SECRET,
    PORT: env.PORT,
    NODE_ENV: env.NODE_ENV,
    LIVEKIT_URL: env.LIVEKIT_URL,
    LIVEKIT_API_KEY: env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: env.LIVEKIT_API_SECRET,
    AGENT_NAME: env.AGENT_NAME,
    INTERNAL_TOKEN: env.INTERNAL_TOKEN,
  };
  if (!Value.Check(EnvSchema, candidate)) {
    const errors = [...Value.Errors(EnvSchema, candidate)].map((e) => `${e.path}: ${e.message}`);
    throw new Error(`Invalid environment: ${errors.join('; ')}`);
  }
  return candidate as Env;
}
