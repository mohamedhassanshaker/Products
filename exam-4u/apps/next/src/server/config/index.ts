import { loadAndValidateEnv, type EnvVars } from './env.schema';

/**
 * `server/config`'s public barrel (LLD §2 equivalent for the new stack — "no other file may read
 * `process.env`"). Every consumer imports {@link getEnv} from here; nothing outside this module may
 * import `./env.schema` directly (enforced by `apps/next/.eslintrc.cjs`'s `config` module-boundary
 * rule).
 *
 * Cached on `globalThis` (not just a plain module-level `let`) for the same reason the tenant
 * DataSource registry is (see `server/infrastructure/database/index.ts`): Next.js dev-mode hot
 * module reloading re-evaluates a route module's top-level statements on every edit, which would
 * otherwise silently re-validate (and could re-throw on a since-fixed-but-not-yet-reloaded env) on
 * every single request during development.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandEnv: EnvVars | undefined;
}

/**
 * Validates (on first call) and returns the process-wide, typed environment configuration.
 *
 * @throws Error listing every invalid/missing variable, if validation fails (fail-fast — see
 *   {@link loadAndValidateEnv}'s own doc comment for the exact contract).
 */
export function getEnv(): EnvVars {
  if (!globalThis.__examlandEnv) {
    globalThis.__examlandEnv = loadAndValidateEnv(process.env);
  }
  return globalThis.__examlandEnv;
}

export type { EnvVars };
